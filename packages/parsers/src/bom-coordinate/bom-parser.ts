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
import type {MatchedTableFormat} from "./table-format-rules.js";
import type {
  BomComponent,
  BomCoordinateInput,
  BomCoordinateParseOptions,
  BomRecord,
  ParsedBomCsv,
} from "./types.js";

const designatorColumns = [
  "Designator",
  "Reference Designator",
  "Reference Designators",
  "RefDes",
  "位号",
];

const commentColumns = [
  "Comment",
  "Value",
  "Name",
  "名称",
];

const descriptionColumns = [
  "Description",
  "LCSC Part Name",
  "描述",
];

const footprintColumns = [
  "Footprint",
  "Package",
  "Encapsulation",
  "封装",
];

const libRefColumns = [
  "LibRef",
  "Manufacturer Part",
  "Manufacturer Part Number",
  "Supplier Part",
  "Device",
  "料号",
];

const pinsColumns = [
  "Pins",
];

const quantityColumns = [
  "Quantity",
  "Qty",
  "数量",
];

const coordinateXColumns = [
  "Mid X",
  "MidX",
  "Center X",
  "Centroid X",
  "Pos X",
  "Position X",
  "X",
  "中心X",
  "X坐标",
];

const coordinateYColumns = [
  "Mid Y",
  "MidY",
  "Center Y",
  "Centroid Y",
  "Pos Y",
  "Position Y",
  "Y",
  "中心Y",
  "Y坐标",
];

interface SelectedBomTable {
  rows: BomCoordinateTableRow[];
  format: MatchedTableFormat | null;
}

export function parseBomCsv(
  input: BomCoordinateInput,
  options: BomCoordinateParseOptions = {}
): ParsedBomCsv {
  const warnings: string[] = [];
  const records: BomRecord[] = [];
  const components: BomComponent[] = [];
  const table = selectBomTable(input, options);
  const rows = table.rows;
  const seenDesignators = new Set<string>();

  rows.forEach(row => {
    const raw = row.raw;
    const sourceRow = row.sourceRow;
    const designators = splitDesignators(field(raw, table.format, "designator", designatorColumns));

    if (designators.length === 0) {
      warnings.push(`BOM row ${sourceRow} has no designator and was skipped.`);
      return;
    }

    const quantity = parseInteger(field(raw, table.format, "quantity", quantityColumns));
    const record: BomRecord = {
      comment: cleanField(field(raw, table.format, "comment", commentColumns)),
      description: cleanField(field(raw, table.format, "description", descriptionColumns)),
      designators,
      footprint: cleanField(field(raw, table.format, "footprint", footprintColumns)),
      libRef: cleanField(field(raw, table.format, "libRef", libRefColumns)),
      pins: parseInteger(field(raw, table.format, "pins", pinsColumns)),
      quantity: quantity ?? designators.length,
      sourceRow,
      raw,
    };

    if (quantity !== null && quantity !== designators.length) {
      warnings.push(
        `BOM row ${sourceRow} quantity ${quantity} does not match ${designators.length} designator(s).`
      );
    }

    const bomRecordIndex = records.length;
    records.push(record);

    for (const designator of designators) {
      if (seenDesignators.has(designator)) {
        warnings.push(`BOM designator ${designator} appears more than once.`);
      }
      seenDesignators.add(designator);
      components.push({
        designator,
        comment: record.comment,
        description: record.description,
        footprint: record.footprint,
        libRef: record.libRef,
        pins: record.pins,
        bomRecordIndex,
      });
    }
  });

  return {
    sourceName: sourceName(input),
    records,
    components,
    warnings,
  };
}

function selectBomTable(
  input: BomCoordinateInput,
  options: BomCoordinateParseOptions
): SelectedBomTable {
  const candidates = parseBomCoordinateTableCandidates(input, options);
  if (candidates.length === 0) return {rows: [], format: null};

  const configuredTable = selectConfiguredBomTable(candidates);
  if (configuredTable) return configuredTable;

  let bestCandidate = candidates[0] as BomCoordinateTableCandidate;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const score = scoreBomCandidate(candidate);
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

function selectConfiguredBomTable(candidates: BomCoordinateTableCandidate[]): SelectedBomTable | null {
  let bestTable: SelectedBomTable | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const format = matchConfiguredTableFormat("bom", candidate);
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

function scoreBomCandidate(candidate: BomCoordinateTableCandidate): number {
  let designatorRows = 0;
  let footprintRows = 0;
  let valueRows = 0;
  let libRefRows = 0;
  let quantityRows = 0;
  let coordinateRows = 0;

  for (const row of candidate.rows) {
    const raw = row.raw;
    if (splitDesignators(fallbackField(raw, designatorColumns)).length > 0) designatorRows += 1;
    if (cleanField(fallbackField(raw, footprintColumns)) !== "") footprintRows += 1;
    if (
      cleanField(fallbackField(raw, commentColumns)) !== ""
      || cleanField(fallbackField(raw, descriptionColumns)) !== ""
    ) {
      valueRows += 1;
    }
    if (cleanField(fallbackField(raw, libRefColumns)) !== "") libRefRows += 1;
    if (parseInteger(fallbackField(raw, quantityColumns)) !== null) quantityRows += 1;
    if (hasCoordinateColumns(raw)) coordinateRows += 1;
  }

  if (designatorRows === 0) return 0;

  return designatorRows * 20
    + libRefRows * 12
    + quantityRows * 10
    + valueRows * 6
    + footprintRows * 4
    - coordinateRows * 30;
}

function field(
  row: Record<string, string>,
  format: MatchedTableFormat | null,
  fieldName: Parameters<typeof readConfiguredTableField>[2],
  aliases: readonly string[]
): string | undefined {
  return readConfiguredTableField(row, format, fieldName, aliases);
}

function fallbackField(row: Record<string, string>, aliases: readonly string[]): string | undefined {
  return readField(row, aliases);
}

function splitDesignators(value: string | undefined): string[] {
  return cleanField(value)
    .split(/[,\s;]+/)
    .map(designator => cleanField(designator))
    .filter(Boolean);
}

function parseInteger(value: string | undefined): number | null {
  const parsed = Number.parseInt(cleanField(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasCoordinateColumns(row: Record<string, string>): boolean {
  return cleanField(fallbackField(row, coordinateXColumns)) !== ""
    && cleanField(fallbackField(row, coordinateYColumns)) !== "";
}
