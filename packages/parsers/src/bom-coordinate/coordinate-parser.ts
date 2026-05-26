import {
  cleanField,
  parseBomCoordinateTableCandidates,
  readField,
  sourceName,
} from "./csv.js";
import {
  matchConfiguredTableFormat,
  readConfiguredTableField,
} from "./table-format-rules.js";
import type {BomCoordinateTableCandidate, BomCoordinateTableRow} from "./csv.js";
import type {MatchedTableFormat, TableFieldKey} from "./table-format-rules.js";
import type {
  BomCoordinateInput,
  BomCoordinateParseOptions,
  CoordinateRecord,
  ParsedCoordinateCsv,
  PlacementSide,
  PointMm,
} from "./types.js";

const designatorColumns = [
  "Designator",
  "Ref",
  "Ref Des",
  "Reference Designator",
  "Reference Designators",
  "RefDes",
  "Component",
  "位号",
];

const footprintColumns = [
  "Footprint",
  "PCB Footprint",
  "Package",
  "Encapsulation",
  "封装",
];

const midXColumns = [
  "Mid X",
  "MidX",
  "Center X",
  "Centroid X",
  "Pos X",
  "Position X",
  "Coordinate X",
  "Location X",
  "X",
  "中心X",
  "X坐标",
];

const midYColumns = [
  "Mid Y",
  "MidY",
  "Center Y",
  "Centroid Y",
  "Pos Y",
  "Position Y",
  "Coordinate Y",
  "Location Y",
  "Y",
  "中心Y",
  "Y坐标",
];

const referenceXColumns = [
  "Ref X",
  "RefX",
  "Reference X",
  "Origin X",
];

const referenceYColumns = [
  "Ref Y",
  "RefY",
  "Reference Y",
  "Origin Y",
];

const padXColumns = [
  "Pad X",
  "PadX",
  "Pin 1 X",
  "Pin1 X",
  "Pin1X",
];

const padYColumns = [
  "Pad Y",
  "PadY",
  "Pin 1 Y",
  "Pin1 Y",
  "Pin1Y",
];

const layerColumns = [
  "Layer",
  "Side",
  "Board Side",
  "Placement Side",
  "Top/Bottom",
  "层",
  "板面",
];

const rotationColumns = [
  "Rotation",
  "Rot",
  "Angle",
  "Theta",
  "Rotation Angle",
  "旋转",
  "角度",
];

const pinsColumns = [
  "Pins",
  "Pin Count",
  "PinCount",
  "Pad Count",
  "Pads",
  "引脚数",
  "焊盘数",
];

const commentColumns = [
  "Comment",
  "Value",
  "Name",
  "LCSC Part Name",
  "名称",
];

const bomOnlyColumns = [
  "Quantity",
  "Qty",
  "LibRef",
  "Manufacturer Part",
  "Manufacturer Part Number",
  "Supplier Part",
  "Device",
  "数量",
  "料号",
];

interface SelectedCoordinateTable {
  rows: BomCoordinateTableRow[];
  format: MatchedTableFormat | null;
}

export function parseCoordinateCsv(
  input: BomCoordinateInput,
  options: BomCoordinateParseOptions = {}
): ParsedCoordinateCsv {
  const warnings: string[] = [];
  const placements: CoordinateRecord[] = [];
  const table = selectCoordinateTable(input, options);
  const rows = table.rows;
  const seenDesignators = new Set<string>();

  rows.forEach(row => {
    const raw = row.raw;
    const sourceRow = row.sourceRow;
    const designator = cleanField(field(raw, table.format, "designator", designatorColumns));

    if (!designator) {
      warnings.push(`Coordinate row ${sourceRow} has no designator and was skipped.`);
      return;
    }

    const mid = pointFromRow(raw, table.format, "midX", midXColumns, "midY", midYColumns);
    if (mid === null) {
      warnings.push(`Coordinate row ${sourceRow} for ${designator} has invalid coordinates and was skipped.`);
      return;
    }
    const reference = pointFromRow(raw, table.format, "refX", referenceXColumns, "refY", referenceYColumns) ?? {...mid};
    const pad = pointFromRow(raw, table.format, "padX", padXColumns, "padY", padYColumns) ?? {...mid};

    if (seenDesignators.has(designator)) {
      warnings.push(`Coordinate designator ${designator} appears more than once.`);
    }
    seenDesignators.add(designator);

    const rotationDeg = parseRotation(field(raw, table.format, "rotation", rotationColumns));
    if (rotationDeg === null) {
      warnings.push(`Coordinate row ${sourceRow} for ${designator} has invalid rotation; using 0 degrees.`);
    }

    placements.push({
      designator,
      footprint: cleanField(field(raw, table.format, "footprint", footprintColumns)),
      mid,
      reference,
      pad,
      side: parsePlacementSide(field(raw, table.format, "layer", layerColumns)),
      rawLayer: cleanField(field(raw, table.format, "layer", layerColumns)),
      rotationDeg: rotationDeg ?? 0,
      pins: parseInteger(field(raw, table.format, "pins", pinsColumns)),
      comment: cleanField(field(raw, table.format, "comment", commentColumns)),
      sourceRow,
      raw,
    });
  });

  return {
    sourceName: sourceName(input),
    placements,
    warnings,
  };
}

export function parseLengthMm(value: string | undefined): number | null {
  const field = cleanField(value);
  const match = field.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(mm|mil|mils|in|inch|inches|")?$/i);
  if (!match) return null;

  const amount = Number.parseFloat(match[1] ?? "");
  if (!Number.isFinite(amount)) return null;

  const unit = (match[2] ?? "mm").toLowerCase();
  if (unit === "mm") return amount;
  if (unit === "mil" || unit === "mils") return amount * 0.0254;
  if (unit === "in" || unit === "inch" || unit === "inches" || unit === '"') return amount * 25.4;
  return null;
}

export function parsePlacementSide(value: string | undefined): PlacementSide {
  const layer = cleanField(value).normalize("NFKC").toLowerCase();
  if (
    layer === "t" ||
    layer === "top" ||
    layer === "top layer" ||
    layer === "toplayer" ||
    layer === "front" ||
    layer === "f" ||
    layer === "顶层" ||
    layer === "正面"
  ) {
    return "top";
  }
  if (
    layer === "b" ||
    layer === "bottom" ||
    layer === "bottom layer" ||
    layer === "back" ||
    layer === "bottomlayer" ||
    layer === "底层" ||
    layer === "反面"
  ) {
    return "bottom";
  }
  return "unknown";
}

function pointFromRow(
  row: Record<string, string>,
  format: MatchedTableFormat | null,
  xField: TableFieldKey,
  xAliases: readonly string[],
  yField: TableFieldKey,
  yAliases: readonly string[]
): PointMm | null {
  const xMm = parseLengthMm(field(row, format, xField, xAliases));
  const yMm = parseLengthMm(field(row, format, yField, yAliases));
  if (xMm === null || yMm === null) return null;
  return {xMm, yMm};
}

function selectCoordinateTable(
  input: BomCoordinateInput,
  options: BomCoordinateParseOptions
): SelectedCoordinateTable {
  const candidates = parseBomCoordinateTableCandidates(input, options);
  if (candidates.length === 0) return {rows: [], format: null};

  const configuredTable = selectConfiguredCoordinateTable(candidates);
  if (configuredTable) return configuredTable;

  let bestCandidate = candidates[0] as BomCoordinateTableCandidate;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const score = scoreCoordinateCandidate(candidate);
    if (score > bestScore) {
      bestCandidate = candidate;
      bestScore = score;
    }
  }

  return {
    rows: bestCandidate.rows,
    format: null,
  };
}

function selectConfiguredCoordinateTable(candidates: BomCoordinateTableCandidate[]): SelectedCoordinateTable | null {
  let bestTable: SelectedCoordinateTable | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const format = matchConfiguredTableFormat("coordinates", candidate);
    if (!format) continue;
    if (format.score > bestScore) {
      bestTable = {
        rows: candidate.rows,
        format,
      };
      bestScore = format.score;
    }
  }

  return bestTable;
}

function scoreCoordinateCandidate(candidate: BomCoordinateTableCandidate): number {
  let score = 0;
  let validCoordinateRows = 0;

  for (const row of candidate.rows) {
    const raw = row.raw;
    const designator = cleanField(fallbackField(raw, designatorColumns));
    if (!designator) continue;

    const mid = fallbackPointFromRow(raw, midXColumns, midYColumns);
    if (mid === null) continue;

    validCoordinateRows += 1;
    score += 100;

    if (cleanField(fallbackField(raw, footprintColumns)) !== "") score += 6;
    if (parsePlacementSide(fallbackField(raw, layerColumns)) !== "unknown") score += 6;
    if (parseRotation(fallbackField(raw, rotationColumns)) !== null) score += 3;
    if (fallbackPointFromRow(raw, referenceXColumns, referenceYColumns) !== null) score += 2;
    if (fallbackPointFromRow(raw, padXColumns, padYColumns) !== null) score += 2;
    if (cleanField(fallbackField(raw, commentColumns)) !== "") score += 1;
    if (cleanField(fallbackField(raw, bomOnlyColumns)) !== "") score -= 10;
  }

  return validCoordinateRows > 0 ? score : 0;
}

function field(
  row: Record<string, string>,
  format: MatchedTableFormat | null,
  fieldName: TableFieldKey,
  aliases: readonly string[]
): string | undefined {
  return readConfiguredTableField(row, format, fieldName, aliases);
}

function fallbackField(row: Record<string, string>, aliases: readonly string[]): string | undefined {
  return readField(row, aliases);
}

function fallbackPointFromRow(
  row: Record<string, string>,
  xAliases: readonly string[],
  yAliases: readonly string[]
): PointMm | null {
  const xMm = parseLengthMm(fallbackField(row, xAliases));
  const yMm = parseLengthMm(fallbackField(row, yAliases));
  if (xMm === null || yMm === null) return null;
  return {xMm, yMm};
}

function parseRotation(value: string | undefined): number | null {
  const parsed = Number.parseFloat(cleanField(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: string | undefined): number | null {
  const parsed = Number.parseInt(cleanField(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
