export {BoardViewer, createBoardViewer} from "./board-viewer.js";
export {defaultBoardViewerColors} from "./colors.js";
export {
  createBoardRenderModel,
  defaultBoardRenderer,
  defaultBoardProcessColors,
} from "./render-model.js";
export {pixiBoardViewerHost} from "./board-viewer-host.js";
export {
  emptyFootprintLibrary,
  loadFootprintLibraryForComponents,
  normalizeFootprintKey,
  resolveFootprintCandidates,
} from "./footprint-library.js";
export {
  createBoardViewerModel,
  defaultComponentSimilarityKey,
  highlightedDesignatorsForSelection,
  visibleComponentsForSide,
  viewerComponentSourcesFromProjectIR,
} from "./model.js";

export type {
  BoardViewerColors,
  BoardViewerComponentPointerEvent,
  BoardViewerData,
  BoardViewerEventListener,
  BoardViewerEventMap,
  BoardViewerEventName,
  BoardViewerHoverChange,
  BoardViewerModel,
  BoardViewerOptions,
  BoardRenderModel,
  BoardViewBox,
  BoardViewerSelectionChange,
  BoardViewerSide,
  BoardViewerSideChange,
  BoardSvgArtwork,
  BoardViewerState,
  BoardViewerStateChange,
  BoardViewerStateSource,
  BoardViewerViewportChange,
  ComponentSimilarityKeyFn,
  ComponentSizeFn,
  LegacyBoardRenderModelOptions,
  ViewerComponent,
  ViewerComponentElement,
  ViewerComponentSource,
  ViewerComponentSize,
  ViewerPlacementSource,
  ViewerPoint,
  ViewportTransform,
} from "./types.js";
export type {
  BoardProcessColors,
  BoardRenderModelOptions,
} from "./render-model.js";

export type {
  CompactFootprintFeature,
  CompactFootprintShape,
  FootprintLibrary,
  FootprintLibraryCandidate,
  FootprintLibraryEntry,
  FootprintLibraryLoadOptions,
} from "./footprint-library.js";
