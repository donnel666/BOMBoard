import {describe, expect, it} from "vitest";

import {
  createBoardRenderModel,
  emptyFootprintLibrary,
} from "../src/index.js";

import type {BomBoardProjectIR} from "@bomboard/core";

describe("board render model", () => {
  it("renders top and bottom side SVGs from project IR artwork", () => {
    const model = createBoardRenderModel({
      project: minimalArtworkProject(),
      footprintLibrary: emptyFootprintLibrary,
      mirrorBottom: true,
    });
    const topSvg = model.artwork.sideSvgs.top;
    const bottomSvg = model.artwork.sideSvgs.bottom;
    const combined = `${topSvg}\n${bottomSvg}`;

    expect(topSvg).toContain("#d8a73f");
    expect(topSvg).toContain("#087a3d");
    expect(topSvg).toContain("#18a75a");
    expect(topSvg).toContain("#f4f1e8");
    expect(topSvg).toContain('cx="5" cy="5"');
    expect(topSvg).toContain('cx="6" cy="6"');
    expect(bottomSvg).toContain('transform="translate(20,0) scale(-1,1)"');
    expect(combined).not.toMatch(/undefined|NaN|Infinity/);
  });
});

function minimalArtworkProject(): BomBoardProjectIR {
  return {
    format: "bomboard-project-v1",
    schemaVersion: 1,
    metadata: {
      title: "unit-board",
      sourceName: "unit-board",
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
        maxX: 20,
        maxY: 10,
      },
      viewBox: [0, 0, 20, 10],
      layers: [],
      artwork: {
        layers: [
          {
            id: "board-shape:top",
            layerId: "board-shape",
            side: "top",
            function: "outline",
            geometrySource: null,
            primitives: [{kind: "path", data: "M0 0H20V10H0Z"}],
          },
          {
            id: "board-shape:bottom",
            layerId: "board-shape",
            side: "bottom",
            function: "outline",
            geometrySource: null,
            primitives: [{kind: "path", data: "M0 0H20V10H0Z"}],
          },
          {
            id: "top-copper",
            layerId: "top-copper",
            side: "top",
            function: "copper",
            geometrySource: "copper",
            primitives: [{kind: "circle", center: {x: 5, y: 5}, radius: 1}],
          },
          {
            id: "top-mask",
            layerId: "top-mask",
            side: "top",
            function: "solderMask",
            geometrySource: "solderMask",
            primitives: [{kind: "circle", center: {x: 5, y: 5}, radius: 1.2}],
          },
          {
            id: "top-silk",
            layerId: "top-silk",
            side: "top",
            function: "silkscreen",
            geometrySource: null,
            primitives: [{kind: "path", data: "M2 2H4"}],
          },
        ],
        drillHits: [
          {
            position: {x: 6, y: 6},
            diameter: 0.5,
            plated: true,
          },
        ],
        vias: [
          {
            position: {x: 7, y: 6},
            padDiameter: 0.8,
            holeDiameter: 0.4,
            startLayer: "top",
            stopLayer: "bottom",
          },
        ],
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
