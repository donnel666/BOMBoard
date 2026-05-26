export type BomCoordinateEncoding = "auto" | "utf-8" | "gb18030" | "gbk";

export interface BomCoordinateParseOptions {
  encoding?: BomCoordinateEncoding;
}

export interface BomCoordinateTextInput {
  name?: string;
  text?: string;
  bytes?: Uint8Array;
  encoding?: BomCoordinateEncoding;
}

export type BomCoordinateInput = string | Uint8Array | BomCoordinateTextInput;

export interface BomRecord {
  comment: string;
  description: string;
  designators: string[];
  footprint: string;
  libRef: string;
  pins: number | null;
  quantity: number;
  sourceRow: number;
  raw: Record<string, string>;
}

export interface BomComponent {
  designator: string;
  comment: string;
  description: string;
  footprint: string;
  libRef: string;
  pins: number | null;
  bomRecordIndex: number;
}

export interface ParsedBomCsv {
  sourceName: string | null;
  records: BomRecord[];
  components: BomComponent[];
  warnings: string[];
}

export type PlacementSide = "top" | "bottom" | "unknown";

export interface PointMm {
  xMm: number;
  yMm: number;
}

export interface CoordinateRecord {
  designator: string;
  footprint: string;
  mid: PointMm;
  reference: PointMm;
  pad: PointMm;
  side: PlacementSide;
  rawLayer: string;
  rotationDeg: number;
  pins: number | null;
  comment: string;
  sourceRow: number;
  raw: Record<string, string>;
}

export interface ParsedCoordinateCsv {
  sourceName: string | null;
  placements: CoordinateRecord[];
  warnings: string[];
}

export interface BomCoordinateComponent {
  designator: string;
  bom: BomComponent | null;
  placement: CoordinateRecord | null;
  mismatches: string[];
}

export interface ParsedBomCoordinateProject {
  bom: ParsedBomCsv;
  coordinates: ParsedCoordinateCsv;
  components: BomCoordinateComponent[];
  unmatchedBomDesignators: string[];
  unmatchedCoordinateDesignators: string[];
  warnings: string[];
}

export interface BomCoordinateProjectInput {
  bom: BomCoordinateInput;
  coordinates: BomCoordinateInput;
}

export type BomCoordinateFileKind = "bom" | "coordinates" | "unknown";

export interface BomCoordinateFileClassification {
  name: string;
  extension: string;
  kind: BomCoordinateFileKind;
  reason: string;
}
