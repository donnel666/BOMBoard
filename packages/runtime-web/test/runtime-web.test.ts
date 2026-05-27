import {describe, expect, it} from "vitest";

import {
  createWebBomBoardRuntime,
  manufacturingProjectParser,
} from "../src/index.js";

import type {
  BoardRenderer,
  BoardViewerHandle,
  BoardViewerHost,
  BoardViewerMountOptions,
  BomBoardProjectIR,
  ProjectImportInput,
  ProjectParser,
} from "@bomboard/core";
import type {BoardRenderModel} from "@bomboard/viewer";

const textEncoder = new TextEncoder();

describe("runtime-web assembly", () => {
  it("does not claim unrelated non-manufacturing files", async () => {
    const probe = await manufacturingProjectParser.probe({
      sourceName: "unrelated",
      files: [
        {
          name: "README.md",
          path: "README.md",
          bytes: textEncoder.encode("# notes\n"),
        },
      ],
    });

    expect(probe.supported).toBe(false);
  });

  it("reports missing readable files with a stable import error code", async () => {
    await expect(manufacturingProjectParser.parse({
      sourceName: "empty",
      files: [],
    })).rejects.toMatchObject({
      name: "BomBoardImportError",
      code: "missing-readable-files",
    });
  });

  it("uses injected parser, renderer, and viewer host for openProject", async () => {
    const project = minimalProject();
    const renderModel: BoardRenderModel = {
      viewBox: [0, 0, 10, 10],
      components: [],
      mirrorBottom: true,
      artwork: {
        sideSvgs: {
          top: "<svg></svg>",
          bottom: "<svg></svg>",
        },
      },
    };
    const handle = minimalViewerHandle();
    const calls: {
      parsedInput: ProjectImportInput | null;
      renderedProject: BomBoardProjectIR | null;
      renderedOptions: unknown;
      mountedOptions: BoardViewerMountOptions<HTMLElement, BoardRenderModel> | null;
    } = {
      parsedInput: null,
      renderedProject: null,
      renderedOptions: null,
      mountedOptions: null,
    };
    const parser: ProjectParser = {
      id: "unit-parser",
      displayName: "Unit parser",
      probe: () => ({
        supported: true,
        confidence: 1,
        formatId: "unit",
        reason: "unit test",
      }),
      parse: async input => {
        calls.parsedInput = input;
        return project;
      },
    };
    const renderer: BoardRenderer<BoardRenderModel> = {
      id: "unit-renderer",
      displayName: "Unit renderer",
      createRenderModel: async (renderProject, options) => {
        calls.renderedProject = renderProject;
        calls.renderedOptions = options;
        return renderModel;
      },
    };
    const viewerHost: BoardViewerHost<HTMLElement, BoardRenderModel> = {
      id: "unit-viewer",
      displayName: "Unit viewer",
      mount: async options => {
        calls.mountedOptions = options;
        return handle;
      },
    };
    const runtime = createWebBomBoardRuntime({
      parsers: [parser],
      renderer,
      viewerHost,
    });

    const result = await runtime.openProject({
      sourceName: "unit",
      files: [{
        name: "unit.txt",
        path: "unit.txt",
        bytes: textEncoder.encode("unit"),
      }],
      container: {} as HTMLElement,
      footprintBaseUrl: "/footprints",
      side: "bottom",
      showSideControls: false,
    });

    expect(result).toEqual({project, viewer: handle});
    expect(calls.parsedInput?.sourceName).toBe("unit");
    expect(calls.renderedProject).toBe(project);
    expect(calls.renderedOptions).toEqual({
      mirrorBottom: undefined,
      footprintBaseUrl: "/footprints",
    });
    expect(calls.mountedOptions).toMatchObject({
      container: {},
      renderModel,
      side: "bottom",
      showSideControls: false,
    });
  });
});

function minimalProject(): BomBoardProjectIR {
  return {
    format: "bomboard-project-v1",
    schemaVersion: 1,
    metadata: {
      title: "unit",
      sourceName: "unit",
      createdAt: "2026-05-27T00:00:00.000Z",
    },
    sources: [],
    coordinateSystem: {
      units: "mm",
      origin: "board",
      xAxis: "right",
      yAxis: "down",
      angleUnit: "deg",
      angleDirection: "clockwise",
      bottomMirroredInModel: false,
    },
    board: {
      bounds: {
        minX: 0,
        minY: 0,
        maxX: 10,
        maxY: 10,
      },
      viewBox: [0, 0, 10, 10],
      layers: [],
      artwork: {
        layers: [],
        drillHits: [],
        vias: [],
      },
    },
    components: [],
    bom: {
      items: [],
      skipped: [],
      fields: [],
    },
    diagnostics: [],
  };
}

function minimalViewerHandle(): BoardViewerHandle {
  return {
    destroy: () => {},
    getState: () => ({
      side: "top",
      selectedDesignator: null,
      highlightedDesignators: [],
      hoveredDesignator: null,
      viewport: {x: 0, y: 0, scale: 1},
    }),
    setSide: async () => {},
    selectComponent: () => {},
    selectSingleComponent: () => {},
    clearSelection: () => {},
  };
}
