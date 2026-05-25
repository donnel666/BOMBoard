import {cleanField, normalizeRawRow, parseCsvRecords, sourceName} from "./csv.js";
import type {
  BomCoordinateInput,
  BomCoordinateParseOptions,
  CoordinateRecord,
  ParsedCoordinateCsv,
  PlacementSide,
  PointMm,
} from "./types.js";

export function parseCoordinateCsv(
  input: BomCoordinateInput,
  options: BomCoordinateParseOptions = {}
): ParsedCoordinateCsv {
  const warnings: string[] = [];
  const placements: CoordinateRecord[] = [];
  const rows = parseCsvRecords(input, options);
  const seenDesignators = new Set<string>();

  rows.forEach((row, index) => {
    const raw = normalizeRawRow(row);
    const sourceRow = index + 2;
    const designator = cleanField(raw.Designator);

    if (!designator) {
      warnings.push(`Coordinate row ${sourceRow} has no designator and was skipped.`);
      return;
    }

    const mid = pointFromRow(raw, "Mid X", "Mid Y");
    const reference = pointFromRow(raw, "Ref X", "Ref Y");
    const pad = pointFromRow(raw, "Pad X", "Pad Y");

    if (mid === null || reference === null || pad === null) {
      warnings.push(`Coordinate row ${sourceRow} for ${designator} has invalid coordinates and was skipped.`);
      return;
    }

    if (seenDesignators.has(designator)) {
      warnings.push(`Coordinate designator ${designator} appears more than once.`);
    }
    seenDesignators.add(designator);

    const rotationDeg = parseRotation(raw.Rotation);
    if (rotationDeg === null) {
      warnings.push(`Coordinate row ${sourceRow} for ${designator} has invalid rotation; using 0 degrees.`);
    }

    placements.push({
      designator,
      footprint: cleanField(raw.Footprint),
      mid,
      reference,
      pad,
      side: parsePlacementSide(raw.Layer),
      rawLayer: cleanField(raw.Layer),
      rotationDeg: rotationDeg ?? 0,
      comment: cleanField(raw.Comment),
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
  const match = field.match(/^(-?\d+(?:\.\d+)?)\s*(mm|mil|mils|in|inch|inches|")?$/i);
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
  const layer = cleanField(value).toLowerCase();
  if (layer === "t" || layer === "top" || layer === "top layer") return "top";
  if (layer === "b" || layer === "bottom" || layer === "bottom layer") return "bottom";
  return "unknown";
}

function pointFromRow(
  row: Record<string, string>,
  xHeader: string,
  yHeader: string
): PointMm | null {
  const xMm = parseLengthMm(row[xHeader]);
  const yMm = parseLengthMm(row[yHeader]);
  if (xMm === null || yMm === null) return null;
  return {xMm, yMm};
}

function parseRotation(value: string | undefined): number | null {
  const parsed = Number.parseFloat(cleanField(value));
  return Number.isFinite(parsed) ? parsed : null;
}
