import {parseBomCsv} from "./bom-parser.js";
import {parseCoordinateCsv} from "./coordinate-parser.js";
import type {
  BomCoordinateComponent,
  BomCoordinateProjectInput,
  BomCoordinateParseOptions,
  ParsedBomCoordinateProject,
  ParsedBomCsv,
  ParsedCoordinateCsv,
} from "./types.js";

export function parseBomCoordinateProject(
  input: BomCoordinateProjectInput,
  options: BomCoordinateParseOptions = {}
): ParsedBomCoordinateProject {
  return mergeBomAndCoordinates(
    parseBomCsv(input.bom, options),
    parseCoordinateCsv(input.coordinates, options)
  );
}

export function mergeBomAndCoordinates(
  bom: ParsedBomCsv,
  coordinates: ParsedCoordinateCsv
): ParsedBomCoordinateProject {
  const warnings = [...bom.warnings, ...coordinates.warnings];
  const bomByDesignator = mapByDesignator(bom.components, warnings, "BOM");
  const coordinateByDesignator = mapByDesignator(coordinates.placements, warnings, "coordinate");
  const designators = Array.from(
    new Set([...bomByDesignator.keys(), ...coordinateByDesignator.keys()])
  ).sort(compareDesignators);
  const components: BomCoordinateComponent[] = [];
  const unmatchedBomDesignators: string[] = [];
  const unmatchedCoordinateDesignators: string[] = [];

  for (const designator of designators) {
    const bomComponent = bomByDesignator.get(designator) ?? null;
    const placement = coordinateByDesignator.get(designator) ?? null;
    const mismatches: string[] = [];

    if (bomComponent === null) {
      unmatchedCoordinateDesignators.push(designator);
    }

    if (placement === null) {
      unmatchedBomDesignators.push(designator);
    }

    if (
      bomComponent !== null &&
      placement !== null &&
      bomComponent.footprint &&
      placement.footprint &&
      normalizeComparable(bomComponent.footprint) !== normalizeComparable(placement.footprint)
    ) {
      mismatches.push(
        `footprint differs: BOM=${bomComponent.footprint}, coordinate=${placement.footprint}`
      );
    }

    components.push({
      designator,
      bom: bomComponent,
      placement,
      mismatches,
    });
  }

  if (unmatchedBomDesignators.length > 0) {
    warnings.push(
      `${unmatchedBomDesignators.length} BOM designator(s) have no coordinate placement.`
    );
  }

  if (unmatchedCoordinateDesignators.length > 0) {
    warnings.push(
      `${unmatchedCoordinateDesignators.length} coordinate designator(s) have no BOM entry.`
    );
  }

  return {
    bom,
    coordinates,
    components,
    unmatchedBomDesignators,
    unmatchedCoordinateDesignators,
    warnings,
  };
}

function mapByDesignator<T extends {designator: string}>(
  records: readonly T[],
  warnings: string[],
  label: string
): Map<string, T> {
  const mapped = new Map<string, T>();
  for (const record of records) {
    if (mapped.has(record.designator)) {
      warnings.push(`${label} designator ${record.designator} appears more than once; using the last row.`);
    }
    mapped.set(record.designator, record);
  }
  return mapped;
}

function compareDesignators(left: string, right: string): number {
  const leftParts = splitDesignator(left);
  const rightParts = splitDesignator(right);

  if (leftParts !== null && rightParts !== null) {
    const prefix = leftParts.prefix.localeCompare(rightParts.prefix);
    if (prefix !== 0) return prefix;
    return leftParts.number - rightParts.number;
  }

  return left.localeCompare(right);
}

function splitDesignator(designator: string): {prefix: string; number: number} | null {
  const match = designator.match(/^([A-Za-z]+)(\d+)$/);
  if (!match) return null;
  return {
    prefix: match[1] ?? "",
    number: Number.parseInt(match[2] ?? "0", 10),
  };
}

function normalizeComparable(value: string): string {
  return value.trim().toUpperCase();
}
