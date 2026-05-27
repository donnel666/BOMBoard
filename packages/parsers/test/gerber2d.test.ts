import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {describe, expect, it} from "vitest";

import {
  classifyGerber2DFile,
  classifyGerber2DFileName,
  parseExcellonDrill,
  parseGerber2DProject,
  parseViaInfoCsv,
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
    expect(classifyGerber2DFileName("board.gtp")).toMatchObject({
      kind: "paste",
      side: "top",
      priority: 7,
      renderable: true,
    });
    expect(classifyGerber2DFileName("board-F.Cu.gbr")).toMatchObject({
      kind: "copper",
      side: "top",
      renderable: true,
    });
    expect(classifyGerber2DFileName("board-B.Paste.gbr")).toMatchObject({
      kind: "paste",
      side: "bottom",
      renderable: true,
    });
    expect(classifyGerber2DFileName("board-Edge.Cuts.gbr")).toMatchObject({
      kind: "profile",
      side: "all",
      renderable: true,
    });
    expect(classifyGerber2DFileName("board-viainfo.txt")).toMatchObject({
      kind: "viaInfo",
      side: "all",
      renderable: false,
    });
    expect(classifyGerber2DFileName("Gerber_DrillDrawingLayer.GDD")).toMatchObject({
      kind: "support",
      renderable: false,
    });
  });

  it("sniffs text drill candidates by Excellon content", () => {
    expect(classifyGerber2DFile({
      name: "readme.txt",
      text: "Fabrication notes only\nNo drill coordinates here.\n",
    })).toMatchObject({
      kind: "support",
      renderable: false,
    });
    expect(classifyGerber2DFile({
      name: "board.txt",
      text: `M48
;FILE_FORMAT=3:3
METRIC,TZ
T01C0.300
%
T01
X005000Y005000
`,
    })).toMatchObject({
      kind: "drill",
      side: "all",
      renderable: false,
    });
    expect(classifyGerber2DFile({
      name: "board.drl",
      text: `M48
METRIC,TZ
T01C0.300
%
X005000Y005000
`,
    })).toMatchObject({
      kind: "drill",
      side: "all",
      renderable: false,
    });
  });

  it("uses Gerber X2 FileFunction attributes before filename heuristics", () => {
    expect(classifyGerber2DFile({
      name: "any-name.gbr",
      text: "%TF.FileFunction,Copper,L1,Top*%\n%MOMM*%\nM02*\n",
    })).toMatchObject({
      kind: "copper",
      side: "top",
      renderable: true,
    });
    expect(classifyGerber2DFile({
      name: "random.gm1",
      text: "%TF.FileFunction,Profile,NP*%\n%MOMM*%\nM02*\n",
    })).toMatchObject({
      kind: "profile",
      side: "all",
      renderable: true,
    });
    expect(classifyGerber2DFile({
      name: "top-looking.gbr",
      text: "%TF.FileFunction,AssemblyDrawing,Top*%\n%MOMM*%\nM02*\n",
    })).toMatchObject({
      kind: "support",
      side: "top",
      renderable: false,
    });
  });

  it("keeps copper render layers when pad masters are also present", () => {
    const selection = selectGerber2DFiles(
      [
        ["board.gm", ""],
        ["board.gpt", ""],
        ["board.gpb", ""],
        ["board.gtl", ""],
        ["board.gbl", ""],
        ["board.gts", ""],
        ["board.gbs", ""],
        ["board.gto", ""],
        ["board.gtp", ""],
        ["board.txt", "M48\n;FILE_FORMAT=3:3\nMETRIC,TZ\nT01C0.300\n%\nT01\nX005000Y005000\n"],
        ["board-viainfo.txt", ""],
        ["status report.txt", ""],
      ].map(([name, text]) => ({name, path: `/virtual/${name}`, text}))
    );

    expect(selection.tracespaceFiles.map(row => row.classification.name)).toEqual([
      "board.gm",
      "board.gpt",
      "board.gpb",
      "board.gtl",
      "board.gbl",
      "board.gts",
      "board.gbs",
      "board.gto",
      "board.gtp",
    ]);
    expect(selection.drillFiles.map(row => row.classification.name)).toEqual(["board.txt"]);
    expect(selection.viaInfoFiles.map(row => row.classification.name)).toEqual([
      "board-viainfo.txt",
    ]);
  });

  it("selects neutral gerber filenames when X2 FileFunction declares a renderable layer", () => {
    const selection = selectGerber2DFiles([
      {
        name: "unknown-one.gbr",
        path: "/virtual/unknown-one.gbr",
        text: "%TF.FileFunction,Paste,Bot*%\n%MOMM*%\nM02*\n",
      },
      {
        name: "mechanical-one.gm1",
        path: "/virtual/mechanical-one.gm1",
        text: "%TF.FileFunction,Profile,NP*%\n%MOMM*%\nM02*\n",
      },
    ]);

    expect(selection.tracespaceFiles.map(row => row.classification)).toEqual([
      expect.objectContaining({name: "unknown-one.gbr", kind: "paste", side: "bottom"}),
      expect.objectContaining({name: "mechanical-one.gm1", kind: "profile", side: "all"}),
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

describe("Gerber 2D project parsing", () => {
  it("parses renderable Gerber layers, drill hits, and via info for downstream IR", async () => {
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

      expect(project.warnings).toEqual([]);
      expect(project.drills).toHaveLength(1);
      expect(project.drills[0]?.hits).toHaveLength(1);
      expect(project.vias).toHaveLength(1);
      expect(project.fragments.boardShapeRenderFragment.svgFragment).toContain("<path");
      expect(Object.values(project.layerClassificationsById)).toEqual([
        expect.objectContaining({kind: "profile", side: "all"}),
        expect.objectContaining({kind: "padMaster", side: "top"}),
        expect.objectContaining({kind: "solderMask", side: "top"}),
        expect.objectContaining({kind: "silkscreen", side: "top"}),
      ]);
      expect(Object.values(project.fragments.svgFragmentsById).join("")).toContain("<circle");
      expect(Object.values(project.fragments.svgFragmentsById).join("")).toContain("<path");
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
