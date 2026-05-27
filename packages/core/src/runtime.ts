import type {BomBoardProjectIR, BoardSide} from "./ir.js";

export interface ProjectImportFile<TNativeFile = unknown> {
  name: string;
  bytes: Uint8Array;
  path?: string;
  file?: TNativeFile;
}

export interface ProjectImportInput<TNativeFile = unknown> {
  sourceName: string;
  files: readonly ProjectImportFile<TNativeFile>[];
  createdAt?: string;
}

export interface ProjectParseOptions {
  createdAt?: string;
}

export interface ProjectParserProbe {
  supported: boolean;
  confidence: number;
  formatId: string | null;
  reason: string;
}

export interface ProjectParser<TNativeFile = unknown> {
  id: string;
  displayName: string;
  probe(
    input: ProjectImportInput<TNativeFile>
  ): ProjectParserProbe | Promise<ProjectParserProbe>;
  parse(
    input: ProjectImportInput<TNativeFile>,
    options?: ProjectParseOptions
  ): Promise<BomBoardProjectIR>;
}

export type BoardViewerSide = BoardSide;
export type BoardViewerStateSource = "viewer" | "external";

export interface BoardRenderPoint {
  x: number;
  y: number;
}

export interface BoardRenderPointMm {
  xMm: number;
  yMm: number;
}

export interface BoardRenderComponentSize {
  widthMm: number;
  heightMm: number;
  hitWidthMm: number;
  hitHeightMm: number;
}

export type BoardRenderComponentElement =
  | {
    kind: "circle";
    center: BoardRenderPoint;
    radiusMm: number;
  }
  | {
    kind: "polygon";
    points: BoardRenderPoint[];
  }
  | {
    kind: "polyline";
    points: BoardRenderPoint[];
    strokeWidthMm: number;
  };

export type BoardRenderPlacementSide = BoardViewerSide | "unknown";

export interface BoardRenderPlacementSource {
  designator: string;
  footprint: string;
  mid: BoardRenderPointMm;
  reference: BoardRenderPointMm;
  pad: BoardRenderPointMm;
  side: BoardRenderPlacementSide;
  rawLayer: string;
  rotationDeg: number;
  pins: number | null;
  comment: string;
  sourceRow: number;
  raw: Record<string, string>;
}

export interface BoardRenderBomSource {
  designator: string;
  comment: string;
  description: string;
  footprint: string;
  libRef: string;
  pins: number | null;
  bomRecordIndex: number;
}

export interface BoardRenderComponentSource {
  designator: string;
  bom: BoardRenderBomSource | null;
  placement: BoardRenderPlacementSource | null;
  mismatches: string[];
}

export interface BoardRenderComponent {
  designator: string;
  source: BoardRenderComponentSource;
  placement: BoardRenderPlacementSource;
  side: BoardRenderPlacementSide;
  boardPosition: BoardRenderPoint;
  displayPosition: BoardRenderPoint;
  rotationDeg: number;
  footprint: string;
  comment: string;
  libRef: string;
  similarityKey: string;
  size: BoardRenderComponentSize;
  highlightElements: readonly BoardRenderComponentElement[];
}

export interface BoardViewerState {
  side: BoardViewerSide;
  selectedDesignator: string | null;
  highlightedDesignators: readonly string[];
  hoveredDesignator: string | null;
  viewport: {
    x: number;
    y: number;
    scale: number;
  };
}

export interface BoardViewerComponentRef {
  designator: string;
  side: BoardViewerSide | "unknown";
}

export interface BoardViewerSelectionChange {
  state: BoardViewerState;
  selectedComponent: BoardViewerComponentRef | null;
  highlightedComponents: readonly BoardViewerComponentRef[];
}

export interface BoardViewerHandle {
  destroy(): void;
  getState(): BoardViewerState;
  setSide(side: BoardViewerSide, source?: BoardViewerStateSource): Promise<void>;
  selectComponent(designator: string | null, source?: BoardViewerStateSource): void;
  selectSingleComponent(designator: string, source?: BoardViewerStateSource): void;
  clearSelection(source?: BoardViewerStateSource): void;
}

export interface BoardRenderModel<TArtwork = unknown> {
  viewBox: [x: number, y: number, width: number, height: number];
  components: readonly BoardRenderComponent[];
  mirrorBottom: boolean;
  artwork: TArtwork;
}

export interface BoardRenderOptions {
  mirrorBottom?: boolean;
  footprintBaseUrl?: string;
}

export interface BoardRenderer<
  TRenderModel extends BoardRenderModel = BoardRenderModel,
> {
  id: string;
  displayName: string;
  createRenderModel(
    project: BomBoardProjectIR,
    options?: BoardRenderOptions
  ): TRenderModel | Promise<TRenderModel>;
}

export interface BoardViewerMountOptions<
  TContainer = unknown,
  TRenderModel extends BoardRenderModel = BoardRenderModel,
> {
  container: TContainer;
  renderModel: TRenderModel;
  side?: BoardViewerSide;
  showSideControls?: boolean;
  onSelectionChange?: (event: BoardViewerSelectionChange) => void;
}

export interface BoardViewerHost<
  TContainer = unknown,
  TRenderModel extends BoardRenderModel = BoardRenderModel,
> {
  id: string;
  displayName: string;
  mount(options: BoardViewerMountOptions<TContainer, TRenderModel>): Promise<BoardViewerHandle>;
}

export interface BoardProjectViewerMountOptions<
  TContainer = unknown,
> extends BoardRenderOptions {
  project: BomBoardProjectIR;
  container: TContainer;
  footprintBaseUrl?: string;
  side?: BoardViewerSide;
  showSideControls?: boolean;
  onSelectionChange?: (event: BoardViewerSelectionChange) => void;
}

export interface OpenProjectInput<
  TContainer = unknown,
  TNativeFile = unknown,
> extends ProjectImportInput<TNativeFile>, BoardRenderOptions {
  container: TContainer;
  footprintBaseUrl?: string;
  side?: BoardViewerSide;
  showSideControls?: boolean;
  onSelectionChange?: (event: BoardViewerSelectionChange) => void;
}

export interface OpenProjectResult {
  project: BomBoardProjectIR;
  viewer: BoardViewerHandle;
}

export interface BomBoardRuntime<
  TContainer = unknown,
  TRenderModel extends BoardRenderModel = BoardRenderModel,
  TNativeFile = unknown,
> {
  parseProject(input: ProjectImportInput<TNativeFile>): Promise<BomBoardProjectIR>;
  createRenderModel(
    project: BomBoardProjectIR,
    options?: BoardRenderOptions
  ): Promise<TRenderModel>;
  mountViewer(
    options: BoardViewerMountOptions<TContainer, TRenderModel>
  ): Promise<BoardViewerHandle>;
  mountProjectViewer(
    options: BoardProjectViewerMountOptions<TContainer>
  ): Promise<BoardViewerHandle>;
  openProject(
    input: OpenProjectInput<TContainer, TNativeFile>
  ): Promise<OpenProjectResult>;
}

export type BomBoardImportErrorCode =
  | "missing-readable-files"
  | "missing-bom-file"
  | "missing-coordinate-file"
  | "missing-gerber-files"
  | "missing-drill-file"
  | "empty-bom-designators"
  | "empty-coordinate-placements"
  | "unsupported-project";

export class BomBoardImportError extends Error {
  readonly code: BomBoardImportErrorCode;

  constructor(code: BomBoardImportErrorCode, message: string) {
    super(message);
    this.name = "BomBoardImportError";
    this.code = code;
  }
}

export function isBomBoardImportError(error: unknown): error is BomBoardImportError {
  return error instanceof BomBoardImportError
    || (typeof error === "object"
      && error !== null
      && (error as {name?: unknown}).name === "BomBoardImportError"
      && typeof (error as {code?: unknown}).code === "string");
}
