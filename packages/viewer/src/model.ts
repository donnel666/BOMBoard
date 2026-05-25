import type {
  BomCoordinateComponent,
  CoordinateRecord,
  DrillHit,
  Gerber2DProject,
  ViewBox,
} from "@bomboard/parsers";
import type {
  BoardViewerModel,
  BoardViewerOptions,
  BoardViewerSide,
  ComponentSimilarityKeyFn,
  ViewerComponent,
  ViewerComponentElement,
  ViewerComponentSize,
} from "./types.js";

const passivePrefixes = new Set(["C", "R", "L", "FB", "F"]);
const smdGeometryPaddingMm = 0.28;
const throughHoleGeometryPaddingMm = 1.0;
const componentHoleMinimumDiameterMm = 0.4;
const silkscreenMinimumFeatureMm = 1.0;

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface GeometryPoint {
  x: number;
  y: number;
}

type GeometryPrimitive =
  | {
    kind: "circle";
    bounds: Bounds;
    center: GeometryPoint;
    radiusMm: number;
    diameterMm?: number;
    isText?: boolean;
  }
  | {
    kind: "polygon";
    bounds: Bounds;
    points: GeometryPoint[];
    diameterMm?: number;
    isText?: boolean;
  }
  | {
    kind: "polyline";
    bounds: Bounds;
    points: GeometryPoint[];
    strokeWidthMm: number;
    diameterMm?: number;
    isText?: boolean;
  };

interface GeometryIndex {
  pads: Record<BoardViewerSide, GeometryPrimitive[]>;
  holes: Record<BoardViewerSide, GeometryPrimitive[]>;
}

interface GeometryMatch {
  size: ViewerComponentSize;
  elements: ViewerComponentElement[];
}

interface PrimitiveCandidate {
  primitive: GeometryPrimitive;
  local: Bounds;
  distance: number;
}

export function createBoardViewerModel(
  options: Pick<
    BoardViewerOptions,
    "bomCoordinates" | "gerber" | "getComponentSize" | "getSimilarityKey" | "mirrorBottom"
  >
): BoardViewerModel {
  const viewBox = options.gerber.fragments.boardShapeRenderFragment.viewBox as ViewBox;
  const getSimilarityKey = options.getSimilarityKey ?? defaultComponentSimilarityKey;
  const mirrorBottom = options.mirrorBottom !== false;
  const geometry = createGeometryIndex(options.gerber, viewBox, mirrorBottom);
  const components = options.bomCoordinates.components
    .flatMap(component => toViewerComponent(component, viewBox, mirrorBottom, geometry, getSimilarityKey, options.getComponentSize))
    .sort((left, right) => left.designator.localeCompare(right.designator));

  return {viewBox, components};
}

export function visibleComponentsForSide(
  components: readonly ViewerComponent[],
  side: BoardViewerSide
): ViewerComponent[] {
  return components.filter(component => component.side === side || component.side === "unknown");
}

export function highlightedDesignatorsForSelection(
  components: readonly ViewerComponent[],
  selectedDesignator: string | null
): string[] {
  if (selectedDesignator === null) return [];

  const selected = components.find(component => component.designator === selectedDesignator);
  if (!selected) return [];

  return components
    .filter(component => component.similarityKey === selected.similarityKey)
    .map(component => component.designator)
    .sort(compareDesignators);
}

export function defaultComponentSimilarityKey(
  component: BomCoordinateComponent
): string | null {
  const bom = component.bom;
  const placement = component.placement;
  const comment = normalizeComparable(bom?.comment ?? placement?.comment ?? "");
  const footprint = normalizeComparable(bom?.footprint ?? placement?.footprint ?? "");

  if (comment && footprint) return [comment, footprint].join("|");

  return null;
}

function toViewerComponent(
  component: BomCoordinateComponent,
  viewBox: ViewBox,
  mirrorBottom: boolean,
  geometry: GeometryIndex,
  getSimilarityKey: ComponentSimilarityKeyFn,
  getComponentSize: BoardViewerOptions["getComponentSize"]
): ViewerComponent[] {
  const placement = component.placement;
  if (!placement) return [];

  const side = normalizePlacementSide(placement);
  const boardPosition = {
    x: placement.mid.xMm,
    y: -placement.mid.yMm,
  };
  const displayPosition = {
    x: side === "bottom" && mirrorBottom ? mirrorX(boardPosition.x, viewBox) : boardPosition.x,
    y: boardPosition.y,
  };
  const displayPadPosition = {
    x: side === "bottom" && mirrorBottom ? mirrorX(placement.pad.xMm, viewBox) : placement.pad.xMm,
    y: -placement.pad.yMm,
  };
  const rotation = displayRotation(side, placement.rotationDeg, mirrorBottom);
  const estimatedSize = estimateComponentSize(component);
  const geometryMatch = matchGerberGeometry(
    component,
    estimatedSize,
    displayPosition,
    displayPadPosition,
    rotation,
    side === "bottom" ? geometry.holes.bottom : geometry.holes.top,
    side === "bottom" ? geometry.pads.bottom : geometry.pads.top
  );
  const size = normalizeComponentSize(
    geometryMatch?.size ?? estimatedSize,
    getComponentSize?.(component)
  );
  const similarityKey = getSimilarityKey(component) ?? component.designator;

  return [
    {
      designator: component.designator,
      source: component,
      placement,
      side,
      boardPosition,
      displayPosition,
      rotationDeg: placement.rotationDeg,
      footprint: component.bom?.footprint ?? placement.footprint,
      comment: component.bom?.comment ?? placement.comment,
      libRef: component.bom?.libRef ?? "",
      similarityKey,
      size,
      highlightElements: geometryMatch?.elements ?? [],
    },
  ];
}

function normalizePlacementSide(
  placement: CoordinateRecord
): BoardViewerSide | "unknown" {
  if (placement.side === "top" || placement.side === "bottom") return placement.side;
  return "unknown";
}

function estimateComponentSize(component: BomCoordinateComponent): ViewerComponentSize {
  const footprint = component.placement?.footprint ?? component.bom?.footprint ?? "";
  const codeSize = sizeFromFootprintCode(footprint);
  if (codeSize) return codeSize;

  const explicitSize = sizeFromExplicitDimensions(footprint);
  if (explicitSize) return explicitSize;

  const placement = component.placement;
  if (placement) {
    const padSpan = distanceMm(placement.mid, placement.pad) * 2;
    if (padSpan > 0.1) {
      const widthMm = clamp(padSpan + 0.6, 1.2, 14);
      const heightMm = clamp(widthMm * 0.55, 0.8, 10);
      return withHitArea(widthMm, heightMm);
    }
  }

  const designatorPrefix = component.designator.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? "";
  if (passivePrefixes.has(designatorPrefix)) return withHitArea(1.6, 0.9);

  return withHitArea(3.2, 2.4);
}

function matchGerberGeometry(
  component: BomCoordinateComponent,
  estimatedSize: ViewerComponentSize,
  displayPosition: {x: number; y: number},
  displayPadPosition: {x: number; y: number},
  rotation: number,
  holes: readonly GeometryPrimitive[],
  pads: readonly GeometryPrimitive[]
): GeometryMatch | null {
  const throughHole = isThroughHoleFootprint(component);
  const sourceBounds = throughHole
    ? holes.filter(isLikelyComponentHole)
    : pads;
  const fallbackBounds = throughHole ? holes : pads;
  let selectedPrimitives = selectNearbyPrimitives(
    sourceBounds.length > 0 ? sourceBounds : fallbackBounds,
    displayPosition,
    rotation,
    geometrySearchSize(estimatedSize, displayPosition, displayPadPosition, throughHole),
    component.bom?.pins,
    displayPadPosition
  );

  if (selectedPrimitives.length === 0 && throughHole && sourceBounds.length > 0) {
    selectedPrimitives = selectNearbyPrimitives(
      holes,
      displayPosition,
      rotation,
      geometrySearchSize(estimatedSize, displayPosition, displayPadPosition, throughHole),
      component.bom?.pins,
      displayPadPosition
    );
  }

  if (selectedPrimitives.length === 0) return null;

  const localUnion = unionLocalBounds(selectedPrimitives, displayPosition, rotation);
  const padding = throughHole ? throughHoleGeometryPaddingMm : smdGeometryPaddingMm;
  const widthMm = Math.max(
    throughHole ? 1.0 : 0.6,
    (Math.max(Math.abs(localUnion.minX), Math.abs(localUnion.maxX)) + padding) * 2
  );
  const heightMm = Math.max(
    throughHole ? 1.0 : 0.6,
    (Math.max(Math.abs(localUnion.minY), Math.abs(localUnion.maxY)) + padding) * 2
  );

  return {
    size: withHitArea(widthMm, heightMm),
    elements: selectedPrimitives.map(primitive => toViewerComponentElement(primitive, displayPosition, rotation)),
  };
}

function isLikelyComponentHole(primitive: GeometryPrimitive): boolean {
  const diameter = primitive.diameterMm ?? Math.max(boundsWidth(primitive.bounds), boundsHeight(primitive.bounds));
  return diameter >= componentHoleMinimumDiameterMm;
}

function isThroughHoleFootprint(component: BomCoordinateComponent): boolean {
  const footprint = `${component.placement?.footprint ?? ""} ${component.bom?.footprint ?? ""}`.toUpperCase();
  return /(?:^|[_-])TH(?:$|[_-])/.test(footprint)
    || footprint.includes("-TH_")
    || footprint.includes("_TH_")
    || footprint.startsWith("TH_")
    || footprint.includes("THT")
    || footprint.includes("DIP-")
    || footprint.includes("HDR-TH")
    || footprint.includes("CONN-TH")
    || footprint.includes("RELAY-TH")
    || footprint.includes("BUZ-TH");
}

function geometrySearchSize(
  estimatedSize: ViewerComponentSize,
  displayPosition: {x: number; y: number},
  displayPadPosition: {x: number; y: number},
  throughHole: boolean
): {widthMm: number; heightMm: number} {
  const padSpan = Math.hypot(
    displayPosition.x - displayPadPosition.x,
    displayPosition.y - displayPadPosition.y
  ) * 2;
  const padBasedSize = padSpan + (throughHole ? 8 : 3);
  const multiplier = throughHole ? 1.9 : 1.45;

  return {
    widthMm: clamp(Math.max(estimatedSize.hitWidthMm * multiplier, padBasedSize, 4), 4, throughHole ? 160 : 42),
    heightMm: clamp(Math.max(estimatedSize.hitHeightMm * multiplier, padBasedSize, 4), 4, throughHole ? 160 : 42),
  };
}

function selectNearbyPrimitives(
  primitives: readonly GeometryPrimitive[],
  displayPosition: {x: number; y: number},
  rotation: number,
  searchSize: {widthMm: number; heightMm: number},
  expectedCount: number | null | undefined,
  anchorPoint?: {x: number; y: number}
): GeometryPrimitive[] {
  const candidates = primitives
    .map(primitive => ({
      primitive,
      local: toLocalBounds(primitive.bounds, displayPosition, rotation),
    }))
    .filter(({local}) => local.maxX >= -searchSize.widthMm / 2
      && local.minX <= searchSize.widthMm / 2
      && local.maxY >= -searchSize.heightMm / 2
      && local.minY <= searchSize.heightMm / 2)
    .map(candidate => ({
      ...candidate,
      distance: localBoundsDistance(candidate.local),
    }))
    .sort((left, right) => left.distance - right.distance);

  const count = positiveNumber(expectedCount ?? undefined);
  const candidatePool = count && candidates.length > count && anchorPoint
    ? footprintAnchoredCandidates(
      candidates,
      toLocalPoint(anchorPoint.x, anchorPoint.y, displayPosition, rotation),
      count
    )
    : candidates;
  const selected = count && candidatePool.length > count
    ? candidatePool.slice(0, count)
    : candidatePool;

  return selected.map(candidate => candidate.primitive);
}

function footprintAnchoredCandidates(
  candidates: readonly PrimitiveCandidate[],
  anchorLocal: GeometryPoint,
  expectedCount: number
): readonly PrimitiveCandidate[] {
  const anchorX = Math.abs(anchorLocal.x);
  const anchorY = Math.abs(anchorLocal.y);
  if (Math.hypot(anchorX, anchorY) < 0.1) return candidates;

  const featureSize = median(candidates.flatMap(candidate => [
    boundsWidth(candidate.local),
    boundsHeight(candidate.local),
  ]));
  const tolerance = clamp(featureSize * 2.2, 0.55, 1.8);
  const anchored = candidates.filter(candidate => {
    const center = boundsCenter(candidate.local);
    const withinX = anchorX < 0.2 || Math.abs(center.x) <= anchorX + tolerance;
    const withinY = anchorY < 0.2 || Math.abs(center.y) <= anchorY + tolerance;
    return withinX && withinY;
  });

  return anchored.length >= expectedCount ? anchored : candidates;
}

function localBoundsDistance(bounds: Bounds): number {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return Math.hypot(centerX, centerY);
}

function unionLocalBounds(
  primitives: readonly GeometryPrimitive[],
  displayPosition: {x: number; y: number},
  rotation: number
): Bounds {
  return primitives
    .map(primitive => toLocalBounds(primitive.bounds, displayPosition, rotation))
    .reduce((union, bounds) => ({
      minX: Math.min(union.minX, bounds.minX),
      minY: Math.min(union.minY, bounds.minY),
      maxX: Math.max(union.maxX, bounds.maxX),
      maxY: Math.max(union.maxY, bounds.maxY),
    }));
}

function toViewerComponentElement(
  primitive: GeometryPrimitive,
  displayPosition: {x: number; y: number},
  rotation: number
): ViewerComponentElement {
  if (primitive.kind === "circle") {
    return {
      kind: "circle",
      center: toLocalPoint(primitive.center.x, primitive.center.y, displayPosition, rotation),
      radiusMm: primitive.radiusMm,
    };
  }

  if (primitive.kind === "polyline") {
    return {
      kind: "polyline",
      points: primitive.points.map(point => toLocalPoint(point.x, point.y, displayPosition, rotation)),
      strokeWidthMm: primitive.strokeWidthMm,
    };
  }

  return {
    kind: "polygon",
    points: primitive.points.map(point => toLocalPoint(point.x, point.y, displayPosition, rotation)),
  };
}

function toLocalBounds(
  bounds: Bounds,
  displayPosition: {x: number; y: number},
  rotation: number
): Bounds {
  const corners = [
    toLocalPoint(bounds.minX, bounds.minY, displayPosition, rotation),
    toLocalPoint(bounds.maxX, bounds.minY, displayPosition, rotation),
    toLocalPoint(bounds.maxX, bounds.maxY, displayPosition, rotation),
    toLocalPoint(bounds.minX, bounds.maxY, displayPosition, rotation),
  ];

  return {
    minX: Math.min(...corners.map(point => point.x)),
    minY: Math.min(...corners.map(point => point.y)),
    maxX: Math.max(...corners.map(point => point.x)),
    maxY: Math.max(...corners.map(point => point.y)),
  };
}

function toLocalPoint(
  x: number,
  y: number,
  displayPosition: {x: number; y: number},
  rotation: number
): {x: number; y: number} {
  const deltaX = x - displayPosition.x;
  const deltaY = y - displayPosition.y;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  return {
    x: deltaX * cos + deltaY * sin,
    y: -deltaX * sin + deltaY * cos,
  };
}

function createGeometryIndex(
  project: Gerber2DProject,
  viewBox: ViewBox,
  mirrorBottom: boolean
): GeometryIndex {
  const pads: Record<BoardViewerSide, GeometryPrimitive[]> = {top: [], bottom: []};

  for (const layer of project.fragments.layers) {
    const classification = project.layerClassificationsById[layer.id];
    if (!classification) continue;
    if (classification.kind !== "padMaster" && classification.kind !== "copper") continue;
    if (classification.side !== "top" && classification.side !== "bottom") continue;

    const fragment = project.fragments.svgFragmentsById[layer.id] ?? "";
    const layerPrimitives = extractSvgPrimitives(fragment)
      .filter(primitive => boundsWidth(primitive.bounds) < viewBox[2] * 0.5 && boundsHeight(primitive.bounds) < viewBox[3] * 0.5);

    pads[classification.side].push(
      ...layerPrimitives.map(primitive => classification.side === "bottom" && mirrorBottom
        ? mirrorPrimitiveX(primitive, viewBox)
        : primitive)
    );
  }

  const topHoles = project.drills.flatMap(parsed => parsed.hits.map(drillHitPrimitive));
  const bottomHoles = mirrorBottom
    ? topHoles.map(primitive => mirrorPrimitiveX(primitive, viewBox))
    : topHoles.map(primitive => clonePrimitive(primitive));

  return {
    pads,
    holes: {
      top: topHoles,
      bottom: bottomHoles,
    },
  };
}

function extractSvgPrimitives(
  svg: string,
  options: {ignoreText?: boolean; pathMode?: "bounds" | "polyline"} = {}
): GeometryPrimitive[] {
  return [
    ...extractRectPrimitives(svg),
    ...extractCirclePrimitives(svg),
    ...extractPolygonPrimitives(svg),
    ...extractPathPrimitives(svg, options),
  ];
}

function extractRectPrimitives(svg: string): GeometryPrimitive[] {
  return [...svg.matchAll(/<rect\b[^>]*>/g)]
    .map(match => attributes(match[0]))
    .flatMap(attributes => {
      const x = numberAttribute(attributes, "x");
      const y = numberAttribute(attributes, "y");
      const width = numberAttribute(attributes, "width");
      const height = numberAttribute(attributes, "height");
      if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) return [];
      const points = [
        {x, y},
        {x: x + width, y},
        {x: x + width, y: y + height},
        {x, y: y + height},
      ];
      return [{
        kind: "polygon" as const,
        bounds: boundsFromPoints(points),
        points,
      }];
    });
}

function extractCirclePrimitives(svg: string): GeometryPrimitive[] {
  return [...svg.matchAll(/<circle\b[^>]*>/g)]
    .map(match => attributes(match[0]))
    .flatMap(attributes => {
      const cx = numberAttribute(attributes, "cx");
      const cy = numberAttribute(attributes, "cy");
      const radius = numberAttribute(attributes, "r");
      if (cx === null || cy === null || radius === null || radius <= 0) return [];
      return [{
        kind: "circle" as const,
        center: {x: cx, y: cy},
        radiusMm: radius,
        bounds: circleBounds(cx, cy, radius),
      }];
    });
}

function extractPolygonPrimitives(svg: string): GeometryPrimitive[] {
  return [...svg.matchAll(/<polygon\b[^>]*>/g)]
    .map(match => attributes(match[0]))
    .flatMap(attributes => {
      const points = (attributes.points ?? "")
        .trim()
        .split(/\s+/)
        .map(point => point.split(",").map(Number))
        .filter((point): point is [number, number] => point.length === 2 && point.every(Number.isFinite));
      if (points.length === 0) return [];
      const geometryPoints = points.map(point => ({x: point[0], y: point[1]}));

      return [{
        kind: "polygon" as const,
        bounds: boundsFromPoints(geometryPoints),
        points: geometryPoints,
      }];
    });
}

function extractPathPrimitives(
  svg: string,
  options: {ignoreText?: boolean; pathMode?: "bounds" | "polyline"}
): GeometryPrimitive[] {
  return [...svg.matchAll(/<path\b[^>]*>/g)]
    .map(match => attributes(match[0]))
    .flatMap(attributes => {
      const strokeWidth = numberAttribute(attributes, "stroke-width") ?? 0;
      return splitPathSubpaths(attributes.d ?? "")
        .flatMap((subpath): GeometryPrimitive[] => {
          const points = pointsFromPathData(subpath);
          if (points.length === 0) return [];

          const bounds = expandBounds(boundsFromPoints(points), strokeWidth / 2);
          const isText = isLikelyTextPath(bounds);
          if (options.ignoreText && isText) return [];

          if (options.pathMode === "polyline") {
            return [{
              kind: "polyline" as const,
              bounds,
              points,
              strokeWidthMm: strokeWidth,
              isText,
            }];
          }

          return [{
            kind: "polygon" as const,
            bounds,
            points: boundsPolygon(bounds),
            isText,
          }];
        });
    });
}

function splitPathSubpaths(pathData: string): string[] {
  return pathData.match(/[Mm][^Mm]*/g) ?? [];
}

function pointsFromPathData(pathData: string): GeometryPoint[] {
  const tokens = pathData.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  const points: GeometryPoint[] = [];
  let index = 0;
  let command = "";
  let current: GeometryPoint = {x: 0, y: 0};

  while (index < tokens.length) {
    const token = tokens[index];
    if (token === undefined) break;
    if (isPathCommand(token)) {
      command = token;
      index += 1;
    }

    const absolute = command === command.toUpperCase();
    switch (command.toUpperCase()) {
      case "M":
      case "L": {
        while (hasNumber(tokens, index + 1)) {
          current = pathPoint(
            readNumber(tokens, index),
            readNumber(tokens, index + 1),
            current,
            absolute
          );
          points.push(current);
          index += 2;
          if (tokens[index] && isPathCommand(tokens[index])) break;
        }
        break;
      }
      case "H": {
        while (hasNumber(tokens, index)) {
          const x = readNumber(tokens, index);
          current = {x: absolute ? x : current.x + x, y: current.y};
          points.push(current);
          index += 1;
          if (tokens[index] && isPathCommand(tokens[index])) break;
        }
        break;
      }
      case "V": {
        while (hasNumber(tokens, index)) {
          const y = readNumber(tokens, index);
          current = {x: current.x, y: absolute ? y : current.y + y};
          points.push(current);
          index += 1;
          if (tokens[index] && isPathCommand(tokens[index])) break;
        }
        break;
      }
      case "C": {
        while (hasNumber(tokens, index + 5)) {
          const control1 = pathPoint(readNumber(tokens, index), readNumber(tokens, index + 1), current, absolute);
          const control2 = pathPoint(readNumber(tokens, index + 2), readNumber(tokens, index + 3), current, absolute);
          current = pathPoint(readNumber(tokens, index + 4), readNumber(tokens, index + 5), current, absolute);
          points.push(control1, control2, current);
          index += 6;
          if (tokens[index] && isPathCommand(tokens[index])) break;
        }
        break;
      }
      case "S":
      case "Q": {
        while (hasNumber(tokens, index + 3)) {
          const control = pathPoint(readNumber(tokens, index), readNumber(tokens, index + 1), current, absolute);
          current = pathPoint(readNumber(tokens, index + 2), readNumber(tokens, index + 3), current, absolute);
          points.push(control, current);
          index += 4;
          if (tokens[index] && isPathCommand(tokens[index])) break;
        }
        break;
      }
      case "T": {
        while (hasNumber(tokens, index + 1)) {
          current = pathPoint(readNumber(tokens, index), readNumber(tokens, index + 1), current, absolute);
          points.push(current);
          index += 2;
          if (tokens[index] && isPathCommand(tokens[index])) break;
        }
        break;
      }
      case "A": {
        while (hasNumber(tokens, index + 6)) {
          const radiusX = Math.abs(readNumber(tokens, index));
          const radiusY = Math.abs(readNumber(tokens, index + 1));
          const end = pathPoint(readNumber(tokens, index + 5), readNumber(tokens, index + 6), current, absolute);
          points.push(
            {x: current.x - radiusX, y: current.y - radiusY},
            {x: current.x + radiusX, y: current.y + radiusY},
            {x: end.x - radiusX, y: end.y - radiusY},
            {x: end.x + radiusX, y: end.y + radiusY},
            end
          );
          current = end;
          index += 7;
          if (tokens[index] && isPathCommand(tokens[index])) break;
        }
        break;
      }
      case "Z":
        break;
      default:
        index += 1;
        break;
    }
  }

  return points;
}

function isPathCommand(token: string): boolean {
  return /^[a-zA-Z]$/.test(token);
}

function hasNumber(tokens: readonly string[], index: number): boolean {
  return index < tokens.length && !isPathCommand(tokens[index] ?? "");
}

function readNumber(tokens: readonly string[], index: number): number {
  return Number(tokens[index] ?? "0");
}

function pathPoint(
  x: number,
  y: number,
  current: GeometryPoint,
  absolute: boolean
): GeometryPoint {
  return absolute ? {x, y} : {x: current.x + x, y: current.y + y};
}

function isLikelyTextPath(bounds: Bounds): boolean {
  return Math.max(boundsWidth(bounds), boundsHeight(bounds)) < silkscreenMinimumFeatureMm;
}

function attributes(tag: string): Record<string, string> {
  return Object.fromEntries(
    [...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(match => [match[1] ?? "", match[2] ?? ""])
  );
}

function numberAttribute(attributes: Record<string, string>, name: string): number | null {
  const value = Number(attributes[name]);
  return Number.isFinite(value) ? value : null;
}

function drillHitPrimitive(hit: DrillHit): GeometryPrimitive {
  const radius = Math.max(hit.diameterMm / 2, 0.04);
  return {
    kind: "circle",
    center: {x: hit.xMm, y: -hit.yMm},
    radiusMm: radius,
    bounds: circleBounds(hit.xMm, -hit.yMm, radius),
    diameterMm: hit.diameterMm,
  };
}

function clonePrimitive(primitive: GeometryPrimitive): GeometryPrimitive {
  if (primitive.kind === "circle") {
    return {
      ...primitive,
      bounds: {...primitive.bounds},
      center: {...primitive.center},
    };
  }

  return {
    ...primitive,
    bounds: {...primitive.bounds},
    points: primitive.points.map(point => ({...point})),
  };
}

function mirrorPrimitiveX(primitive: GeometryPrimitive, viewBox: ViewBox): GeometryPrimitive {
  if (primitive.kind === "circle") {
    const center = mirrorPointX(primitive.center, viewBox);
    return {
      ...primitive,
      center,
      bounds: circleBounds(center.x, center.y, primitive.radiusMm),
    };
  }

  const points = primitive.points.map(point => mirrorPointX(point, viewBox));
  return {
    ...primitive,
    points,
    bounds: boundsFromPoints(points),
  };
}

function mirrorPointX(point: GeometryPoint, viewBox: ViewBox): GeometryPoint {
  const mirrorAxis = 2 * viewBox[0] + viewBox[2];
  return {
    x: mirrorAxis - point.x,
    y: point.y,
  };
}

function circleBounds(cx: number, cy: number, radius: number): Bounds {
  return {
    minX: cx - radius,
    minY: cy - radius,
    maxX: cx + radius,
    maxY: cy + radius,
  };
}

function boundsFromPoints(points: readonly GeometryPoint[]): Bounds {
  return {
    minX: Math.min(...points.map(point => point.x)),
    minY: Math.min(...points.map(point => point.y)),
    maxX: Math.max(...points.map(point => point.x)),
    maxY: Math.max(...points.map(point => point.y)),
  };
}

function expandBounds(bounds: Bounds, amount: number): Bounds {
  return {
    minX: bounds.minX - amount,
    minY: bounds.minY - amount,
    maxX: bounds.maxX + amount,
    maxY: bounds.maxY + amount,
  };
}

function boundsCenter(bounds: Bounds): GeometryPoint {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

function boundsPolygon(bounds: Bounds): GeometryPoint[] {
  return [
    {x: bounds.minX, y: bounds.minY},
    {x: bounds.maxX, y: bounds.minY},
    {x: bounds.maxX, y: bounds.maxY},
    {x: bounds.minX, y: bounds.maxY},
  ];
}

function sizeFromFootprintCode(footprint: string): ViewerComponentSize | null {
  const match = footprint.toUpperCase().match(/(?:^|[_-])(?:R|C|L|LED|D)?(0201|0402|0603|0805|1206|1210|1812|1005|1608|2012|3216)(?:$|[_-])/);
  const code = match?.[1];
  if (!code) return null;

  const sizeByCode: Record<string, [number, number]> = {
    "0201": [0.6, 0.3],
    "0402": [1.0, 0.5],
    "0603": [1.6, 0.8],
    "0805": [2.0, 1.25],
    "1206": [3.2, 1.6],
    "1210": [3.2, 2.5],
    "1812": [4.5, 3.2],
    "1005": [1.0, 0.5],
    "1608": [1.6, 0.8],
    "2012": [2.0, 1.25],
    "3216": [3.2, 1.6],
  };
  const size = sizeByCode[code];

  return size ? withHitArea(size[0], size[1]) : null;
}

function sizeFromExplicitDimensions(footprint: string): ViewerComponentSize | null {
  const upper = footprint.toUpperCase();
  const lengthWidth = /(?:^|[_-])L(\d+(?:\.\d+)?)[_-]W(\d+(?:\.\d+)?)(?:$|[_-])/.exec(upper);
  if (lengthWidth) {
    return withHitArea(Number(lengthWidth[1]), Number(lengthWidth[2]));
  }

  const bodyDiameter = /(?:^|[_-])BD(\d+(?:\.\d+)?)(?:$|[_-])/.exec(upper);
  if (bodyDiameter) {
    const diameter = Number(bodyDiameter[1]);
    return withHitArea(diameter, diameter);
  }

  return null;
}

function normalizeComponentSize(
  estimated: ViewerComponentSize,
  override: Partial<ViewerComponentSize> | null | undefined
): ViewerComponentSize {
  const widthMm = positiveNumber(override?.widthMm) ?? estimated.widthMm;
  const heightMm = positiveNumber(override?.heightMm) ?? estimated.heightMm;
  const fallback = withHitArea(widthMm, heightMm);

  return {
    widthMm,
    heightMm,
    hitWidthMm: positiveNumber(override?.hitWidthMm) ?? Math.max(estimated.hitWidthMm, fallback.hitWidthMm),
    hitHeightMm: positiveNumber(override?.hitHeightMm) ?? Math.max(estimated.hitHeightMm, fallback.hitHeightMm),
  };
}

function withHitArea(widthMm: number, heightMm: number): ViewerComponentSize {
  return {
    widthMm,
    heightMm,
    hitWidthMm: Math.max(widthMm + 0.8, 2.4),
    hitHeightMm: Math.max(heightMm + 0.8, 2.4),
  };
}

function distanceMm(
  left: {xMm: number; yMm: number},
  right: {xMm: number; yMm: number}
): number {
  return Math.hypot(left.xMm - right.xMm, left.yMm - right.yMm);
}

function mirrorX(x: number, viewBox: ViewBox): number {
  return 2 * viewBox[0] + viewBox[2] - x;
}

function displayRotation(
  side: BoardViewerSide | "unknown",
  rotationDeg: number,
  mirrorBottom: boolean
): number {
  return side === "bottom" && mirrorBottom
    ? radians(rotationDeg)
    : -radians(rotationDeg);
}

function normalizeComparable(value: string): string {
  return value.trim().toUpperCase();
}

function positiveNumber(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) return upper;

  return ((sorted[middle - 1] ?? upper) + upper) / 2;
}

function boundsWidth(bounds: Bounds): number {
  return bounds.maxX - bounds.minX;
}

function boundsHeight(bounds: Bounds): number {
  return bounds.maxY - bounds.minY;
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function compareDesignators(left: string, right: string): number {
  const leftParts = splitDesignator(left);
  const rightParts = splitDesignator(right);

  if (leftParts !== null && rightParts !== null) {
    const prefix = leftParts.prefix.localeCompare(rightParts.prefix);
    if (prefix !== 0) return prefix;
    return leftParts.number - rightParts.number;
  }

  return left.localeCompare(right);
}

function splitDesignator(designator: string): {prefix: string; number: number} | null {
  const match = designator.match(/^([A-Za-z]+)(\d+)$/);
  if (!match) return null;

  return {
    prefix: match[1] ?? "",
    number: Number.parseInt(match[2] ?? "0", 10),
  };
}
