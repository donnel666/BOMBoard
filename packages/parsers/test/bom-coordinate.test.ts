import {describe, expect, it} from "vitest";
import {strToU8, zipSync} from "fflate";

import {
  classifyBomCoordinateFile,
  classifyBomCoordinateFileName,
  parseBomCoordinateProject,
  parseBomCsv,
  parseCoordinateCsv,
  parseLengthMm,
} from "../src/index.js";

describe("BOM/coordinate file classification", () => {
  it("treats CSV/XLSX names as candidates only", () => {
    expect(classifyBomCoordinateFileName("BOM.csv")).toMatchObject({
      kind: "unknown",
      extension: ".csv",
    });
    expect(classifyBomCoordinateFileName("project-BOM.xlsx")).toMatchObject({
      kind: "unknown",
      extension: ".xlsx",
    });
    expect(classifyBomCoordinateFileName("PickPlaces.csv")).toMatchObject({
      kind: "unknown",
      extension: ".csv",
    });
    expect(classifyBomCoordinateFileName("board.gtl")).toMatchObject({
      kind: "unknown",
    });
  });

  it("classifies BOM and coordinate files by table content", () => {
    expect(classifyBomCoordinateFile({
      name: "random.csv",
      text: `"Comment","Designator","Footprint","Quantity"
"100K","R1,R2","R0603","2"
`,
    })).toMatchObject({
      kind: "bom",
      extension: ".csv",
    });
    expect(classifyBomCoordinateFile({
      name: "unknown.xlsx",
      bytes: workbookBytes([
        ["Layer", "Rotation", "Mid Y", "Designator", "Mid X", "Footprint", "Comment", "Ref X", "Ref Y", "Pad X", "Pad Y"],
        ["B", "90", "2.5mm", "C7", "1.25mm", "C0402", "22uF", "1.25mm", "2.5mm", "1.75mm", "2.5mm"],
      ]),
    })).toMatchObject({
      kind: "coordinates",
      extension: ".xlsx",
    });
  });

  it("classifies centroid-only coordinate files as coordinates", () => {
    expect(classifyBomCoordinateFile({
      name: "centroids.csv",
      text: `Designator,Footprint,Mid X,Mid Y,Layer,Rotation
U1,QFN-32,1mm,2mm,T,90
`,
    })).toMatchObject({
      kind: "coordinates",
      extension: ".csv",
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

  it("parses JLC XLSX BOM rows by column names with shuffled columns", () => {
    const bom = parseBomCsv({
      name: "Vendor-BOM.xlsx",
      bytes: workbookBytes([
        ["Footprint", "Quantity", "Designator", "Comment", "Value", "Manufacturer Part", "Device", "Name"],
        ["R0603", "2", "R38,R88", "100K", "100K", "RC0603FR-07100KL", "RC0603FR-07100KL", "100K"],
        ["C0402", "1", "C7", "22uF", "22uF", "CL05A226MQ5", "CL05A226MQ5", "22uF"],
      ]),
    });

    expect(bom.sourceName).toBe("Vendor-BOM.xlsx");
    expect(bom.warnings).toEqual([]);
    expect(bom.records[0]).toMatchObject({
      comment: "100K",
      description: "",
      designators: ["R38", "R88"],
      footprint: "R0603",
      libRef: "RC0603FR-07100KL",
      pins: null,
      quantity: 2,
      sourceRow: 2,
    });
    expect(bom.components.map(component => component.designator)).toEqual(["R38", "R88", "C7"]);
  });

  it("matches configured BOM column sets before falling back to generic guessing", () => {
    const bom = parseBomCsv({
      name: "kicad-bom.csv",
      text: `"Reference","Value","Footprint","Qty","MPN"
"R1 R2","10K","Resistor_SMD:R_0402_1005Metric","2","RC0402FR-0710KL"
`,
    });

    expect(bom.warnings).toEqual([]);
    expect(bom.records).toHaveLength(1);
    expect(bom.records[0]).toMatchObject({
      comment: "10K",
      designators: ["R1", "R2"],
      footprint: "Resistor_SMD:R_0402_1005Metric",
      libRef: "RC0402FR-0710KL",
      quantity: 2,
    });
    expect(bom.components.map(component => component.designator)).toEqual(["R1", "R2"]);
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
    expect(parseLengthMm("+.5mm")).toBeCloseTo(0.5, 6);
  });

  it("parses Altium pick-and-place mil column units as millimeters", () => {
    const coordinates = parseCoordinateCsv({
      name: "Pick Place.csv",
      text: `Altium Designer Pick and Place Locations
C:\\Projects\\Board\\Pick Place.csv

========================================================================================================================
File Design Information:

Units used: mil

"Designator","Comment","Layer","Footprint","Center-X(mil)","Center-Y(mil)","Rotation","Description"
"R1","10K","TopLayer","R0402","100","-50","90",""
`,
    });

    expect(coordinates.warnings).toEqual([]);
    expect(coordinates.placements).toHaveLength(1);
    expect(coordinates.placements[0]).toMatchObject({
      designator: "R1",
      footprint: "R0402",
      side: "top",
      rawLayer: "TopLayer",
      rotationDeg: 90,
      comment: "10K",
    });
    expect(coordinates.placements[0]?.mid.xMm).toBeCloseTo(2.54, 6);
    expect(coordinates.placements[0]?.mid.yMm).toBeCloseTo(-1.27, 6);
    expect(coordinates.placements[0]?.pad.xMm).toBeCloseTo(2.54, 6);
  });

  it("parses JLC XLSX coordinate rows by column names with shuffled columns", () => {
    const coordinates = parseCoordinateCsv({
      name: "PickPlace.xlsx",
      bytes: workbookBytes([
        ["Layer", "Rotation", "Mid Y", "Designator", "Mid X", "Footprint", "Comment", "Ref X", "Ref Y", "Pad X", "Pad Y"],
        ["B", "90", "2.5mm", "C7", "1.25mm", "C0402", "22uF", "1.25mm", "2.5mm", "1.75mm", "2.5mm"],
      ]),
    });

    expect(coordinates.sourceName).toBe("PickPlace.xlsx");
    expect(coordinates.warnings).toEqual([]);
    expect(coordinates.placements).toHaveLength(1);
    expect(coordinates.placements[0]).toMatchObject({
      designator: "C7",
      footprint: "C0402",
      side: "bottom",
      rawLayer: "B",
      rotationDeg: 90,
      comment: "22uF",
      sourceRow: 2,
    });
    expect(coordinates.placements[0]?.mid.xMm).toBeCloseTo(1.25, 6);
    expect(coordinates.placements[0]?.mid.yMm).toBeCloseTo(2.5, 6);
    expect(coordinates.placements[0]?.pad.xMm).toBeCloseTo(1.75, 6);
  });

  it("uses centroid coordinates when reference and pin-1 coordinates are absent", () => {
    const coordinates = parseCoordinateCsv({
      name: "Centroids.csv",
      text: `Designator,Footprint,Mid X,Mid Y,Layer,Rotation
U1,QFN-32,1mm,2mm,T,90
`,
    });

    expect(coordinates.warnings).toEqual([]);
    expect(coordinates.placements).toHaveLength(1);
    expect(coordinates.placements[0]).toMatchObject({
      designator: "U1",
      footprint: "QFN-32",
      side: "top",
      rotationDeg: 90,
    });
    expect(coordinates.placements[0]?.mid).toEqual({xMm: 1, yMm: 2});
    expect(coordinates.placements[0]?.reference).toEqual({xMm: 1, yMm: 2});
    expect(coordinates.placements[0]?.pad).toEqual({xMm: 1, yMm: 2});
  });

  it("selects the coordinate sheet from a multi-sheet XLSX by column content", () => {
    const coordinates = parseCoordinateCsv({
      name: "combined-export.xlsx",
      bytes: multiSheetWorkbookBytes([
        {
          name: "BOM",
          rows: [
            ["Comment", "Designator", "Footprint", "Quantity"],
            ["100K", "R1,R2", "R0603", "2"],
          ],
        },
        {
          name: "PickPlace",
          rows: [
            ["Designator", "Footprint", "Mid X", "Mid Y", "Layer", "Rotation"],
            ["U1", "QFN-32", "1mm", "2mm", "T", "90"],
          ],
        },
      ]),
    });

    expect(coordinates.warnings).toEqual([]);
    expect(coordinates.placements).toHaveLength(1);
    expect(coordinates.placements[0]).toMatchObject({
      designator: "U1",
      footprint: "QFN-32",
      sourceRow: 2,
    });
  });

  it("matches configured coordinate column sets before falling back to generic guessing", () => {
    const coordinates = parseCoordinateCsv({
      name: "kicad-position.csv",
      text: `"Reference","Val","Package","PosX","PosY","Rot","Side"
"U1","MCU","QFN-32","12.5mm","-4.25mm","270","bottom"
`,
    });

    expect(coordinates.warnings).toEqual([]);
    expect(coordinates.placements).toHaveLength(1);
    expect(coordinates.placements[0]).toMatchObject({
      designator: "U1",
      footprint: "QFN-32",
      comment: "MCU",
      side: "bottom",
      rotationDeg: 270,
    });
    expect(coordinates.placements[0]?.mid.xMm).toBeCloseTo(12.5, 6);
    expect(coordinates.placements[0]?.mid.yMm).toBeCloseTo(-4.25, 6);
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

function workbookBytes(rows: unknown[][]): Uint8Array {
  return multiSheetWorkbookBytes([{name: "Sheet1", rows}]);
}

function multiSheetWorkbookBytes(sheets: Array<{name: string; rows: unknown[][]}>): Uint8Array {
  return zipSync({
    "[Content_Types].xml": xmlFile(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets.map((_, index) => `  <Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
</Types>`),
    "_rels/.rels": xmlFile(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    "xl/workbook.xml": xmlFile(`<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
${sheets.map((sheet, index) => `    <sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("\n")}
  </sheets>
</workbook>`),
    "xl/_rels/workbook.xml.rels": xmlFile(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, index) => `  <Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("\n")}
</Relationships>`),
    ...Object.fromEntries(sheets.map((sheet, index) => [
      `xl/worksheets/sheet${index + 1}.xml`,
      xmlFile(worksheetXml(sheet.rows)),
    ])),
  });
}

function worksheetXml(rows: unknown[][]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
${rows.map((row, rowIndex) => `    <row r="${rowIndex + 1}">${row.map((value, columnIndex) => cellXml(value, rowIndex, columnIndex)).join("")}</row>`).join("\n")}
  </sheetData>
</worksheet>`;
}

function cellXml(value: unknown, rowIndex: number, columnIndex: number): string {
  return `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${escapeXml(String(value ?? ""))}</t></is></c>`;
}

function columnName(columnIndex: number): string {
  let index = columnIndex + 1;
  let name = "";

  while (index > 0) {
    const remainder = (index - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    index = Math.floor((index - 1) / 26);
  }

  return name;
}

function xmlFile(xml: string): Uint8Array {
  return strToU8(xml);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
