import type {FootprintLibrary} from "./footprint-library.js";
import type {
  BoardRenderComponent,
  BoardRenderComponentElement,
  BoardRenderComponentSize,
  BoardRenderBomSource,
  BoardRenderComponentSource,
  BoardRenderModel as CoreBoardRenderModel,
  BoardRenderPlacementSide,
  BoardRenderPlacementSource,
  BoardRenderPoint,
  BoardRenderPointMm,
  BoardViewerStateSource as CoreBoardViewerStateSource,
} from "@bomboard/core";

export type BoardViewerSide = "top" | "bottom";

export type BoardViewBox = [x: number, y: number, width: number, height: number];

export type BoardViewerStateSource = CoreBoardViewerStateSource;

export type ViewerPoint = BoardRenderPoint;

export interface ViewportTransform {
  x: number;
  y: number;
  scale: number;
}

export type ViewerComponentSize = BoardRenderComponentSize;

export type ViewerComponentElement = BoardRenderComponentElement;

export type ViewerPointMm = BoardRenderPointMm;

export type ViewerPlacementSide = BoardRenderPlacementSide;

export type ViewerPlacementSource = BoardRenderPlacementSource;

export type ViewerBomSource = BoardRenderBomSource;

export type ViewerComponentSource = BoardRenderComponentSource;

export type ViewerComponent = BoardRenderComponent;

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
  component: ViewerComponentSource
) => string | null;

export type ComponentSizeFn = (
  component: ViewerComponentSource
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

export interface BoardSvgArtwork {
  sideSvgs: Record<BoardViewerSide, string>;
}

export type BoardRenderModel = CoreBoardRenderModel<BoardSvgArtwork>;

export interface BoardViewerData {
  renderModel: BoardRenderModel;
}

export interface BoardViewerOptions extends BoardViewerData {
  container: HTMLElement;
  side?: BoardViewerSide;
  showSideControls?: boolean;
  autoFitOnResize?: boolean;
  minZoom?: number;
  maxZoom?: number;
  colors?: Partial<BoardViewerColors>;
  onStateChange?: BoardViewerEventListener<"statechange">;
  onSelectionChange?: BoardViewerEventListener<"selectionchange">;
}

export interface BoardViewerModel {
  viewBox: BoardViewBox;
  components: readonly ViewerComponent[];
}

export interface LegacyBoardRenderModelOptions {
  mirrorBottom?: boolean;
  getSimilarityKey?: ComponentSimilarityKeyFn;
  getComponentSize?: ComponentSizeFn;
  footprintLibrary?: FootprintLibrary;
}
