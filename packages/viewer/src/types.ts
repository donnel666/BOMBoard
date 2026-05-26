import type {
  BomCoordinateComponent,
  CoordinateRecord,
  Gerber2DProcessColors,
  Gerber2DProject,
  ParsedBomCoordinateProject,
  ViewBox,
} from "@bomboard/parsers";
import type {FootprintLibrary} from "./footprint-library.js";

export type BoardViewerSide = "top" | "bottom";

export type BoardViewerStateSource = "viewer" | "external";

export interface ViewerPoint {
  x: number;
  y: number;
}

export interface ViewportTransform {
  x: number;
  y: number;
  scale: number;
}

export interface ViewerComponentSize {
  widthMm: number;
  heightMm: number;
  hitWidthMm: number;
  hitHeightMm: number;
}

export type ViewerComponentElement =
  | {
    kind: "circle";
    center: ViewerPoint;
    radiusMm: number;
  }
  | {
    kind: "polygon";
    points: ViewerPoint[];
  }
  | {
    kind: "polyline";
    points: ViewerPoint[];
    strokeWidthMm: number;
  };

export interface ViewerComponent {
  designator: string;
  source: BomCoordinateComponent;
  placement: CoordinateRecord;
  side: BoardViewerSide | "unknown";
  boardPosition: ViewerPoint;
  displayPosition: ViewerPoint;
  rotationDeg: number;
  footprint: string;
  comment: string;
  libRef: string;
  similarityKey: string;
  size: ViewerComponentSize;
  highlightElements: readonly ViewerComponentElement[];
}

export interface BoardViewerState {
  side: BoardViewerSide;
  selectedDesignator: string | null;
  highlightedDesignators: readonly string[];
  hoveredDesignator: string | null;
  viewport: ViewportTransform;
}

export interface BoardViewerStateChange {
  state: BoardViewerState;
  source: BoardViewerStateSource;
}

export interface BoardViewerSelectionChange extends BoardViewerStateChange {
  selectedComponent: ViewerComponent | null;
  highlightedComponents: readonly ViewerComponent[];
}

export interface BoardViewerSideChange extends BoardViewerStateChange {
  side: BoardViewerSide;
}

export interface BoardViewerHoverChange extends BoardViewerStateChange {
  hoveredComponent: ViewerComponent | null;
}

export interface BoardViewerViewportChange extends BoardViewerStateChange {
  viewport: ViewportTransform;
}

export interface BoardViewerComponentPointerEvent {
  component: ViewerComponent;
  state: BoardViewerState;
}

export interface BoardViewerEventMap {
  statechange: BoardViewerStateChange;
  selectionchange: BoardViewerSelectionChange;
  sidechange: BoardViewerSideChange;
  hoverchange: BoardViewerHoverChange;
  viewportchange: BoardViewerViewportChange;
  componentclick: BoardViewerComponentPointerEvent;
}

export type BoardViewerEventName = keyof BoardViewerEventMap;

export type BoardViewerEventListener<TEventName extends BoardViewerEventName> = (
  event: BoardViewerEventMap[TEventName]
) => void;

export type ComponentSimilarityKeyFn = (
  component: BomCoordinateComponent
) => string | null;

export type ComponentSizeFn = (
  component: BomCoordinateComponent
) => Partial<ViewerComponentSize> | null;

export interface BoardViewerColors {
  background: string;
  dimOverlay: string;
  componentFill: string;
  componentStroke: string;
  hoverStroke: string;
  similarFill: string;
  similarStroke: string;
  selectedFill: string;
  selectedStroke: string;
}

export interface BoardViewerData {
  gerber: Gerber2DProject;
  bomCoordinates: ParsedBomCoordinateProject;
}

export interface BoardViewerOptions extends BoardViewerData {
  container: HTMLElement;
  side?: BoardViewerSide;
  mirrorBottom?: boolean;
  showSideControls?: boolean;
  autoFitOnResize?: boolean;
  minZoom?: number;
  maxZoom?: number;
  colors?: Partial<BoardViewerColors>;
  processColors?: Partial<Gerber2DProcessColors>;
  getSimilarityKey?: ComponentSimilarityKeyFn;
  getComponentSize?: ComponentSizeFn;
  footprintLibrary?: FootprintLibrary;
  onStateChange?: BoardViewerEventListener<"statechange">;
  onSelectionChange?: BoardViewerEventListener<"selectionchange">;
}

export interface BoardViewerModel {
  viewBox: ViewBox;
  components: readonly ViewerComponent[];
}
