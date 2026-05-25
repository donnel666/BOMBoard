import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {describe, expect, it} from "vitest";

import {
  classifyGerber2DFileName,
  parseExcellonDrill,
  parseGerber2DProject,
  parseViaInfoCsv,
  renderGerber2DReviewSvgs,
  selectGerber2DFiles,
} from "../src/index.js";

describe("Gerber 2D file classification", () => {
  it("prioritizes profile, pad masters, mask, silk, drill, and via-info files", () => {
    expect(classifyGerber2DFileName("board.gm")).toMatchObject({
      kind: "profile",
      side: "all",
      priority: 1,
      renderable: true,
    });
    expect(classifyGerber2DFileName("board.gpt")).toMatchObject({
      kind: "padMaster",
      side: "top",
      priority: 3,
      renderable: true,
    });
    expect(classifyGerber2DFileName("board.gts")).toMatchObject({
      kind: "solderMask",
      side: "top",
      priority: 5,
      renderable: true,
    });
    expect(classifyGerber2DFileName("board.gto")).toMatchObject({
      kind: "silkscreen",
      side: "top",
      priority: 6,
      renderable: true,
    });
    expect(classifyGerber2DFileName("board-viainfo.txt")).toMatchObject({
      kind: "viaInfo",
      side: "all",
      renderable: false,
    });
  });

  it("uses pad masters instead of top/bottom copper when both are present", () => {
    const selection = selectGerber2DFiles(
      [
        "board.gm",
        "board.gpt",
        "board.gpb",
        "board.gtl",
        "board.gbl",
        "board.gts",
        "board.gbs",
        "board.gto",
        "board.txt",
        "board-viainfo.txt",
        "status report.txt",
      ].map(name => ({name, path: `/virtual/${name}`}))
    );

    expect(selection.tracespaceFiles.map(row => row.classification.name)).toEqual([
      "board.gm",
      "board.gpt",
      "board.gpb",
      "board.gts",
      "board.gbs",
      "board.gto",
    ]);
    expect(selection.drillFiles.map(row => row.classification.name)).toEqual(["board.txt"]);
    expect(selection.viaInfoFiles.map(row => row.classification.name)).toEqual([
      "board-viainfo.txt",
    ]);
  });
});

describe("Excellon drill parsing", () => {
  it("normalizes Altium INCH,LZ drill coordinates into millimeters", () => {
    const parsed = parseExcellonDrill(`M48
;FILE_FORMAT=2:5
INCH,LZ
;TYPE=PLATED
T01F00S00C0.01200
%
T01
X00115Y0041
Y00425
X01Y01445
`);

    expect(parsed.warnings).toEqual([]);
    expect(parsed.hits).toHaveLength(3);
    expect(parsed.hits[0]).toMatchObject({tool: "T1", plated: true});
    expect(parsed.hits[0]?.xMm).toBeCloseTo(2.921, 6);
    expect(parsed.hits[0]?.yMm).toBeCloseTo(10.414, 6);
    expect(parsed.hits[0]?.diameterMm).toBeCloseTo(0.3048, 6);
    expect(parsed.hits[1]?.xMm).toBeCloseTo(2.921, 6);
    expect(parsed.hits[1]?.yMm).toBeCloseTo(10.795, 6);
    expect(parsed.hits[2]?.xMm).toBeCloseTo(25.4, 6);
    expect(parsed.hits[2]?.yMm).toBeCloseTo(36.703, 6);
  });
});

describe("Altium via-info parsing", () => {
  it("parses quoted via CSV rows", () => {
    const vias = parseViaInfoCsv(`"CenterXMm","CenterYMm","PadSizeMm","HoleSizeMm","Start Layer","Stop Layer"
"39.878","66.04","0.6096","0.3048","Top Layer","Bottom Layer"
`);

    expect(vias).toEqual([
      {
        xMm: 39.878,
        yMm: 66.04,
        padDiameterMm: 0.6096,
        holeDiameterMm: 0.3048,
        startLayer: "Top Layer",
        stopLayer: "Bottom Layer",
      },
    ]);
  });
});

describe("Gerber 2D project rendering", () => {
  it("renders a self-contained top-side SVG with gold pads, solder mask, vias, and silk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bomboard-gerber-"));

    try {
      const fixtures = new Map<string, string>([
        [
          "unit.gm",
          `%FSLAX44Y44*%
%MOMM*%
G01*
%ADD10C,0.1000*%
D10*
X0Y0D02*
X100000Y0D01*
Y100000D01*
X0Y100000D01*
X0Y0D01*
M02*
`,
        ],
        [
          "unit.gpt",
          `%FSLAX44Y44*%
%MOMM*%
%ADD10C,1.0000*%
D10*
X50000Y50000D03*
M02*
`,
        ],
        [
          "unit.gts",
          `%FSLAX44Y44*%
%MOMM*%
%ADD10C,1.2000*%
D10*
X50000Y50000D03*
M02*
`,
        ],
        [
          "unit.gto",
          `%FSLAX44Y44*%
%MOMM*%
G01*
%ADD10C,0.2000*%
D10*
X10000Y10000D02*
X90000Y10000D01*
M02*
`,
        ],
        [
          "unit.txt",
          `M48
;FILE_FORMAT=3:3
METRIC,TZ
;TYPE=PLATED
T01C0.300
%
T01
X005000Y005000
`,
        ],
        [
          "unit-viainfo.txt",
          `"CenterXMm","CenterYMm","PadSizeMm","HoleSizeMm","Start Layer","Stop Layer"
"5","5","0.6","0.3","Top Layer","Bottom Layer"
`,
        ],
      ]);

      const files = Array.from(fixtures, ([name, text]) => {
        const path = join(dir, name);
        writeFileSync(path, text);
        return {name, path, text};
      });

      const project = await parseGerber2DProject(files);
      const svgs = renderGerber2DReviewSvgs(project);

      expect(project.warnings).toEqual([]);
      expect(project.drills).toHaveLength(1);
      expect(project.drills[0]?.hits).toHaveLength(1);
      expect(project.vias).toHaveLength(1);
      expect(svgs["03-top-pads.svg"]).toContain("<circle");
      expect(svgs["07-top-silkscreen.svg"]).toContain("<path");
      expect(svgs["09-top-composite.svg"]).toContain("#d8a73f");
      expect(svgs["09-top-composite.svg"]).toContain("#087a3d");
      expect(svgs["09-top-composite.svg"]).toContain("#18a75a");
      expect(svgs["09-top-composite.svg"]).not.toMatch(/undefined|NaN|Infinity/);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
