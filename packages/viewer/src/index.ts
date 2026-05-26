export {BoardViewer, createBoardViewer} from "./board-viewer.js";
export {defaultBoardViewerColors} from "./colors.js";
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
  BoardViewerSelectionChange,
  BoardViewerSide,
  BoardViewerSideChange,
  BoardViewerState,
  BoardViewerStateChange,
  BoardViewerStateSource,
  BoardViewerViewportChange,
  ComponentSimilarityKeyFn,
  ComponentSizeFn,
  ViewerComponent,
  ViewerComponentElement,
  ViewerComponentSize,
  ViewerPoint,
  ViewportTransform,
} from "./types.js";

export type {
  CompactFootprintFeature,
  CompactFootprintShape,
  FootprintLibrary,
  FootprintLibraryCandidate,
  FootprintLibraryEntry,
  FootprintLibraryLoadOptions,
} from "./footprint-library.js";
