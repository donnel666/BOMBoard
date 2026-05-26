import {
  cleanField,
  columnKeyCandidatesFor,
  readField,
} from "./csv.js";
import tableRulesData from "./table-rules.json" with {type: "json"};

import type {BomCoordinateTableCandidate} from "./csv.js";

export type TableFormatKind = "bom" | "coordinates";

export type TableFieldKey =
  | "designator"
  | "comment"
  | "description"
  | "footprint"
  | "libRef"
  | "pins"
  | "quantity"
  | "midX"
  | "midY"
  | "refX"
  | "refY"
  | "padX"
  | "padY"
  | "layer"
  | "rotation";

interface TableRulesConfig {
  formats: ConfiguredTableFormat[];
}

interface ConfiguredTableFormat {
  id: string;
  kind: TableFormatKind;
  software: string;
  priority?: number;
  description: string;
  match: {
    requiredFields?: TableFieldKey[];
    anyFields?: TableFieldKey[];
    rejectFields?: TableFieldKey[];
  };
  fields: Partial<Record<TableFieldKey, string[]>>;
}

export interface MatchedTableFormat {
  id: string;
  kind: TableFormatKind;
  software: string;
  description: string;
  fields: Partial<Record<TableFieldKey, string[]>>;
  score: number;
}

const tableRules = tableRulesData as TableRulesConfig;

export function matchConfiguredTableFormat(
  kind: TableFormatKind,
  candidate: BomCoordinateTableCandidate
): MatchedTableFormat | null {
  const columnKeys = candidateColumnKeys(candidate);
  let bestMatch: MatchedTableFormat | null = null;

  for (const rule of tableRules.formats) {
    if (rule.kind !== kind) continue;
    const score = scoreConfiguredFormat(rule, candidate, columnKeys);
    if (score === null) continue;

    const match: MatchedTableFormat = {
      id: rule.id,
      kind: rule.kind,
      software: rule.software,
      description: rule.description,
      fields: rule.fields,
      score,
    };

    if (!bestMatch || match.score > bestMatch.score) {
      bestMatch = match;
    }
  }

  return bestMatch;
}

export function readConfiguredTableField(
  row: Record<string, string>,
  format: MatchedTableFormat | null,
  field: TableFieldKey,
  fallbackAliases: readonly string[]
): string | undefined {
  const configuredAliases = format?.fields[field] ?? [];
  if (configuredAliases.length > 0) {
    const configuredValue = readField(row, configuredAliases);
    if (configuredValue !== undefined) return configuredValue;
  }

  return readField(row, fallbackAliases);
}

function scoreConfiguredFormat(
  rule: ConfiguredTableFormat,
  candidate: BomCoordinateTableCandidate,
  columnKeys: ReadonlySet<string>
): number | null {
  const requiredFields = rule.match.requiredFields ?? [];
  const anyFields = rule.match.anyFields ?? [];
  const rejectFields = rule.match.rejectFields ?? [];

  if (rejectFields.some(field => fieldPresent(rule, columnKeys, field))) return null;
  if (!requiredFields.every(field => fieldPresent(rule, columnKeys, field))) return null;
  if (anyFields.length > 0 && !anyFields.some(field => fieldPresent(rule, columnKeys, field))) return null;

  const presentFieldCount = Object.keys(rule.fields)
    .filter((field): field is TableFieldKey => field in rule.fields)
    .filter(field => fieldPresent(rule, columnKeys, field))
    .length;
  const anyFieldCount = anyFields.filter(field => fieldPresent(rule, columnKeys, field)).length;

  return (rule.priority ?? 0) * 1000
    + requiredFields.length * 100
    + anyFieldCount * 50
    + presentFieldCount * 10
    + populatedFieldScore(rule, candidate);
}

function fieldPresent(
  rule: ConfiguredTableFormat,
  columnKeys: ReadonlySet<string>,
  field: TableFieldKey
): boolean {
  return (rule.fields[field] ?? [])
    .flatMap(columnKeyCandidatesFor)
    .some(key => columnKeys.has(key));
}

function populatedFieldScore(
  rule: ConfiguredTableFormat,
  candidate: BomCoordinateTableCandidate
): number {
  const rows = candidate.rows.slice(0, 20);
  let score = 0;

  for (const row of rows) {
    for (const aliases of Object.values(rule.fields)) {
      if (aliases && cleanField(readField(row.raw, aliases)) !== "") score += 1;
    }
  }

  return score;
}

function candidateColumnKeys(candidate: BomCoordinateTableCandidate): Set<string> {
  const keys = new Set<string>();

  for (const row of candidate.rows) {
    for (const header of Object.keys(row.raw)) {
      for (const key of columnKeyCandidatesFor(header)) {
        keys.add(key);
      }
    }
  }

  return keys;
}
