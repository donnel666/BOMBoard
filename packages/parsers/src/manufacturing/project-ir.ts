import type {
  BoardArtworkLayerIR,
  BoardArtworkPaintIR,
  BoardArtworkPrimitiveIR,
  BoardArtworkStyleIR,
  BoardGeometrySource,
  BoardIR,
  BoardLayerFunction,
  BoardLayerIR,
  BomBoardProjectIR,
  BomIR,
  BomItemIR,
  ComponentIR,
  ComponentPlacementIR,
  DrillHitIR,
  ImportDiagnostic,
  SourceFileRecord,
  SourceFileRole,
  ViaIR,
  ViewBox,
} from "@bomboard/core";
import {parseBomCoordinateProject} from "../bom-coordinate/project-parser.js";
import {parseGerber2DProject, type Gerber2DProject} from "../gerber/tracespace-adapter.js";
import type {
  BomCoordinateInput,
  ParsedBomCoordinateProject,
  PlacementSide,
  PointMm,
} from "../bom-coordinate/types.js";
import type {
  BoardSide,
  Gerber2DFileClassification,
  Gerber2DFileKind,
  Gerber2DInputFile,
} from "../gerber/types.js";

export interface ManufacturingProjectInput {
  sourceName?: string;
  bom: BomCoordinateInput;
  coordinates: BomCoordinateInput;
  gerbers: readonly Gerber2DInputFile[];
  createdAt?: string;
}

export async function parseManufacturingProject(
  input: ManufacturingProjectInput
): Promise<BomBoardProjectIR> {
  const [bomCoordinates, gerber] = await Promise.all([
    Promise.resolve(parseBomCoordinateProject({
      bom: input.bom,
      coordinates: input.coordinates,
    })),
    parseGerber2DProject(input.gerbers),
  ]);

  return buildManufacturingProjectIR({
    sourceName: input.sourceName,
    createdAt: input.createdAt,
    bomSourceName: bomCoordinateInputName(input.bom, "bom"),
    coordinateSourceName: bomCoordinateInputName(input.coordinates, "coordinates"),
    bomCoordinates,
    gerber,
  });
}

interface BuildManufacturingProjectIRInput {
  sourceName?: string;
  createdAt?: string;
  bomSourceName: string;
  coordinateSourceName: string;
  bomCoordinates: ParsedBomCoordinateProject;
  gerber: Gerber2DProject;
}

function buildManufacturingProjectIR(
  input: BuildManufacturingProjectIRInput
): BomBoardProjectIR {
  const sourceName = input.sourceName ?? firstNonEmpty([
    input.bomCoordinates.bom.sourceName,
    input.bomCoordinates.coordinates.sourceName,
    input.gerber.classifications[0]?.name,
  ]) ?? "manufacturing-project";
  const bom = manufacturingBom(input.bomCoordinates);

  return {
    format: "bomboard-project-v1",
    schemaVersion: 1,
    metadata: {
      title: sourceName,
      sourceName,
      createdAt: input.createdAt ?? new Date().toISOString(),
    },
    sources: [
      {
        id: "bom",
        name: input.bomSourceName,
        role: "bom",
        parserId: "bom-coordinate",
      },
      {
        id: "coordinates",
        name: input.coordinateSourceName,
        role: "coordinate",
        parserId: "bom-coordinate",
      },
      ...manufacturingSources(input.gerber),
    ],
    coordinateSystem: {
      units: "mm",
      origin: "board",
      xAxis: "right",
      yAxis: "down",
      angleUnit: "deg",
      angleDirection: "clockwise",
      bottomMirroredInModel: false,
    },
    board: manufacturingBoard(input.gerber),
    components: manufacturingComponents(input.bomCoordinates),
    bom,
    diagnostics: manufacturingDiagnostics(input.bomCoordinates, input.gerber),
  };
}

function manufacturingSources(gerber: Gerber2DProject): SourceFileRecord[] {
  return gerber.classifications.map((classification, index) => ({
    id: `gerber:${index}`,
    name: classification.name,
    role: sourceRoleForGerberClassification(classification),
    parserId: "gerber-2d",
  }));
}

function manufacturingBoard(gerber: Gerber2DProject): BoardIR {
  const viewBox = gerber.fragments.boardShapeRenderFragment.viewBox as ViewBox;

  return {
    bounds: boundsFromViewBox(viewBox),
    viewBox,
    layers: manufacturingLayers(gerber),
    artwork: {
      layers: manufacturingArtworkLayers(gerber),
      drillHits: manufacturingDrillHits(gerber),
      vias: manufacturingVias(gerber),
    },
  };
}

function manufacturingLayers(gerber: Gerber2DProject): BoardLayerIR[] {
  return Object.entries(gerber.layerClassificationsById).map(([layerId, classification]) => ({
    id: layerId,
    name: classification.name,
    function: boardLayerFunction(classification.kind),
    side: boardLayerSide(classification.side),
    sourceFileId: sourceFileIdForClassification(gerber.classifications, classification),
    defaultVisible: classification.renderable,
  }));
}

function manufacturingArtworkLayers(gerber: Gerber2DProject): BoardArtworkLayerIR[] {
  const layers: BoardArtworkLayerIR[] = [];
  const boardShapeFragment = gerber.fragments.boardShapeRenderFragment.svgFragment ?? "";
  const boardShapePrimitives = artworkPrimitivesFromSvgFragment(boardShapeFragment);

  if (boardShapePrimitives.length > 0) {
    layers.push(
      {
        id: "board-shape:top",
        layerId: "board-shape",
        side: "top",
        function: "outline",
        geometrySource: null,
        primitives: boardShapePrimitives,
      },
      {
        id: "board-shape:bottom",
        layerId: "board-shape",
        side: "bottom",
        function: "outline",
        geometrySource: null,
        primitives: boardShapePrimitives,
      }
    );
  }

  for (const layer of gerber.fragments.layers) {
    const classification = gerber.layerClassificationsById[layer.id];
    if (!classification) continue;

    const svgFragment = gerber.fragments.svgFragmentsById[layer.id] ?? "";
    const primitives = artworkPrimitivesFromSvgFragment(svgFragment);
    if (primitives.length === 0) continue;

    for (const side of artworkSides(classification.side)) {
      layers.push({
        id: `${layer.id}:${side}`,
        layerId: layer.id,
        side,
        function: boardLayerFunction(classification.kind),
        geometrySource: componentGeometrySource(classification.kind),
        primitives,
      });
    }
  }

  return layers;
}

function artworkPrimitivesFromSvgFragment(fragment: string): BoardArtworkPrimitiveIR[] {
  return [...fragment.matchAll(/<(path|circle|rect|polygon|polyline)\b[^>]*>/g)]
    .flatMap(match => artworkPrimitiveFromTag(match[0]));
}

function artworkPrimitiveFromTag(tag: string): BoardArtworkPrimitiveIR[] {
  const attributes = tagAttributes(tag);
  const tagName = /^<([a-zA-Z][\w:-]*)/.exec(tag)?.[1]?.toLowerCase() ?? "";
  const style = artworkStyleFromAttributes(attributes);
  const attachStyle = <TPrimitive extends BoardArtworkPrimitiveIR>(
    primitive: TPrimitive
  ): TPrimitive => (style ? {...primitive, style} : primitive);

  if (tagName === "path") {
    const data = attributes.d?.trim() ?? "";
    return data ? [attachStyle({kind: "path", data})] : [];
  }

  if (tagName === "circle") {
    const cx = numberAttribute(attributes, "cx");
    const cy = numberAttribute(attributes, "cy");
    const radius = numberAttribute(attributes, "r");
    if (cx === null || cy === null || radius === null || radius <= 0) return [];

    return [attachStyle({
      kind: "circle",
      center: {x: cx, y: cy},
      radius,
    })];
  }

  if (tagName === "rect") {
    const x = numberAttribute(attributes, "x");
    const y = numberAttribute(attributes, "y");
    const width = numberAttribute(attributes, "width");
    const height = numberAttribute(attributes, "height");
    if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) return [];

    return [attachStyle({
      kind: "rect",
      x,
      y,
      width,
      height,
      ...optionalNumber("radiusX", numberAttribute(attributes, "rx")),
      ...optionalNumber("radiusY", numberAttribute(attributes, "ry")),
    })];
  }

  if (tagName === "polygon" || tagName === "polyline") {
    const points = pointListAttribute(attributes.points ?? "");
    if (points.length === 0) return [];

    return [
      tagName === "polygon"
        ? attachStyle({kind: "polygon", points})
        : attachStyle({kind: "polyline", points}),
    ];
  }

  return [];
}

function artworkStyleFromAttributes(
  attributes: Record<string, string>
): BoardArtworkStyleIR | undefined {
  const fill = paintAttribute(attributes.fill);
  const stroke = paintAttribute(attributes.stroke);
  const strokeWidth = numberAttribute(attributes, "stroke-width");
  const style: BoardArtworkStyleIR = {
    ...(fill ? {fill} : {}),
    ...(stroke ? {stroke} : {}),
    ...(strokeWidth !== null ? {strokeWidth} : {}),
  };

  return Object.keys(style).length > 0 ? style : undefined;
}

function paintAttribute(value: string | undefined): BoardArtworkPaintIR | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "") return undefined;
  return normalized === "none" ? "none" : "current";
}

function tagAttributes(tag: string): Record<string, string> {
  return Object.fromEntries(
    [...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(match => [match[1] ?? "", match[2] ?? ""])
  );
}

function numberAttribute(attributes: Record<string, string>, name: string): number | null {
  const value = Number(attributes[name]);
  return Number.isFinite(value) ? value : null;
}

function pointListAttribute(value: string): Array<{x: number; y: number}> {
  return value
    .trim()
    .split(/\s+/)
    .map(point => point.split(",").map(Number))
    .filter((point): point is [number, number] => point.length === 2 && point.every(Number.isFinite))
    .map(point => ({x: point[0], y: point[1]}));
}

function optionalNumber<TKey extends string>(
  key: TKey,
  value: number | null
): Partial<Record<TKey, number>> {
  return value !== null ? {[key]: value} as Record<TKey, number> : {};
}

function manufacturingDrillHits(gerber: Gerber2DProject): DrillHitIR[] {
  return gerber.drills.flatMap(parsed => parsed.hits.map(hit => ({
    position: {
      x: hit.xMm,
      y: -hit.yMm,
    },
    diameter: hit.diameterMm,
    plated: hit.plated,
  })));
}

function manufacturingVias(gerber: Gerber2DProject): ViaIR[] {
  return gerber.vias.map(via => ({
    position: {
      x: via.xMm,
      y: -via.yMm,
    },
    padDiameter: via.padDiameterMm,
    holeDiameter: via.holeDiameterMm,
    startLayer: via.startLayer,
    stopLayer: via.stopLayer,
  }));
}

function manufacturingComponents(project: ParsedBomCoordinateProject): ComponentIR[] {
  return project.components.map((component, index) => {
    const placement = component.placement;
    const bom = component.bom;

    return {
      id: `component:${component.designator || index}`,
      ref: component.designator,
      value: nonEmpty(bom?.comment) ?? nonEmpty(placement?.comment) ?? null,
      footprint: nonEmpty(bom?.footprint) ?? nonEmpty(placement?.footprint) ?? null,
      side: placementSide(placement?.side),
      position: placement ? sourcePointToIR(placement.mid) : null,
      rotationDeg: placement?.rotationDeg ?? null,
      placement: placement ? placementToIR(placement) : null,
      fields: {
        comment: bom?.comment ?? placement?.comment ?? "",
        description: bom?.description ?? "",
        footprint: bom?.footprint ?? placement?.footprint ?? "",
        libRef: bom?.libRef ?? "",
        pins: String(bom?.pins ?? placement?.pins ?? ""),
      },
      bomItemId: typeof bom?.bomRecordIndex === "number"
        ? `bom:${bom.bomRecordIndex}`
        : null,
      diagnostics: component.mismatches,
    };
  });
}

function placementToIR(
  placement: NonNullable<ParsedBomCoordinateProject["components"][number]["placement"]>
): ComponentPlacementIR {
  return {
    mid: sourcePointToIR(placement.mid),
    reference: sourcePointToIR(placement.reference),
    pad: sourcePointToIR(placement.pad),
    side: placementSide(placement.side),
    rawLayer: placement.rawLayer,
    rotationDeg: placement.rotationDeg,
    pins: placement.pins,
    comment: placement.comment,
    sourceRow: placement.sourceRow,
    raw: placement.raw,
  };
}

function manufacturingBom(project: ParsedBomCoordinateProject): BomIR {
  const items: BomItemIR[] = project.bom.records.map((record, index) => ({
    id: `bom:${index}`,
    refs: record.designators,
    quantity: record.quantity,
    value: nonEmpty(record.comment) ?? null,
    footprint: nonEmpty(record.footprint) ?? null,
    fields: {
      ...record.raw,
      comment: record.comment,
      description: record.description,
      footprint: record.footprint,
      libRef: record.libRef,
      pins: String(record.pins ?? ""),
    },
    sourceRef: {
      fileId: "bom",
      line: record.sourceRow,
    },
  }));
  const fieldSet = new Set<string>();
  items.forEach(item => {
    Object.keys(item.fields).forEach(field => fieldSet.add(field));
  });

  return {
    items,
    skipped: [],
    fields: [...fieldSet].sort((left, right) => left.localeCompare(right)),
  };
}

function manufacturingDiagnostics(
  project: ParsedBomCoordinateProject,
  gerber: Gerber2DProject
): ImportDiagnostic[] {
  return [
    ...project.bom.warnings.map(message => warning("bom-warning", message, "bom")),
    ...project.coordinates.warnings.map(message => warning("coordinate-warning", message, "coordinates")),
    ...project.warnings.map(message => warning("bom-coordinate-warning", message)),
    ...project.unmatchedBomDesignators.map(ref => warning(
      "unmatched-bom-designator",
      `BOM designator ${ref} has no matching coordinate placement.`,
      "bom"
    )),
    ...project.unmatchedCoordinateDesignators.map(ref => warning(
      "unmatched-coordinate-designator",
      `Coordinate designator ${ref} has no matching BOM component.`,
      "coordinates"
    )),
    ...gerber.warnings.map(message => warning("gerber-warning", message)),
  ];
}

function warning(code: string, message: string, fileId?: string): ImportDiagnostic {
  return {
    severity: "warning",
    code,
    message,
    ...(fileId ? {sourceRef: {fileId}} : {}),
  };
}

function boardLayerFunction(kind: Gerber2DFileKind): BoardLayerFunction {
  switch (kind) {
    case "profile":
      return "outline";
    case "drill":
    case "viaInfo":
      return "drill";
    case "padMaster":
    case "copper":
      return "copper";
    case "solderMask":
      return "solderMask";
    case "silkscreen":
      return "silkscreen";
    case "paste":
      return "paste";
    case "support":
    case "ignored":
    case "unknown":
      return "unknown";
  }
}

function boardLayerSide(side: BoardSide): "top" | "bottom" | "inner" | "both" | null {
  switch (side) {
    case "top":
      return "top";
    case "bottom":
      return "bottom";
    case "inner":
      return "inner";
    case "all":
      return "both";
    case null:
      return null;
  }
}

function artworkSides(side: BoardSide): Array<"top" | "bottom"> {
  switch (side) {
    case "top":
      return ["top"];
    case "bottom":
      return ["bottom"];
    case "all":
      return ["top", "bottom"];
    case "inner":
    case null:
      return [];
  }
}

function componentGeometrySource(kind: Gerber2DFileKind): BoardGeometrySource | null {
  switch (kind) {
    case "padMaster":
      return "padMaster";
    case "solderMask":
      return "solderMask";
    case "paste":
      return "paste";
    case "copper":
      return "copper";
    case "profile":
    case "drill":
    case "viaInfo":
    case "silkscreen":
    case "support":
    case "ignored":
    case "unknown":
      return null;
  }
}

function sourceRoleForGerberClassification(
  classification: Gerber2DFileClassification
): SourceFileRole {
  switch (classification.kind) {
    case "drill":
      return "drill";
    case "support":
    case "ignored":
    case "unknown":
    case "viaInfo":
      return "sidecar";
    default:
      return "gerber";
  }
}

function sourceFileIdForClassification(
  classifications: readonly Gerber2DFileClassification[],
  target: Gerber2DFileClassification
): string | undefined {
  const index = classifications.findIndex(classification => classification.name === target.name);
  return index >= 0 ? `gerber:${index}` : undefined;
}

function bomCoordinateInputName(input: BomCoordinateInput, fallback: string): string {
  if (typeof input === "string") return fallback;
  if (input instanceof Uint8Array) return fallback;
  return input.name ?? fallback;
}

function boundsFromViewBox(viewBox: ViewBox): {minX: number; minY: number; maxX: number; maxY: number} {
  const [x, y, width, height] = viewBox;
  return {
    minX: x,
    minY: y,
    maxX: x + width,
    maxY: y + height,
  };
}

function sourcePointToIR(point: PointMm): {x: number; y: number} {
  return {
    x: point.xMm,
    y: -point.yMm,
  };
}

function placementSide(side: PlacementSide | undefined): ComponentIR["side"] {
  if (side === "top" || side === "bottom") return side;
  return "unknown";
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

function firstNonEmpty(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = nonEmpty(value);
    if (normalized) return normalized;
  }

  return null;
}
