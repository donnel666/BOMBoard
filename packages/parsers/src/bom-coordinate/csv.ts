import {parse} from "csv-parse/sync";

import type {
  BomCoordinateEncoding,
  BomCoordinateInput,
  BomCoordinateParseOptions,
  BomCoordinateTextInput,
} from "./types.js";

export function decodeBomCoordinateText(
  input: BomCoordinateInput,
  options: BomCoordinateParseOptions = {}
): string {
  if (typeof input === "string") return input;

  if (input instanceof Uint8Array) {
    return decodeBytes(input, options.encoding ?? "auto");
  }

  if (input.text !== undefined) return input.text;
  if (input.bytes !== undefined) {
    return decodeBytes(input.bytes, input.encoding ?? options.encoding ?? "auto");
  }

  throw new TypeError("BOM/coordinate input must include text or bytes.");
}

export function sourceName(input: BomCoordinateInput): string | null {
  if (isTextInput(input)) return input.name ?? null;
  return null;
}

export function parseCsvRecords(
  input: BomCoordinateInput,
  options: BomCoordinateParseOptions = {}
): Array<Record<string, string>> {
  const text = decodeBomCoordinateText(input, options);

  return parse(text, {
    bom: true,
    columns: headers => headers.map(header => cleanField(String(header))),
    relax_column_count: true,
    skip_empty_lines: true,
    trim: false,
  }) as Array<Record<string, string>>;
}

export function cleanField(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
}

export function normalizeRawRow(row: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [cleanField(key), cleanField(value)])
  );
}

function decodeBytes(bytes: Uint8Array, encoding: BomCoordinateEncoding): string {
  if (encoding !== "auto") return new TextDecoder(encoding).decode(bytes);

  try {
    return new TextDecoder("utf-8", {fatal: true}).decode(bytes);
  } catch {
    return new TextDecoder("gb18030").decode(bytes);
  }
}

function isTextInput(input: BomCoordinateInput): input is BomCoordinateTextInput {
  return typeof input === "object" && !(input instanceof Uint8Array);
}
