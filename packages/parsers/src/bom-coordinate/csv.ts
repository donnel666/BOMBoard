import Papa from "papaparse";
import {XMLParser} from "fast-xml-parser";
import {unzipSync} from "fflate";

import type {
  BomCoordinateEncoding,
  BomCoordinateInput,
  BomCoordinateParseOptions,
  BomCoordinateTextInput,
} from "./types.js";

const knownHeaderColumns = [
  "Angle",
  "Board Side",
  "Center X",
  "Center Y",
  "Centroid X",
  "Centroid Y",
  "Comment",
  "Component",
  "Coordinate X",
  "Coordinate Y",
  "Description",
  "Device",
  "Designator",
  "Encapsulation",
  "Footprint",
  "Layer",
  "LCSC Part Name",
  "LibRef",
  "Manufacturer Part",
  "Manufacturer Part Number",
  "Mid X",
  "Mid Y",
  "Name",
  "Package",
  "Pad X",
  "Pad Y",
  "PCB Footprint",
  "Pin 1 X",
  "Pin 1 Y",
  "Pins",
  "Position X",
  "Position Y",
  "Qty",
  "Quantity",
  "Ref",
  "Ref X",
  "Ref Y",
  "Ref Des",
  "RefDes",
  "Reference Designator",
  "Rotation",
  "Side",
  "Supplier Part",
  "Theta",
  "Value",
  "X",
  "Y",
  "位号",
  "名称",
  "封装",
  "层",
  "数量",
  "旋转",
  "板面",
  "角度",
];

const knownHeaderKeys = new Set(
  knownHeaderColumns.flatMap(columnKeyCandidates)
);

const xmlDecoder = new TextDecoder("utf-8");
const xlsxXmlParser = new XMLParser({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  preserveOrder: false,
  trimValues: false,
});

export interface BomCoordinateTableRow {
  raw: Record<string, string>;
  sourceRow: number;
}

export interface BomCoordinateTableCandidate {
  rows: BomCoordinateTableRow[];
  sheetName: string | null;
}

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
  return parseCsvTableRows(input, options).map(row => row.raw);
}

export function parseBomCoordinateTableCandidates(
  input: BomCoordinateInput,
  options: BomCoordinateParseOptions = {}
): BomCoordinateTableCandidate[] {
  if (isSpreadsheetInput(input)) {
    return parseSpreadsheetTableCandidates(input);
  }

  const rows = parseCsvTableRows(input, options);
  return rows.length > 0 ? [{rows, sheetName: null}] : [];
}

export function parseBomCoordinateTableRows(
  input: BomCoordinateInput,
  options: BomCoordinateParseOptions = {}
): BomCoordinateTableRow[] {
  return parseBomCoordinateTableCandidates(input, options)[0]?.rows ?? [];
}

export function readField(
  row: Record<string, string>,
  aliases: readonly string[]
): string | undefined {
  const fields = new Map<string, string>();

  for (const [key, value] of Object.entries(row)) {
    for (const candidate of columnKeyCandidates(key)) {
      if (!fields.has(candidate)) fields.set(candidate, value);
    }
  }

  let emptyValue: string | undefined;
  for (const alias of aliases) {
    for (const candidate of columnKeyCandidates(alias)) {
      const value = fields.get(candidate);
      if (value === undefined) continue;
      if (cleanField(value) !== "") return value;
      emptyValue ??= value;
    }
  }

  return emptyValue;
}

export function columnKeyCandidatesFor(value: string): string[] {
  return columnKeyCandidates(value);
}

function parseCsvTableRows(
  input: BomCoordinateInput,
  options: BomCoordinateParseOptions = {}
): BomCoordinateTableRow[] {
  const text = decodeBomCoordinateText(input, options);
  const result = Papa.parse<unknown[]>(text, {
    header: false,
    skipEmptyLines: "greedy",
  });

  return rowsToTableRows(result.data);
}

function parseSpreadsheetTableCandidates(input: BomCoordinateInput): BomCoordinateTableCandidate[] {
  const bytes = inputBytes(input);
  if (bytes === null) {
    throw new TypeError("XLSX BOM/coordinate input must include bytes.");
  }

  const archive = unzipSync(bytes);
  const sharedStrings = readSharedStrings(archive);
  const sheets = workbookSheets(archive);
  const candidates: BomCoordinateTableCandidate[] = [];

  for (const {path, name} of sheets) {
    const sheet = parseXmlFile(archive, path);
    const rows = worksheetRows(sheet, sharedStrings);
    if (rows.length === 0) continue;

    const tableRows = rowsToTableRows(rows);
    if (tableRows.length > 0) {
      candidates.push({
        rows: tableRows,
        sheetName: name,
      });
    }
  }

  return candidates;
}

export function cleanField(value: unknown): string {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
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

function rowsToTableRows(rows: readonly unknown[][]): BomCoordinateTableRow[] {
  const normalizedRows = rows.map(row => row.map(cleanField));
  const scoredHeaderIndex = normalizedRows.findIndex(row => headerScore(row) >= 2);
  const headerIndex = scoredHeaderIndex === -1
    ? normalizedRows.findIndex(isHeaderCandidate)
    : scoredHeaderIndex;
  if (headerIndex === -1) return [];

  const headers = normalizedRows[headerIndex] ?? [];
  const tableRows: BomCoordinateTableRow[] = [];

  for (let index = headerIndex + 1; index < normalizedRows.length; index += 1) {
    const row = normalizedRows[index] ?? [];
    if (row.every(value => value === "")) continue;

    const raw: Record<string, string> = {};
    headers.forEach((header, columnIndex) => {
      if (!header) return;
      raw[header] = cleanField(row[columnIndex]);
    });

    if (Object.values(raw).some(Boolean)) {
      tableRows.push({
        raw: normalizeRawRow(raw),
        sourceRow: index + 1,
      });
    }
  }

  return tableRows;
}

function isHeaderCandidate(row: readonly string[]): boolean {
  return row.filter(Boolean).length >= 2;
}

function headerScore(row: readonly string[]): number {
  return row.reduce((score, value) => {
    const matchesKnownHeader = columnKeyCandidates(value).some(candidate => knownHeaderKeys.has(candidate));
    return score + (matchesKnownHeader ? 1 : 0);
  }, 0);
}

function isSpreadsheetInput(input: BomCoordinateInput): boolean {
  const name = sourceName(input)?.toLowerCase() ?? "";
  if (/\.(?:xlsx|xlsm)$/.test(name)) return true;

  const bytes = inputBytes(input);
  if (bytes === null || bytes.length < 4) return false;

  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function workbookSheets(archive: Record<string, Uint8Array>): Array<{path: string; name: string | null}> {
  const workbook = asRecord(asRecord(parseXmlFile(archive, "xl/workbook.xml")).workbook);
  const sheets = asArray(asRecord(workbook.sheets).sheet);
  const relationships = workbookRelationships(archive);
  const paths: Array<{path: string; name: string | null}> = [];

  for (const sheet of sheets) {
    const record = asRecord(sheet);
    const relationshipId = stringValue(record["@_r:id"]);
    const target = relationships.get(relationshipId);
    if (target) {
      paths.push({
        path: resolveXlsxPath("xl/workbook.xml", target),
        name: stringValue(record["@_name"]) || null,
      });
    }
  }

  return paths;
}

function workbookRelationships(archive: Record<string, Uint8Array>): Map<string, string> {
  const rels = asRecord(asRecord(parseXmlFile(archive, "xl/_rels/workbook.xml.rels")).Relationships);
  const relationships = asArray(rels.Relationship);
  const mapped = new Map<string, string>();

  for (const relationship of relationships) {
    const record = asRecord(relationship);
    const id = stringValue(record["@_Id"]);
    const target = stringValue(record["@_Target"]);
    if (id && target) mapped.set(id, target);
  }

  return mapped;
}

function readSharedStrings(archive: Record<string, Uint8Array>): string[] {
  const sharedStrings = asRecord(asRecord(parseXmlFile(archive, "xl/sharedStrings.xml")).sst);
  return asArray(sharedStrings.si).map(readSharedString);
}

function readSharedString(value: unknown): string {
  const record = asRecord(value);
  const directText = xmlText(record.t);
  if (directText) return directText;

  return asArray(record.r)
    .map(run => xmlText(asRecord(run).t))
    .join("");
}

function worksheetRows(sheet: unknown, sharedStrings: readonly string[]): unknown[][] {
  const worksheet = asRecord(asRecord(sheet).worksheet);
  const rows = asArray(asRecord(worksheet.sheetData).row);

  return rows.map(row => worksheetCells(row, sharedStrings));
}

function worksheetCells(row: unknown, sharedStrings: readonly string[]): string[] {
  const cells = asArray(asRecord(row).c);
  const values: string[] = [];
  let maxColumn = -1;

  cells.forEach((cell, fallbackColumnIndex) => {
    const record = asRecord(cell);
    const columnIndex = cellColumnIndex(stringValue(record["@_r"])) ?? fallbackColumnIndex;
    values[columnIndex] = cellValue(record, sharedStrings);
    maxColumn = Math.max(maxColumn, columnIndex);
  });

  return Array.from({length: maxColumn + 1}, (_, index) => values[index] ?? "");
}

function cellValue(cell: Record<string, unknown>, sharedStrings: readonly string[]): string {
  const type = stringValue(cell["@_t"]);
  const rawValue = xmlText(cell.v);

  if (type === "s") {
    const sharedStringIndex = Number.parseInt(rawValue, 10);
    return Number.isFinite(sharedStringIndex)
      ? sharedStrings[sharedStringIndex] ?? ""
      : "";
  }

  if (type === "inlineStr") {
    return readSharedString(cell.is);
  }

  return rawValue;
}

function cellColumnIndex(reference: string): number | null {
  const match = reference.match(/^[A-Za-z]+/);
  if (!match) return null;

  let index = 0;
  for (const character of match[0].toUpperCase()) {
    index = index * 26 + character.charCodeAt(0) - 64;
  }

  return index - 1;
}

function parseXmlFile(archive: Record<string, Uint8Array>, path: string): unknown {
  const bytes = archive[path];
  if (!bytes) return {};
  return xlsxXmlParser.parse(xmlDecoder.decode(bytes)) as unknown;
}

function resolveXlsxPath(fromPath: string, target: string): string {
  if (target.startsWith("/")) return target.replace(/^\/+/, "");

  const fromDirectory = fromPath.includes("/")
    ? fromPath.slice(0, fromPath.lastIndexOf("/") + 1)
    : "";
  const parts = `${fromDirectory}${target}`.split("/");
  const resolved: string[] = [];

  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }

  return resolved.join("/");
}

function xmlText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  return stringValue(asRecord(value)["#text"]);
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function inputBytes(input: BomCoordinateInput): Uint8Array | null {
  if (input instanceof Uint8Array) return input;
  if (typeof input === "object" && input.bytes !== undefined) return input.bytes;
  return null;
}

function columnKeyCandidates(value: string): string[] {
  const normalized = normalizeColumnKey(value);
  if (!normalized) return [];

  const withoutUnit = normalized.replace(/(?:mm|mils?|inch(?:es)?|in)$/i, "");
  return withoutUnit && withoutUnit !== normalized
    ? [normalized, withoutUnit]
    : [normalized];
}

function normalizeColumnKey(value: string): string {
  return cleanField(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, "");
}
