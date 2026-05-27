import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {describe, expect, it} from "vitest";

import {parseManufacturingProject} from "../src/index.js";

describe("manufacturing project IR", () => {
  it("wraps Gerber, BOM, and coordinate inputs into BOMBoard Project IR", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bomboard-manufacturing-ir-"));

    try {
      const gerbers = [
        writeFixture(dir, "unit.gm", `%FSLAX44Y44*%
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
`),
        writeFixture(dir, "unit.gtl", `%FSLAX44Y44*%
%MOMM*%
%ADD10C,1.0000*%
D10*
X50000Y50000D03*
M02*
`),
        writeFixture(dir, "unit.txt", `M48
;FILE_FORMAT=3:3
METRIC,TZ
;TYPE=PLATED
T01C0.300
%
T01
X005000Y005000
`),
      ];

      const project = await parseManufacturingProject({
        sourceName: "unit-board",
        bom: {
          name: "bom.csv",
          text: `"Comment","Designator","Footprint","Quantity"
"10k","R1","R_0603","1"
`,
        },
        coordinates: {
          name: "pick-place.csv",
          text: `Designator,Footprint,Mid X,Mid Y,Layer,Rotation
R1,R_0603,12.5mm,8mm,TopLayer,90
`,
        },
        gerbers,
        createdAt: "2026-05-27T00:00:00.000Z",
      });

      expect(project).toMatchObject({
        format: "bomboard-project-v1",
        schemaVersion: 1,
        metadata: {
          title: "unit-board",
          sourceName: "unit-board",
          createdAt: "2026-05-27T00:00:00.000Z",
        },
        coordinateSystem: {
          units: "mm",
          origin: "board",
          xAxis: "right",
          yAxis: "down",
          angleUnit: "deg",
          angleDirection: "clockwise",
          bottomMirroredInModel: false,
        },
      });
      expect(project.sources.map(source => [source.name, source.role])).toEqual([
        ["bom.csv", "bom"],
        ["pick-place.csv", "coordinate"],
        ["unit.gm", "gerber"],
        ["unit.gtl", "gerber"],
        ["unit.txt", "drill"],
      ]);
      expect(project.board.layers.map(layer => [layer.name, layer.function, layer.side])).toEqual([
        ["unit.gm", "outline", "both"],
        ["unit.gtl", "copper", "top"],
      ]);
      expect(project.board.artwork.layers.map(layer => [layer.layerId, layer.side, layer.function])).toEqual([
        ["board-shape", "top", "outline"],
        ["board-shape", "bottom", "outline"],
        [expect.any(String), "top", "outline"],
        [expect.any(String), "bottom", "outline"],
        [expect.any(String), "top", "copper"],
      ]);
      expect(project.board.artwork.layers.every(layer => layer.primitives.length > 0)).toBe(true);
      expect(project.board.artwork.layers.flatMap(layer => layer.primitives).map(primitive => primitive.kind)).toContain("path");
      expect(project.board.artwork.drillHits).toEqual([
        expect.objectContaining({
          position: {x: 5, y: -5},
          diameter: 0.3,
          plated: true,
        }),
      ]);
      expect(project.bom.items).toEqual([
        expect.objectContaining({
          id: "bom:0",
          refs: ["R1"],
          quantity: 1,
          value: "10k",
          footprint: "R_0603",
        }),
      ]);
      expect(project.components).toEqual([
        expect.objectContaining({
          id: "component:R1",
          ref: "R1",
          value: "10k",
          footprint: "R_0603",
          side: "top",
          position: {x: 12.5, y: -8},
          rotationDeg: 90,
          placement: expect.objectContaining({
            mid: {x: 12.5, y: -8},
            pad: {x: 12.5, y: -8},
            side: "top",
          }),
          bomItemId: "bom:0",
          diagnostics: [],
        }),
      ]);
      expect(project.diagnostics).toEqual([]);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});

function writeFixture(dir: string, name: string, text: string): {name: string; path: string; text: string} {
  const path = join(dir, name);
  writeFileSync(path, text);
  return {name, path, text};
}
