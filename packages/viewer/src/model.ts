import type {
  BomCoordinateComponent,
  CoordinateRecord,
  DrillHit,
  Gerber2DProject,
  ViewBox,
} from "@bomboard/parsers";
import {
  resolveFootprintCandidates,
} from "./footprint-library.js";
import packageRulesData from "./package-rules.json" with {type: "json"};
import type {
  CompactFootprintFeature,
  CompactFootprintShape,
  FootprintLibrary,
  FootprintLibraryCandidate,
  FootprintLibraryEntry,
} from "./footprint-library.js";
import type {
  BoardViewerModel,
  BoardViewerOptions,
  BoardViewerSide,
  ComponentSimilarityKeyFn,
  ViewerComponent,
  ViewerComponentElement,
  ViewerComponentSize,
} from "./types.js";

const packageRules = packageRulesData as PackageRules;
const silkscreenMinimumFeatureMm = 1.0;
const geometryCellSizeMm = 5;
const footprintGeometryPaddingMm = 0.18;
const footprintFusionCandidateLimit = 24;
const footprintAnchorMinimumOffsetMm = 0.05;
const footprintAnchorMaxErrorMm = 0.8;
const footprintAnchorSnapMaxErrorMm = 1.5;
const unmatchedComponentDotRadiusMm = 0.45;

interface PackageRules {
  exactPackages: ExactPackageRule[];
  families: PackageFamilyRule[];
  designatorDefaults: DesignatorDefaultRule[];
  geometryFallback: {
    padSourcePriority: ComponentGeometrySource[];
    smdPaddingMm: number;
    throughHolePaddingMm: number;
    minimumComponentHoleMm: number;
  };
}

interface ExactPackageRule {
  name: string;
  aliases?: string[];
  bodyMm: number[];
  defaultPadCount?: number;
}

interface PackageFamilyRule {
  name: string;
  pattern?: string;
  prefixes?: string[];
  pinCountGroup: number;
}

interface DesignatorDefaultRule {
  prefixes: string[];
  bodyMm: number[];
  defaultPadCount?: number;
}

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
    source?: ComponentGeometrySource;
  }
  | {
    kind: "polygon";
    bounds: Bounds;
    points: GeometryPoint[];
    diameterMm?: number;
    isText?: boolean;
    source?: ComponentGeometrySource;
  }
  | {
    kind: "polyline";
    bounds: Bounds;
    points: GeometryPoint[];
    strokeWidthMm: number;
    diameterMm?: number;
    isText?: boolean;
    source?: ComponentGeometrySource;
  };

interface GeometryIndex {
  pads: Record<BoardViewerSide, GeometryPrimitiveSpatialIndex>;
  holes: Record<BoardViewerSide, GeometryPrimitiveSpatialIndex>;
}

type ComponentGeometrySource = "padMaster" | "solderMask" | "paste" | "copper";

interface GeometryPrimitiveSpatialIndex {
  primitives: readonly GeometryPrimitive[];
  cellSizeMm: number;
  cells: Map<string, GeometryPrimitive[]>;
}

interface GeometryMatch {
  size: ViewerComponentSize;
  elements: ViewerComponentElement[];
}

interface FootprintFeature {
  type: "pad" | "hole" | "via";
  designator: string;
  highlight: boolean;
  element: ViewerComponentElement;
  bounds: Bounds;
}

interface FootprintFusion {
  match: GeometryMatch;
  matchedCount: number;
  featureCount: number;
  score: number;
}

export function createBoardViewerModel(
  options: Pick<
    BoardViewerOptions,
    "bomCoordinates" | "gerber" | "getComponentSize" | "getSimilarityKey" | "mirrorBottom" | "footprintLibrary"
  >
): BoardViewerModel {
  const viewBox = options.gerber.fragments.boardShapeRenderFragment.viewBox as ViewBox;
  const getSimilarityKey = options.getSimilarityKey ?? defaultComponentSimilarityKey;
  const mirrorBottom = options.mirrorBottom !== false;
  const geometry = createGeometryIndex(options.gerber, viewBox, mirrorBottom);
  const components = options.bomCoordinates.components
    .flatMap(component => toViewerComponent(
      component,
      viewBox,
      mirrorBottom,
      geometry,
      options.footprintLibrary,
      getSimilarityKey,
      options.getComponentSize
    ))
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
  footprintLibrary: FootprintLibrary | undefined,
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
  const sideHoles = side === "bottom" ? geometry.holes.bottom : geometry.holes.top;
  const sidePads = side === "bottom" ? geometry.pads.bottom : geometry.pads.top;
  const geometryMatch = matchFootprintLibraryGeometry(
    component,
    footprintLibrary,
    displayPosition,
    rotation,
    side,
    mirrorBottom,
    displayPadPosition,
    sideHoles,
    sidePads
  );
  const size = normalizeComponentSize(
    geometryMatch?.size ?? estimatedSize,
    getComponentSize?.(component)
  );
  const similarityKey = getSimilarityKey(component) ?? component.designator;
  const highlightElements = geometryMatch?.elements.length
    ? geometryMatch.elements
    : unmatchedComponentDotElements();

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
      highlightElements,
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
  const exactSize = sizeFromExactPackage(footprint);
  if (exactSize) return exactSize;

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
  const designatorDefault = designatorDefaultRule(designatorPrefix);
  if (designatorDefault) return withHitArea(designatorDefault.bodyMm[0] ?? 1.6, designatorDefault.bodyMm[1] ?? 0.9);

  return withHitArea(3.2, 2.4);
}

function matchFootprintLibraryGeometry(
  component: BomCoordinateComponent,
  footprintLibrary: FootprintLibrary | undefined,
  displayPosition: {x: number; y: number},
  rotation: number,
  side: BoardViewerSide | "unknown",
  mirrorBottom: boolean,
  displayPadPosition: {x: number; y: number},
  holes: GeometryPrimitiveSpatialIndex,
  pads: GeometryPrimitiveSpatialIndex
): GeometryMatch | null {
  const expectedPins = expectedComponentPrimitiveCount(component);
  const candidates = resolveFootprintCandidates(footprintLibrary, component)
    .slice(0, footprintFusionCandidateLimit);
  if (candidates.length === 0) return null;

  const fusions = candidates
    .map(candidate => fuseFootprintCandidate(
      component,
      candidate,
      displayPosition,
      displayPadPosition,
      rotation,
      side,
      mirrorBottom,
      holes,
      pads,
      expectedPins
    ))
    .filter((fusion): fusion is FootprintFusion => fusion !== null)
    .sort((left, right) => left.score - right.score);

  const selected = fusions[0];
  if (!selected) return null;

  return selected.match;
}

function fuseFootprintCandidate(
  component: BomCoordinateComponent,
  candidate: FootprintLibraryCandidate,
  displayPosition: {x: number; y: number},
  displayPadPosition: {x: number; y: number},
  rotation: number,
  side: BoardViewerSide | "unknown",
  mirrorBottom: boolean,
  holes: GeometryPrimitiveSpatialIndex,
  pads: GeometryPrimitiveSpatialIndex,
  expectedPins: number | null
): FootprintFusion | null {
  if (!candidateMatchesExplicitDimensions(component, candidate.entry)) return null;

  const features = footprintFeatures(candidate.entry, side, mirrorBottom);
  if (features.length === 0) return null;

  const usedPads = new Set<GeometryPrimitive>();
  const usedHoles = new Set<GeometryPrimitive>();
  const elements: ViewerComponentElement[] = [];
  const allowPadHoleFallback = candidate.entry.holes.length > 0;
  const searchPosition = footprintSearchPosition(
    features,
    displayPosition,
    displayPadPosition,
    rotation
  );
  let matchedCount = 0;
  let primitiveScore = 0;
  let sourcePenalty = 0;

  for (const feature of features) {
    let primitiveMatch = findBestPrimitiveForFootprintFeature(
      feature,
      searchPosition,
      rotation,
      feature.type === "pad" ? pads : holes,
      feature.type === "pad" ? usedPads : usedHoles
    );
    let primitiveSet = feature.type === "pad" ? usedPads : usedHoles;

    if (!primitiveMatch && feature.type === "pad" && feature.highlight && allowPadHoleFallback) {
      primitiveMatch = findNearestHoleForFootprintPad(
        feature,
        searchPosition,
        rotation,
        holes,
        usedHoles
      );
      primitiveSet = usedHoles;
    }

    if (primitiveMatch) {
      primitiveSet.add(primitiveMatch.primitive);
      if (feature.highlight) {
        elements.push(toViewerComponentElement(primitiveMatch.primitive, displayPosition, rotation));
      }
      matchedCount += 1;
      primitiveScore += primitiveMatch.score;
      sourcePenalty = Math.max(sourcePenalty, primitiveSourcePenalty(primitiveMatch.primitive.source));
    }
  }

  if (elements.length === 0) return null;

  const localUnion = elements
    .map(viewerComponentElementBounds)
    .reduce((union, bounds) => ({
      minX: Math.min(union.minX, bounds.minX),
      minY: Math.min(union.minY, bounds.minY),
      maxX: Math.max(union.maxX, bounds.maxX),
      maxY: Math.max(union.maxY, bounds.maxY),
    }));
  const widthMm = Math.max(
    0.6,
    (Math.max(Math.abs(localUnion.minX), Math.abs(localUnion.maxX)) + footprintGeometryPaddingMm) * 2
  );
  const heightMm = Math.max(
    0.6,
    (Math.max(Math.abs(localUnion.minY), Math.abs(localUnion.maxY)) + footprintGeometryPaddingMm) * 2
  );
  const unmatchedRatio = (features.length - matchedCount) / features.length;
  const averagePrimitiveScore = matchedCount > 0 ? primitiveScore / matchedCount : 0;
  const libraryPins = footprintPinCount(candidate.entry) ?? candidate.entry.pads.length;
  const pinCountPenalty = footprintPinCountPenalty(libraryPins, expectedPins);
  const highlightCountPenalty = footprintHighlightCountPenalty(elements.length, expectedPins);
  const anchor = footprintAnchor(features, searchPosition, displayPadPosition, rotation);
  const anchorPenalty = anchor && hasExplicitPadAnchor(displayPosition, displayPadPosition)
    ? footprintAnchorPenalty(anchor.errorMm)
    : 0;

  return {
    matchedCount,
    featureCount: features.length,
    score: candidate.score * 1000
      + pinCountPenalty
      + highlightCountPenalty
      + sourcePenalty
      + unmatchedRatio * 1000
      + averagePrimitiveScore
      + anchorPenalty,
    match: {
      size: withHitArea(widthMm, heightMm),
      elements,
    },
  };
}

function footprintSearchPosition(
  features: readonly FootprintFeature[],
  displayPosition: {x: number; y: number},
  displayPadPosition: {x: number; y: number},
  rotation: number
): {x: number; y: number} {
  if (!hasExplicitPadAnchor(displayPosition, displayPadPosition)) return displayPosition;

  const anchorFeature = selectClosestPadAnchorFeature(
    features,
    displayPosition,
    displayPadPosition,
    rotation
  );
  if (!anchorFeature) return displayPosition;

  const projectedAnchor = fromLocalPoint(
    boundsCenter(anchorFeature.bounds),
    displayPosition,
    rotation
  );
  const offsetX = displayPadPosition.x - projectedAnchor.x;
  const offsetY = displayPadPosition.y - projectedAnchor.y;

  return {
    x: displayPosition.x + offsetX,
    y: displayPosition.y + offsetY,
  };
}

function selectClosestPadAnchorFeature(
  features: readonly FootprintFeature[],
  displayPosition: {x: number; y: number},
  displayPadPosition: {x: number; y: number},
  rotation: number
): FootprintFeature | null {
  const candidates = features
    .filter(feature => feature.type === "pad" && feature.highlight)
    .map(feature => {
      const projected = fromLocalPoint(boundsCenter(feature.bounds), displayPosition, rotation);
      return {
        feature,
        distance: Math.hypot(projected.x - displayPadPosition.x, projected.y - displayPadPosition.y),
      };
    })
    .sort((left, right) => left.distance - right.distance);
  const closest = candidates[0];
  if (closest && closest.distance <= footprintAnchorSnapMaxErrorMm) return closest.feature;

  return null;
}

function candidateMatchesExplicitDimensions(
  component: BomCoordinateComponent,
  entry: FootprintLibraryEntry
): boolean {
  const componentDimensions = explicitPackageDimensions(
    `${component.placement?.footprint ?? ""} ${component.bom?.footprint ?? ""}`
  );
  if (!componentDimensions) return true;

  const entryDimensions = explicitPackageDimensions(entry.name);
  if (!entryDimensions) return true;

  const lengthWidthCompatible = dimensionsClose(componentDimensions.lengthMm, entryDimensions.lengthMm)
    && dimensionsClose(componentDimensions.widthMm, entryDimensions.widthMm);
  const lengthWidthSwapped = dimensionsClose(componentDimensions.lengthMm, entryDimensions.widthMm)
    && dimensionsClose(componentDimensions.widthMm, entryDimensions.lengthMm);
  if (!lengthWidthCompatible && !lengthWidthSwapped) return false;

  if (componentDimensions.pitchMm !== null && entryDimensions.pitchMm !== null) {
    return Math.abs(componentDimensions.pitchMm - entryDimensions.pitchMm) <= 0.08;
  }

  return true;
}

function explicitPackageDimensions(text: string): {lengthMm: number; widthMm: number; pitchMm: number | null} | null {
  const upper = text.toUpperCase();
  const lengthWidth = /(?:^|[_\-\s])L(\d+(?:\.\d+)?)[_\-\s]W(\d+(?:\.\d+)?)(?:$|[_\-\s])/.exec(upper);
  if (!lengthWidth) return null;

  const pitch = /(?:^|[_\-\s])P(\d+(?:\.\d+)?)(?:$|[_\-\s])/.exec(upper);
  return {
    lengthMm: Number(lengthWidth[1]),
    widthMm: Number(lengthWidth[2]),
    pitchMm: pitch ? Number(pitch[1]) : null,
  };
}

function dimensionsClose(leftMm: number, rightMm: number): boolean {
  const toleranceMm = Math.max(0.25, Math.max(leftMm, rightMm) * 0.08);
  return Math.abs(leftMm - rightMm) <= toleranceMm;
}

function hasExplicitPadAnchor(
  displayPosition: {x: number; y: number},
  displayPadPosition: {x: number; y: number}
): boolean {
  return Math.hypot(displayPosition.x - displayPadPosition.x, displayPosition.y - displayPadPosition.y)
    > footprintAnchorMinimumOffsetMm;
}

function footprintAnchorPenalty(errorMm: number): number {
  const excess = Math.max(0, errorMm - footprintAnchorMaxErrorMm);
  return errorMm * 80 + excess * 220;
}

function footprintAnchor(
  features: readonly FootprintFeature[],
  displayPosition: {x: number; y: number},
  displayPadPosition: {x: number; y: number},
  rotation: number
): {pin: string; errorMm: number} | null {
  const anchorFeature = selectAnchorFeature(features);
  if (!anchorFeature) return null;

  const projected = fromLocalPoint(
    boundsCenter(anchorFeature.bounds),
    displayPosition,
    rotation
  );
  return {
    pin: anchorFeature.designator,
    errorMm: Math.hypot(projected.x - displayPadPosition.x, projected.y - displayPadPosition.y),
  };
}

function selectAnchorFeature(
  features: readonly FootprintFeature[]
): FootprintFeature | null {
  const pins = features.filter(feature => feature.type === "pad" && feature.highlight);
  return pins.find(feature => normalizedFootprintPin(feature.designator) === "1")
    ?? pins.find(feature => normalizedFootprintPin(feature.designator) === "A1")
    ?? pins[0]
    ?? null;
}

function findBestPrimitiveForFootprintFeature(
  feature: FootprintFeature,
  displayPosition: {x: number; y: number},
  rotation: number,
  primitiveIndex: GeometryPrimitiveSpatialIndex,
  usedPrimitives: Set<GeometryPrimitive>
): {primitive: GeometryPrimitive; score: number} | null {
  const tolerance = footprintFeatureTolerance(feature);
  const worldBounds = expandBounds(
    localBoundsToWorldBounds(feature.bounds, displayPosition, rotation),
    tolerance
  );
  const candidates = querySpatialIndex(primitiveIndex, worldBounds)
    .filter(primitive => !usedPrimitives.has(primitive))
    .map(primitive => ({
      primitive,
      score: footprintPrimitiveScore(
        feature,
        toLocalBounds(primitive.bounds, displayPosition, rotation),
        primitive
      ),
    }))
    .filter((candidate): candidate is {primitive: GeometryPrimitive; score: number} => candidate.score !== null)
    .sort((left, right) => left.score - right.score);

  return candidates[0] ?? null;
}

function findNearestHoleForFootprintPad(
  feature: FootprintFeature,
  displayPosition: {x: number; y: number},
  rotation: number,
  holes: GeometryPrimitiveSpatialIndex,
  usedHoles: Set<GeometryPrimitive>
): {primitive: GeometryPrimitive; score: number} | null {
  const featureCenter = boundsCenter(feature.bounds);
  const worldCenter = fromLocalPoint(featureCenter, displayPosition, rotation);
  const tolerance = footprintHoleFallbackTolerance(feature);
  const candidates = querySpatialIndex(holes, circleBounds(worldCenter.x, worldCenter.y, tolerance))
    .filter(primitive => !usedHoles.has(primitive))
    .map(primitive => {
      const center = boundsCenter(primitive.bounds);
      const distance = Math.hypot(worldCenter.x - center.x, worldCenter.y - center.y);
      return {primitive, score: distance * 20};
    })
    .filter(candidate => candidate.score <= tolerance * 20)
    .sort((left, right) => left.score - right.score);

  return candidates[0] ?? null;
}

function footprintPrimitiveScore(
  feature: FootprintFeature,
  primitiveLocalBounds: Bounds,
  primitive: GeometryPrimitive
): number | null {
  const expectedCenter = boundsCenter(feature.bounds);
  const primitiveCenter = boundsCenter(primitiveLocalBounds);
  const centerDistance = Math.hypot(
    expectedCenter.x - primitiveCenter.x,
    expectedCenter.y - primitiveCenter.y
  );
  const tolerance = footprintFeatureTolerance(feature);
  if (centerDistance > tolerance) return null;

  const expectedWidth = Math.max(boundsWidth(feature.bounds), 0.02);
  const expectedHeight = Math.max(boundsHeight(feature.bounds), 0.02);
  const primitiveWidth = Math.max(boundsWidth(primitiveLocalBounds), 0.02);
  const primitiveHeight = Math.max(boundsHeight(primitiveLocalBounds), 0.02);
  if (!footprintPrimitiveShapeCompatible(feature, primitive, expectedWidth, expectedHeight, primitiveWidth, primitiveHeight)) {
    return null;
  }

  const expectedArea = expectedWidth * expectedHeight;
  const primitiveArea = primitiveWidth * primitiveHeight;
  const areaRatio = Math.max(expectedArea, primitiveArea) / Math.max(Math.min(expectedArea, primitiveArea), 0.0001);
  if (areaRatio > (feature.type === "pad" ? 18 : 28)) return null;

  const sizeError = Math.abs(Math.log(primitiveWidth / expectedWidth))
    + Math.abs(Math.log(primitiveHeight / expectedHeight));
  return centerDistance * 12 + sizeError;
}

function footprintPrimitiveShapeCompatible(
  feature: FootprintFeature,
  primitive: GeometryPrimitive,
  expectedWidth: number,
  expectedHeight: number,
  primitiveWidth: number,
  primitiveHeight: number
): boolean {
  if (feature.type !== "pad") return true;
  if (feature.element.kind === "polygon" && primitive.kind === "circle") return false;

  const oversizeRatio = Math.max(primitiveWidth / expectedWidth, primitiveHeight / expectedHeight);
  return oversizeRatio <= primitiveOversizeLimit(primitive.source);
}

function primitiveOversizeLimit(source: ComponentGeometrySource | undefined): number {
  switch (source) {
    case "copper":
      return 1.8;
    case "solderMask":
      return 2.4;
    default:
      return 3.0;
  }
}

function primitiveSourcePenalty(source: ComponentGeometrySource | undefined): number {
  switch (source) {
    case "padMaster":
      return 0;
    case "paste":
      return 0;
    case "solderMask":
      return 3000;
    case "copper":
      return 50000;
    default:
      return 0;
  }
}

function footprintFeatureTolerance(feature: FootprintFeature): number {
  const featureSize = Math.max(boundsWidth(feature.bounds), boundsHeight(feature.bounds));
  return feature.type === "pad"
    ? clamp(featureSize * 0.7, 0.14, 0.8)
    : clamp(featureSize * 0.9, 0.2, 1.4);
}

function footprintHoleFallbackTolerance(feature: FootprintFeature): number {
  const featureSize = Math.max(boundsWidth(feature.bounds), boundsHeight(feature.bounds));
  return clamp(featureSize * 0.85, 0.24, 1.5);
}

function footprintFeatures(
  entry: FootprintLibraryEntry,
  side: BoardViewerSide | "unknown",
  mirrorBottom: boolean
): FootprintFeature[] {
  return [
    ...entry.pads.map(feature => footprintFeature(feature, "pad", isNamedFootprintPin(feature[0]), side, mirrorBottom)),
    ...entry.holes.map(feature => footprintFeature(feature, "hole", false, side, mirrorBottom)),
    ...entry.vias.map(feature => footprintFeature(feature, "via", false, side, mirrorBottom)),
  ].filter((feature): feature is FootprintFeature => feature !== null);
}

function footprintPinCount(entry: FootprintLibraryEntry): number | null {
  return entry.pads.length > 0 ? entry.pads.length : null;
}

function footprintPinCountPenalty(
  libraryPins: number | null,
  expectedPins: number | null
): number {
  if (!libraryPins || !expectedPins) return 0;

  const difference = Math.abs(libraryPins - expectedPins);
  if (difference === 0) return 0;

  const relativeDifference = difference / Math.max(libraryPins, expectedPins);
  return difference * 2500 + relativeDifference * 1000;
}

function footprintHighlightCountPenalty(
  highlightedPins: number,
  expectedPins: number | null
): number {
  if (!expectedPins) return 0;

  const missingPins = Math.max(0, expectedPins - highlightedPins);
  const extraPins = Math.max(0, highlightedPins - expectedPins);
  return missingPins * 60000 + extraPins * 40000;
}

function isNamedFootprintPin(value: string): boolean {
  return normalizedFootprintPin(value) !== null;
}

function normalizedFootprintPin(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return normalized === "" ? null : normalized;
}

function footprintFeature(
  feature: CompactFootprintFeature,
  type: FootprintFeature["type"],
  highlight: boolean,
  side: BoardViewerSide | "unknown",
  mirrorBottom: boolean
): FootprintFeature | null {
  const [designator, xMm, yMm, rotationDeg, shape] = feature;
  const element = footprintShapeElement(
    shape,
    {x: xMm, y: yMm},
    radians(rotationDeg),
    side,
    mirrorBottom
  );
  if (!element) return null;

  return {
    type,
    designator,
    highlight,
    element,
    bounds: viewerComponentElementBounds(element),
  };
}

function footprintShapeElement(
  shape: CompactFootprintShape,
  position: GeometryPoint,
  rotation: number,
  side: BoardViewerSide | "unknown",
  mirrorBottom: boolean
): ViewerComponentElement | null {
  if (shape[0] === "circle") {
    const center = transformFootprintShapePoint(
      {x: shape[1], y: shape[2]},
      position,
      rotation,
      side,
      mirrorBottom
    );
    return {
      kind: "circle",
      center,
      radiusMm: shape[3],
    };
  }

  const points = footprintShapePoints(shape);
  if (points.length < 3) return null;

  return {
    kind: "polygon",
    points: points.map(point => transformFootprintShapePoint(point, position, rotation, side, mirrorBottom)),
  };
}

function footprintShapePoints(shape: CompactFootprintShape): GeometryPoint[] {
  if (shape[0] === "rect" || shape[0] === "roundRect") {
    return [
      {x: shape[1], y: shape[2]},
      {x: shape[3], y: shape[2]},
      {x: shape[3], y: shape[4]},
      {x: shape[1], y: shape[4]},
    ];
  }

  if (shape[0] === "polygon") {
    const points: GeometryPoint[] = [];
    for (let index = 0; index < shape[1].length - 1; index += 2) {
      points.push({x: shape[1][index] ?? 0, y: shape[1][index + 1] ?? 0});
    }
    return points;
  }

  return [];
}

function transformFootprintShapePoint(
  point: GeometryPoint,
  position: GeometryPoint,
  rotation: number,
  side: BoardViewerSide | "unknown",
  mirrorBottom: boolean
): GeometryPoint {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const boardPoint = {
    x: position.x + point.x * cos - point.y * sin,
    y: position.y + point.x * sin + point.y * cos,
  };

  return {
    x: side === "bottom" && mirrorBottom ? -boardPoint.x : boardPoint.x,
    y: side === "bottom" && mirrorBottom ? boardPoint.y : -boardPoint.y,
  };
}

function viewerComponentElementBounds(element: ViewerComponentElement): Bounds {
  if (element.kind === "circle") {
    return circleBounds(element.center.x, element.center.y, element.radiusMm);
  }

  if (element.kind === "polyline") {
    return expandBounds(boundsFromPoints(element.points), element.strokeWidthMm / 2);
  }

  return boundsFromPoints(element.points);
}

function localBoundsToWorldBounds(
  bounds: Bounds,
  displayPosition: {x: number; y: number},
  rotation: number
): Bounds {
  return boundsFromPoints([
    fromLocalPoint({x: bounds.minX, y: bounds.minY}, displayPosition, rotation),
    fromLocalPoint({x: bounds.maxX, y: bounds.minY}, displayPosition, rotation),
    fromLocalPoint({x: bounds.maxX, y: bounds.maxY}, displayPosition, rotation),
    fromLocalPoint({x: bounds.minX, y: bounds.maxY}, displayPosition, rotation),
  ]);
}

function expectedComponentPrimitiveCount(component: BomCoordinateComponent): number | null {
  const bomPins = positiveNumber(component.bom?.pins ?? undefined);
  if (bomPins) return Math.round(bomPins);

  const placementPins = positiveNumber(component.placement?.pins ?? undefined);
  if (placementPins) return Math.round(placementPins);

  const footprint = `${component.placement?.footprint ?? ""} ${component.bom?.footprint ?? ""}`;
  const exactPackage = exactPackageRuleFromText(footprint);
  if (exactPackage?.defaultPadCount) return exactPackage.defaultPadCount;

  const comment = `${component.placement?.comment ?? ""} ${component.bom?.comment ?? ""}`;
  const parsedCount = pinCountFromPackageText(`${footprint} ${comment}`);
  if (parsedCount) return parsedCount;

  const prefix = component.designator.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? "";
  return designatorDefaultRule(prefix)?.defaultPadCount ?? null;
}

function pinCountFromPackageText(text: string): number | null {
  const normalized = text.toUpperCase();

  for (const rule of packageRules.families) {
    const match = normalized.match(packageFamilyRegExp(rule));
    if (match) return boundedPinCount(match[rule.pinCountGroup]);

  }

  return null;
}

function packageFamilyRegExp(rule: PackageFamilyRule): RegExp {
  if (rule.pattern) return new RegExp(rule.pattern);

  const prefixes = (rule.prefixes ?? [])
    .map(escapeRegExp)
    .sort((left, right) => right.length - left.length)
    .join("|");
  return new RegExp(`(?:^|[^A-Z0-9])(?:${prefixes})[-_ ]*(\\d{1,4})(?=$|[^A-Z0-9])`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function boundedPinCount(value: string | undefined): number | null {
  if (!value) return null;

  const count = Number(value);
  return Number.isInteger(count) && count >= 2 && count <= 2000 ? count : null;
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

function unmatchedComponentDotElements(): ViewerComponentElement[] {
  return [
    {
      kind: "circle",
      center: {x: 0, y: 0},
      radiusMm: unmatchedComponentDotRadiusMm,
    },
  ];
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

function fromLocalPoint(
  point: GeometryPoint,
  displayPosition: {x: number; y: number},
  rotation: number
): GeometryPoint {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  return {
    x: displayPosition.x + point.x * cos - point.y * sin,
    y: displayPosition.y + point.x * sin + point.y * cos,
  };
}

function createGeometryIndex(
  project: Gerber2DProject,
  viewBox: ViewBox,
  mirrorBottom: boolean
): GeometryIndex {
  type RenderLayer = Gerber2DProject["fragments"]["layers"][number];
  const padSources: Record<BoardViewerSide, Record<ComponentGeometrySource, RenderLayer[]>> = {
    top: {padMaster: [], solderMask: [], paste: [], copper: []},
    bottom: {padMaster: [], solderMask: [], paste: [], copper: []},
  };

  for (const layer of project.fragments.layers) {
    const classification = project.layerClassificationsById[layer.id];
    if (!classification) continue;
    const geometrySource = componentGeometrySource(classification.kind);
    if (geometrySource === null) continue;
    if (classification.side !== "top" && classification.side !== "bottom") continue;

    padSources[classification.side][geometrySource].push(layer);
  }

  const topHoles = project.drills.flatMap(parsed => parsed.hits.map(drillHitPrimitive));
  const bottomHoles = mirrorBottom
    ? topHoles.map(primitive => mirrorPrimitiveX(primitive, viewBox))
    : topHoles.map(primitive => clonePrimitive(primitive));

  return {
    pads: {
      top: createPrimitiveSpatialIndex(extractPadPrimitives(project, padSources.top, "top", viewBox, mirrorBottom)),
      bottom: createPrimitiveSpatialIndex(extractPadPrimitives(project, padSources.bottom, "bottom", viewBox, mirrorBottom)),
    },
    holes: {
      top: createPrimitiveSpatialIndex(topHoles),
      bottom: createPrimitiveSpatialIndex(bottomHoles),
    },
  };
}

function componentGeometrySource(kind: string): ComponentGeometrySource | null {
  if (kind === "padMaster") return "padMaster";
  if (kind === "solderMask") return "solderMask";
  if (kind === "paste") return "paste";
  if (kind === "copper") return "copper";
  return null;
}

function extractPadPrimitives(
  project: Gerber2DProject,
  sources: Record<ComponentGeometrySource, Gerber2DProject["fragments"]["layers"][number][]>,
  side: BoardViewerSide,
  viewBox: ViewBox,
  mirrorBottom: boolean
): GeometryPrimitive[] {
  return padPrimitiveSources(sources).flatMap(source => {
    const layers = sources[source] ?? [];

    return layers.flatMap(layer => {
      const fragment = project.fragments.svgFragmentsById[layer.id] ?? "";
      const layerPrimitives = extractSvgPrimitives(fragment)
        .filter(primitive => boundsWidth(primitive.bounds) < viewBox[2] * 0.5 && boundsHeight(primitive.bounds) < viewBox[3] * 0.5)
        .map(primitive => withPrimitiveSource(primitive, source));

      return side === "bottom" && mirrorBottom
        ? layerPrimitives.map(primitive => mirrorPrimitiveX(primitive, viewBox))
        : layerPrimitives;
    });
  });
}

function padPrimitiveSources(
  sources: Record<ComponentGeometrySource, Gerber2DProject["fragments"]["layers"][number][]>
): ComponentGeometrySource[] {
  return packageRules.geometryFallback.padSourcePriority
    .filter(source => sources[source].length > 0);
}

function withPrimitiveSource(
  primitive: GeometryPrimitive,
  source: ComponentGeometrySource
): GeometryPrimitive {
  return {...primitive, source};
}

function createPrimitiveSpatialIndex(
  primitives: readonly GeometryPrimitive[]
): GeometryPrimitiveSpatialIndex {
  const cells = new Map<string, GeometryPrimitive[]>();

  for (const primitive of primitives) {
    forEachCell(primitive.bounds, geometryCellSizeMm, (cellX, cellY) => {
      const key = cellKey(cellX, cellY);
      const cell = cells.get(key);
      if (cell) {
        cell.push(primitive);
      } else {
        cells.set(key, [primitive]);
      }
    });
  }

  return {
    primitives,
    cellSizeMm: geometryCellSizeMm,
    cells,
  };
}

function querySpatialIndex(
  index: GeometryPrimitiveSpatialIndex,
  bounds: Bounds
): GeometryPrimitive[] {
  if (index.primitives.length === 0) return [];

  const results = new Set<GeometryPrimitive>();
  forEachCell(bounds, index.cellSizeMm, (cellX, cellY) => {
    const cell = index.cells.get(cellKey(cellX, cellY));
    if (!cell) return;

    for (const primitive of cell) {
      if (boundsOverlap(primitive.bounds, bounds)) results.add(primitive);
    }
  });

  return [...results];
}

function forEachCell(
  bounds: Bounds,
  cellSizeMm: number,
  callback: (cellX: number, cellY: number) => void
): void {
  const minX = Math.floor(bounds.minX / cellSizeMm);
  const maxX = Math.floor(bounds.maxX / cellSizeMm);
  const minY = Math.floor(bounds.minY / cellSizeMm);
  const maxY = Math.floor(bounds.maxY / cellSizeMm);

  for (let cellY = minY; cellY <= maxY; cellY += 1) {
    for (let cellX = minX; cellX <= maxX; cellX += 1) {
      callback(cellX, cellY);
    }
  }
}

function cellKey(cellX: number, cellY: number): string {
  return `${cellX}:${cellY}`;
}

function boundsOverlap(left: Bounds, right: Bounds): boolean {
  return left.maxX >= right.minX
    && left.minX <= right.maxX
    && left.maxY >= right.minY
    && left.minY <= right.maxY;
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
          const fill = (attributes.fill ?? "").trim().toLowerCase();
          const strokeOnly = strokeWidth > 0 && (fill === "" || fill === "none");

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
            points: strokeOnly ? boundsPolygon(bounds) : points,
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
  let subpathStart: GeometryPoint | null = null;

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
        let firstMove = command.toUpperCase() === "M";
        while (hasNumber(tokens, index + 1)) {
          current = pathPoint(
            readNumber(tokens, index),
            readNumber(tokens, index + 1),
            current,
            absolute
          );
          points.push(current);
          if (firstMove) {
            subpathStart = current;
            firstMove = false;
          }
          index += 2;
          if (tokens[index] && isPathCommand(tokens[index])) break;
        }
        if (command.toUpperCase() === "M") command = absolute ? "L" : "l";
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
          const end = pathPoint(readNumber(tokens, index + 4), readNumber(tokens, index + 5), current, absolute);
          points.push(...sampleCubicBezier(current, control1, control2, end));
          current = end;
          index += 6;
          if (tokens[index] && isPathCommand(tokens[index])) break;
        }
        break;
      }
      case "S":
      case "Q": {
        while (hasNumber(tokens, index + 3)) {
          const control = pathPoint(readNumber(tokens, index), readNumber(tokens, index + 1), current, absolute);
          const end = pathPoint(readNumber(tokens, index + 2), readNumber(tokens, index + 3), current, absolute);
          points.push(...sampleQuadraticBezier(current, control, end));
          current = end;
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
          const axisRotation = readNumber(tokens, index + 2);
          const largeArcFlag = readNumber(tokens, index + 3) !== 0;
          const sweepFlag = readNumber(tokens, index + 4) !== 0;
          const end = pathPoint(readNumber(tokens, index + 5), readNumber(tokens, index + 6), current, absolute);
          points.push(...sampleSvgArc(current, radiusX, radiusY, axisRotation, largeArcFlag, sweepFlag, end));
          current = end;
          index += 7;
          if (tokens[index] && isPathCommand(tokens[index])) break;
        }
        break;
      }
      case "Z": {
        if (subpathStart) {
          current = subpathStart;
          points.push(current);
        }
        if (tokens[index] !== undefined && !isPathCommand(tokens[index] ?? "")) index += 1;
        break;
      }
      default:
        index += 1;
        break;
    }
  }

  return points;
}

function sampleCubicBezier(
  start: GeometryPoint,
  control1: GeometryPoint,
  control2: GeometryPoint,
  end: GeometryPoint
): GeometryPoint[] {
  const points: GeometryPoint[] = [];
  for (let index = 1; index <= 12; index += 1) {
    const t = index / 12;
    const mt = 1 - t;
    points.push({
      x: mt * mt * mt * start.x
        + 3 * mt * mt * t * control1.x
        + 3 * mt * t * t * control2.x
        + t * t * t * end.x,
      y: mt * mt * mt * start.y
        + 3 * mt * mt * t * control1.y
        + 3 * mt * t * t * control2.y
        + t * t * t * end.y,
    });
  }

  return points;
}

function sampleQuadraticBezier(
  start: GeometryPoint,
  control: GeometryPoint,
  end: GeometryPoint
): GeometryPoint[] {
  const points: GeometryPoint[] = [];
  for (let index = 1; index <= 10; index += 1) {
    const t = index / 10;
    const mt = 1 - t;
    points.push({
      x: mt * mt * start.x + 2 * mt * t * control.x + t * t * end.x,
      y: mt * mt * start.y + 2 * mt * t * control.y + t * t * end.y,
    });
  }

  return points;
}

function sampleSvgArc(
  start: GeometryPoint,
  radiusX: number,
  radiusY: number,
  axisRotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  end: GeometryPoint
): GeometryPoint[] {
  if (radiusX <= 0 || radiusY <= 0) return [end];
  if (Math.hypot(end.x - start.x, end.y - start.y) < 0.000001) return [end];

  const phi = radians(axisRotationDeg);
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (start.x - end.x) / 2;
  const dy = (start.y - end.y) / 2;
  const x1Prime = cosPhi * dx + sinPhi * dy;
  const y1Prime = -sinPhi * dx + cosPhi * dy;
  let rx = Math.abs(radiusX);
  let ry = Math.abs(radiusY);

  const radiusScale = (x1Prime * x1Prime) / (rx * rx) + (y1Prime * y1Prime) / (ry * ry);
  if (radiusScale > 1) {
    const scale = Math.sqrt(radiusScale);
    rx *= scale;
    ry *= scale;
  }

  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const x1Prime2 = x1Prime * x1Prime;
  const y1Prime2 = y1Prime * y1Prime;
  const denominator = rx2 * y1Prime2 + ry2 * x1Prime2;
  if (denominator === 0) return [end];

  const sign = largeArc === sweep ? -1 : 1;
  const centerScale = sign * Math.sqrt(Math.max(
    0,
    (rx2 * ry2 - rx2 * y1Prime2 - ry2 * x1Prime2) / denominator
  ));
  const cxPrime = centerScale * (rx * y1Prime / ry);
  const cyPrime = centerScale * (-ry * x1Prime / rx);
  const center = {
    x: cosPhi * cxPrime - sinPhi * cyPrime + (start.x + end.x) / 2,
    y: sinPhi * cxPrime + cosPhi * cyPrime + (start.y + end.y) / 2,
  };
  const startVector = {
    x: (x1Prime - cxPrime) / rx,
    y: (y1Prime - cyPrime) / ry,
  };
  const endVector = {
    x: (-x1Prime - cxPrime) / rx,
    y: (-y1Prime - cyPrime) / ry,
  };
  const startAngle = vectorAngle({x: 1, y: 0}, startVector);
  let sweepAngle = vectorAngle(startVector, endVector);
  if (!sweep && sweepAngle > 0) sweepAngle -= Math.PI * 2;
  if (sweep && sweepAngle < 0) sweepAngle += Math.PI * 2;

  const segments = Math.max(4, Math.ceil(Math.abs(sweepAngle) / (Math.PI / 18)));
  const points: GeometryPoint[] = [];
  for (let index = 1; index <= segments; index += 1) {
    const theta = startAngle + sweepAngle * index / segments;
    const cosTheta = Math.cos(theta);
    const sinTheta = Math.sin(theta);
    points.push({
      x: center.x + rx * cosTheta * cosPhi - ry * sinTheta * sinPhi,
      y: center.y + rx * cosTheta * sinPhi + ry * sinTheta * cosPhi,
    });
  }

  return points;
}

function vectorAngle(
  left: GeometryPoint,
  right: GeometryPoint
): number {
  const cross = left.x * right.y - left.y * right.x;
  const dot = left.x * right.x + left.y * right.y;
  return Math.atan2(cross, dot);
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

function sizeFromExactPackage(footprint: string): ViewerComponentSize | null {
  const rule = exactPackageRuleFromText(footprint);
  if (!rule) return null;

  return withHitArea(rule.bodyMm[0] ?? 1.6, rule.bodyMm[1] ?? 0.9);
}

function exactPackageRuleFromText(text: string): ExactPackageRule | null {
  const normalized = text.toUpperCase();

  return packageRules.exactPackages.find(rule => {
    const names = [rule.name, ...(rule.aliases ?? [])];
    return names.some(name => packageTokenMatches(normalized, name));
  }) ?? null;
}

function packageTokenMatches(normalizedText: string, token: string): boolean {
  const normalizedToken = token.toUpperCase();
  return new RegExp(`(?:^|[^A-Z0-9])${escapeRegExp(normalizedToken)}(?=$|[^A-Z0-9])`).test(normalizedText);
}

function designatorDefaultRule(prefix: string): DesignatorDefaultRule | null {
  return packageRules.designatorDefaults.find(rule => rule.prefixes.includes(prefix)) ?? null;
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
