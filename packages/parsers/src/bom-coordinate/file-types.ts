import {parseBomCsv} from "./bom-parser.js";
import {parseCoordinateCsv} from "./coordinate-parser.js";

import type {
  BomCoordinateFileClassification,
  BomCoordinateFileKind,
  BomCoordinateInput,
  BomCoordinateParseOptions,
  ParsedBomCsv,
  ParsedCoordinateCsv,
} from "./types.js";

export function classifyBomCoordinateFileName(fileName: string): BomCoordinateFileClassification {
  const name = baseName(fileName);
  const lowerName = name.toLowerCase();
  const extension = getExtension(lowerName);

  if (!isBomCoordinateExtension(extension)) {
    return classification(name, extension, "unknown", "not a BOM/coordinate table candidate");
  }

  return classification(name, extension, "unknown", "BOM/coordinate table candidate; content classification required");
}

export function classifyBomCoordinateFile(
  input: BomCoordinateInput,
  options: BomCoordinateParseOptions = {}
): BomCoordinateFileClassification {
  const name = inputName(input);
  const lowerName = name.toLowerCase();
  const extension = getExtension(lowerName);

  if (!isBomCoordinateExtension(extension)) {
    return classification(name, extension, "unknown", "not a BOM/coordinate table candidate");
  }

  const coordinateScore = scoreCoordinateInput(input, options);
  const bomScore = scoreBomInput(input, options);

  if (coordinateScore > 0 && coordinateScore >= bomScore) {
    return classification(name, extension, "coordinates", "coordinate/pick-place table content");
  }

  if (bomScore > 0) {
    return classification(name, extension, "bom", "BOM table content");
  }

  return classification(name, extension, "unknown", "unrecognized BOM/coordinate table content");
}

function scoreBomInput(
  input: BomCoordinateInput,
  options: BomCoordinateParseOptions
): number {
  const parsed = parseSafely(() => parseBomCsv(input, options));
  if (!parsed || parsed.components.length === 0) return 0;

  const hasFootprint = parsed.components.some(component => component.footprint !== "");
  const hasValue = parsed.components.some(component => component.comment !== "" || component.description !== "");
  const hasPart = parsed.components.some(component => component.libRef !== "");

  return 3
    + (hasFootprint ? 1 : 0)
    + (hasValue ? 1 : 0)
    + (hasPart ? 1 : 0);
}

function scoreCoordinateInput(
  input: BomCoordinateInput,
  options: BomCoordinateParseOptions
): number {
  const parsed = parseSafely(() => parseCoordinateCsv(input, options));
  if (!parsed || parsed.placements.length === 0) return 0;

  const hasFootprint = parsed.placements.some(placement => placement.footprint !== "");
  const hasSide = parsed.placements.some(placement => placement.side !== "unknown");
  const hasComment = parsed.placements.some(placement => placement.comment !== "");

  return 6
    + (hasFootprint ? 1 : 0)
    + (hasSide ? 1 : 0)
    + (hasComment ? 1 : 0);
}

function parseSafely<TParsed extends ParsedBomCsv | ParsedCoordinateCsv>(
  parse: () => TParsed
): TParsed | null {
  try {
    return parse();
  } catch {
    return null;
  }
}

function inputName(input: BomCoordinateInput): string {
  if (typeof input === "object" && !(input instanceof Uint8Array) && input.name) {
    return baseName(input.name);
  }

  return "";
}

function baseName(pathOrName: string): string {
  return pathOrName.split(/[\\/]/).pop() ?? pathOrName;
}

function getExtension(lowerName: string): string {
  const index = lowerName.lastIndexOf(".");
  return index === -1 ? "" : lowerName.slice(index);
}

function isBomCoordinateExtension(extension: string): boolean {
  return extension === ".csv"
    || extension === ".xlsx"
    || extension === ".xlsm";
}

function classification(
  name: string,
  extension: string,
  kind: BomCoordinateFileKind,
  reason: string
): BomCoordinateFileClassification {
  return {name, extension, kind, reason};
}
