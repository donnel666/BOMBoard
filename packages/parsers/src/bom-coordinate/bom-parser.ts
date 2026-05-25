import {cleanField, normalizeRawRow, parseCsvRecords, sourceName} from "./csv.js";
import type {
  BomComponent,
  BomCoordinateInput,
  BomCoordinateParseOptions,
  BomRecord,
  ParsedBomCsv,
} from "./types.js";

export function parseBomCsv(
  input: BomCoordinateInput,
  options: BomCoordinateParseOptions = {}
): ParsedBomCsv {
  const warnings: string[] = [];
  const records: BomRecord[] = [];
  const components: BomComponent[] = [];
  const rows = parseCsvRecords(input, options);
  const seenDesignators = new Set<string>();

  rows.forEach((row, index) => {
    const raw = normalizeRawRow(row);
    const sourceRow = index + 2;
    const designators = splitDesignators(raw.Designator);

    if (designators.length === 0) {
      warnings.push(`BOM row ${sourceRow} has no designator and was skipped.`);
      return;
    }

    const quantity = parseInteger(raw.Quantity);
    const record: BomRecord = {
      comment: cleanField(raw.Comment),
      description: cleanField(raw.Description),
      designators,
      footprint: cleanField(raw.Footprint),
      libRef: cleanField(raw.LibRef),
      pins: parseInteger(raw.Pins),
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
