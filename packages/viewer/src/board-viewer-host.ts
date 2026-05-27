import {createBoardViewer, type BoardViewer} from "./board-viewer.js";
import type {
  BoardViewerComponentRef,
  BoardViewerHandle,
  BoardViewerHost,
  BoardViewerSelectionChange as CoreBoardViewerSelectionChange,
} from "@bomboard/core";
import type {
  BoardRenderModel,
  BoardViewerSelectionChange,
} from "./types.js";

export const pixiBoardViewerHost: BoardViewerHost<HTMLElement, BoardRenderModel> = {
  id: "pixi-board-viewer",
  displayName: "Pixi board viewer",
  async mount(options): Promise<BoardViewerHandle> {
    const viewer = await createBoardViewer({
      container: options.container,
      renderModel: options.renderModel,
      side: options.side,
      showSideControls: options.showSideControls,
      onSelectionChange: options.onSelectionChange
        ? event => options.onSelectionChange?.(toSelectionChange(event))
        : undefined,
    });

    return toBoardViewerHandle(viewer);
  },
};

function toBoardViewerHandle(viewer: BoardViewer): BoardViewerHandle {
  return {
    destroy(): void {
      viewer.destroy();
    },
    getState() {
      return viewer.getState();
    },
    setSide(side, source) {
      return viewer.setSide(side, source);
    },
    selectComponent(designator, source) {
      viewer.selectComponent(designator, source);
    },
    selectSingleComponent(designator, source) {
      viewer.selectSingleComponent(designator, source);
    },
    clearSelection(source) {
      viewer.clearSelection(source);
    },
  };
}

function toSelectionChange(
  event: BoardViewerSelectionChange
): CoreBoardViewerSelectionChange {
  return {
    state: event.state,
    selectedComponent: event.selectedComponent ? toComponentRef(event.selectedComponent) : null,
    highlightedComponents: event.highlightedComponents.map(toComponentRef),
  };
}

function toComponentRef(component: BoardViewerComponentRef): BoardViewerComponentRef {
  return {
    designator: component.designator,
    side: component.side,
  };
}
