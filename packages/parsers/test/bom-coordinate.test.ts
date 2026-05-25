import {describe, expect, it} from "vitest";

import {
  classifyBomCoordinateFileName,
  parseBomCoordinateProject,
  parseBomCsv,
  parseCoordinateCsv,
  parseLengthMm,
} from "../src/index.js";

describe("BOM/coordinate file classification", () => {
  it("recognizes BOM and pick-place CSV filenames", () => {
    expect(classifyBomCoordinateFileName("BOM.csv")).toMatchObject({
      kind: "bom",
      extension: ".csv",
    });
    expect(classifyBomCoordinateFileName("PickPlaces.csv")).toMatchObject({
      kind: "coordinates",
      extension: ".csv",
    });
    expect(classifyBomCoordinateFileName("board.gtl")).toMatchObject({
      kind: "unknown",
    });
  });
});

describe("BOM CSV parsing", () => {
  it("parses grouped designators and strips control characters from footprints", () => {
    const controlPrefix = "\u001f";
    const bom = parseBomCsv({
      name: "BOM.csv",
      text: `"Comment","Description","Designator","Footprint","LibRef","Pins","Quantity"
"100K","","R38,R88","${controlPrefix}R0603","Res_0603","2","2"
"22uF","bulk capacitor","C7","${controlPrefix}C1206","CAP_1206","2","1"
`,
    });

    expect(bom.sourceName).toBe("BOM.csv");
    expect(bom.warnings).toEqual([]);
    expect(bom.records).toHaveLength(2);
    expect(bom.records[0]).toMatchObject({
      comment: "100K",
      designators: ["R38", "R88"],
      footprint: "R0603",
      quantity: 2,
    });
    expect(bom.components.map(component => component.designator)).toEqual(["R38", "R88", "C7"]);
    expect(bom.components[0]).toMatchObject({
      footprint: "R0603",
      pins: 2,
      bomRecordIndex: 0,
    });
  });
});

describe("coordinate CSV parsing", () => {
  it("decodes GB18030 bytes and normalizes coordinate values to millimeters", () => {
    const head = `"Designator","Footprint","Mid X","Mid Y","Ref X","Ref Y","Pad X","Pad Y","Layer","Rotation","Comment"
"USB1","USB-A-TH_AF-WJDG","18.796mm","11.811mm","18.796mm","11.807mm","15.276mm","13.162mm","T","0","AF 90`;
    const tail = ` WJDG"
`;
    const csvBytes = new Uint8Array([
      ...Buffer.from(head, "ascii"),
      0xa1,
      0xe3,
      ...Buffer.from(tail, "ascii"),
    ]);

    const coordinates = parseCoordinateCsv({name: "PickPlaces.csv", bytes: csvBytes});

    expect(coordinates.sourceName).toBe("PickPlaces.csv");
    expect(coordinates.warnings).toEqual([]);
    expect(coordinates.placements).toHaveLength(1);
    expect(coordinates.placements[0]).toMatchObject({
      designator: "USB1",
      footprint: "USB-A-TH_AF-WJDG",
      side: "top",
      rawLayer: "T",
      rotationDeg: 0,
      comment: "AF 90\u00b0 WJDG",
    });
    expect(coordinates.placements[0]?.mid.xMm).toBeCloseTo(18.796, 6);
    expect(coordinates.placements[0]?.mid.yMm).toBeCloseTo(11.811, 6);
    expect(coordinates.placements[0]?.pad.xMm).toBeCloseTo(15.276, 6);
  });

  it("supports common coordinate units", () => {
    expect(parseLengthMm("1in")).toBeCloseTo(25.4, 6);
    expect(parseLengthMm("100mil")).toBeCloseTo(2.54, 6);
    expect(parseLengthMm("2.5mm")).toBeCloseTo(2.5, 6);
  });
});

describe("BOM/coordinate project parsing", () => {
  it("joins BOM entries with coordinate placements by designator", () => {
    const controlPrefix = "\u001f";
    const project = parseBomCoordinateProject({
      bom: `"Comment","Description","Designator","Footprint","LibRef","Pins","Quantity"
"100K","","R38,R88","${controlPrefix}R0603","Res_0603","2","2"
`,
      coordinates: `"Designator","Footprint","Mid X","Mid Y","Ref X","Ref Y","Pad X","Pad Y","Layer","Rotation","Comment"
"R38","R0603","1mm","2mm","1mm","2mm","1.7mm","2mm","T","0","100K"
"U1","QFN-32","3mm","4mm","3mm","4mm","3.5mm","4mm","B","90","MCU"
`,
    });

    expect(project.components.map(component => component.designator)).toEqual(["R38", "R88", "U1"]);
    expect(project.components[0]).toMatchObject({
      designator: "R38",
      mismatches: [],
    });
    expect(project.components[0]?.bom?.comment).toBe("100K");
    expect(project.components[0]?.placement?.side).toBe("top");
    expect(project.components[2]?.placement?.side).toBe("bottom");
    expect(project.unmatchedBomDesignators).toEqual(["R88"]);
    expect(project.unmatchedCoordinateDesignators).toEqual(["U1"]);
    expect(project.warnings).toContain("1 BOM designator(s) have no coordinate placement.");
    expect(project.warnings).toContain("1 coordinate designator(s) have no BOM entry.");
  });
});
