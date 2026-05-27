export interface BomBoardProjectIR {
  format: "bomboard-project-v1";
  schemaVersion: 1;
  metadata: ProjectMetadata;
  sources: SourceFileRecord[];
  coordinateSystem: CanonicalCoordinateSystem;
  board: BoardIR;
  components: ComponentIR[];
  bom: BomIR;
  diagnostics: ImportDiagnostic[];
}

export type BoardSide = "top" | "bottom";

export interface ProjectMetadata {
  title: string;
  sourceName: string | null;
  createdAt: string;
}

export interface CanonicalCoordinateSystem {
  units: "mm";
  origin: "board";
  xAxis: "right";
  yAxis: "down";
  angleUnit: "deg";
  angleDirection: "clockwise";
  bottomMirroredInModel: false;
}

export type SourceFileRole =
  | "source-pcb"
  | "gerber"
  | "drill"
  | "bom"
  | "coordinate"
  | "sidecar"
  | "generated"
  | "unknown";

export interface SourceFileRecord {
  id: string;
  name: string;
  role: SourceFileRole;
  parserId?: string;
}

export interface SourceRef {
  fileId: string;
  objectPath?: string;
  line?: number;
  rawId?: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type ViewBox = [x: number, y: number, width: number, height: number];

export type BoardLayerFunction =
  | "outline"
  | "copper"
  | "solderMask"
  | "paste"
  | "silkscreen"
  | "fabrication"
  | "assembly"
  | "courtyard"
  | "drill"
  | "mechanical"
  | "drawing"
  | "unknown";

export interface BoardLayerIR {
  id: string;
  name: string;
  function: BoardLayerFunction;
  side: "top" | "bottom" | "inner" | "both" | null;
  sourceFileId?: string;
  defaultVisible: boolean;
}

export interface BoardIR {
  bounds: Bounds;
  viewBox: ViewBox;
  layers: BoardLayerIR[];
  artwork: BoardArtworkIR;
}

export interface ComponentIR {
  id: string;
  ref: string;
  value: string | null;
  footprint: string | null;
  side: "top" | "bottom" | "unknown";
  position: Point | null;
  rotationDeg: number | null;
  placement: ComponentPlacementIR | null;
  fields: Record<string, string>;
  bomItemId: string | null;
  diagnostics: string[];
  sourceRef?: SourceRef;
}

export interface ComponentPlacementIR {
  mid: Point;
  reference: Point;
  pad: Point;
  side: "top" | "bottom" | "unknown";
  rawLayer: string;
  rotationDeg: number;
  pins: number | null;
  comment: string;
  sourceRow: number;
  raw: Record<string, string>;
}

export type BoardGeometrySource = "padMaster" | "solderMask" | "paste" | "copper";

export type BoardArtworkPaintIR = "current" | "none";

export interface BoardArtworkStyleIR {
  fill?: BoardArtworkPaintIR;
  stroke?: BoardArtworkPaintIR;
  strokeWidth?: number;
}

export type BoardArtworkPrimitiveIR =
  | BoardArtworkCircleIR
  | BoardArtworkPathIR
  | BoardArtworkPolygonIR
  | BoardArtworkPolylineIR
  | BoardArtworkRectIR;

export interface BoardArtworkPrimitiveBaseIR {
  style?: BoardArtworkStyleIR;
}

export interface BoardArtworkCircleIR extends BoardArtworkPrimitiveBaseIR {
  kind: "circle";
  center: Point;
  radius: number;
}

export interface BoardArtworkPathIR extends BoardArtworkPrimitiveBaseIR {
  kind: "path";
  data: string;
}

export interface BoardArtworkPolygonIR extends BoardArtworkPrimitiveBaseIR {
  kind: "polygon";
  points: Point[];
}

export interface BoardArtworkPolylineIR extends BoardArtworkPrimitiveBaseIR {
  kind: "polyline";
  points: Point[];
}

export interface BoardArtworkRectIR extends BoardArtworkPrimitiveBaseIR {
  kind: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  radiusX?: number;
  radiusY?: number;
}

export interface BoardArtworkIR {
  layers: BoardArtworkLayerIR[];
  drillHits: DrillHitIR[];
  vias: ViaIR[];
}

export interface BoardArtworkLayerIR {
  id: string;
  layerId: string;
  side: BoardSide;
  function: BoardLayerFunction;
  geometrySource: BoardGeometrySource | null;
  primitives: BoardArtworkPrimitiveIR[];
}

export interface DrillHitIR {
  position: Point;
  diameter: number;
  plated: boolean | null;
}

export interface ViaIR {
  position: Point;
  padDiameter: number;
  holeDiameter: number;
  startLayer: string;
  stopLayer: string;
}

export interface PadIR {
  id: string;
  name: string | null;
  componentId: string | null;
  side: "top" | "bottom" | "both";
  position: Point;
}

export interface BomIR {
  items: BomItemIR[];
  skipped: BomSkipIR[];
  fields: string[];
}

export interface BomItemIR {
  id: string;
  refs: string[];
  quantity: number;
  value: string | null;
  footprint: string | null;
  fields: Record<string, string>;
  sourceRef?: SourceRef;
}

export interface BomSkipIR {
  componentId: string;
  reason: string;
}

export type DiagnosticSeverity = "info" | "warning" | "error";

export interface ImportDiagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  sourceRef?: SourceRef;
}
