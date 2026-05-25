export type BoardSide = "top" | "bottom" | "inner" | "all" | null;

export type Gerber2DFileKind =
  | "profile"
  | "drill"
  | "viaInfo"
  | "padMaster"
  | "copper"
  | "solderMask"
  | "silkscreen"
  | "paste"
  | "support"
  | "ignored"
  | "unknown";

export interface Gerber2DInputFile {
  name: string;
  path?: string;
  file?: File;
  text?: string;
}

export interface Gerber2DFileClassification {
  name: string;
  extension: string;
  kind: Gerber2DFileKind;
  side: BoardSide;
  priority: number | null;
  renderable: boolean;
  reason: string;
}

export interface Gerber2DFileTypePriority {
  priority: number;
  extensions: string[];
  kind: Gerber2DFileKind;
  side: BoardSide | "by-extension";
  function: string;
  implementation: string;
}

export interface DrillHit {
  xMm: number;
  yMm: number;
  diameterMm: number;
  tool: string;
  plated: boolean | null;
}

export interface ParsedExcellonDrill {
  fileName: string;
  hits: DrillHit[];
  toolDiametersMm: Record<string, number>;
  warnings: string[];
}

export interface ViaInfoRecord {
  xMm: number;
  yMm: number;
  padDiameterMm: number;
  holeDiameterMm: number;
  startLayer: string;
  stopLayer: string;
}

export type ViewBox = [x: number, y: number, width: number, height: number];
