import type {ViaInfoRecord} from "./types.js";

export function parseViaInfoCsv(text: string): ViaInfoRecord[] {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]);
  const records: ViaInfoRecord[] = [];

  for (const line of lines.slice(1)) {
    const values = splitCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    const xMm = Number(row.CenterXMm);
    const yMm = Number(row.CenterYMm);
    const padDiameterMm = Number(row.PadSizeMm);
    const holeDiameterMm = Number(row.HoleSizeMm);

    if (
      Number.isFinite(xMm) &&
      Number.isFinite(yMm) &&
      Number.isFinite(padDiameterMm) &&
      Number.isFinite(holeDiameterMm)
    ) {
      records.push({
        xMm,
        yMm,
        padDiameterMm,
        holeDiameterMm,
        startLayer: row["Start Layer"] ?? "",
        stopLayer: row["Stop Layer"] ?? "",
      });
    }
  }

  return records;
}

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}
