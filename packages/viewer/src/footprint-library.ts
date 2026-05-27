import type {BomCoordinateComponent} from "@bomboard/parsers";

export type CompactFootprintShape =
  | ["circle", number, number, number]
  | ["rect", number, number, number, number]
  | ["roundRect", number, number, number, number, number]
  | ["polygon", number[]];

export type CompactFootprintFeature = [
  designator: string,
  xMm: number,
  yMm: number,
  rotationDeg: number,
  shape: CompactFootprintShape,
];

export interface FootprintLibraryEntry {
  id: string;
  name: string;
  key: string;
  aliases: string[];
  lcsc: string[];
  category: string;
  bounds: [number, number, number, number];
  pads: CompactFootprintFeature[];
  holes: CompactFootprintFeature[];
  vias: CompactFootprintFeature[];
}

export interface FootprintLibraryCandidate {
  entry: FootprintLibraryEntry;
  score: number;
  matchedKey: string;
}

export interface FootprintLibrary {
  entriesByKey: Map<string, FootprintLibraryEntry[]>;
}

export interface FootprintLibraryLoadOptions {
  baseUrl?: string;
}

interface FootprintLibraryManifest {
  format: string;
  indexPrefixLength: number;
  revision?: string;
}

interface FootprintIndexChunk {
  format: string;
  prefix: string;
  keys: Record<string, FootprintReference[]>;
}

interface FootprintDataChunk {
  format: string;
  unit: string;
  category: string;
  footprints: FootprintLibraryEntry[];
}

type FootprintReference = [chunkId: string, entryIndex: number];

const defaultFootprintLibraryBaseUrl = "/footprints";
const defaultIndexPrefixLength = 2;

export const emptyFootprintLibrary: FootprintLibrary = {
  entriesByKey: new Map(),
};

export async function loadFootprintLibraryForComponents(
  components: readonly BomCoordinateComponent[],
  options: FootprintLibraryLoadOptions = {}
): Promise<FootprintLibrary> {
  if (typeof fetch !== "function") return emptyFootprintLibrary;

  const baseUrl = options.baseUrl ?? defaultFootprintLibraryBaseUrl;
  const componentKeys = new Set(components.flatMap(componentFootprintKeys));
  if (componentKeys.size === 0) return emptyFootprintLibrary;

  let manifest: FootprintLibraryManifest;
  try {
    manifest = await fetchJson<FootprintLibraryManifest>(baseUrl, "manifest.json", {cache: "no-cache"});
  } catch {
    return emptyFootprintLibrary;
  }

  if (manifest.format !== "bomboard-footprint-library-v1") return emptyFootprintLibrary;

  const prefixLength = positiveInteger(manifest.indexPrefixLength) ?? defaultIndexPrefixLength;
  const cacheKey = typeof manifest.revision === "string" && manifest.revision !== ""
    ? manifest.revision
    : null;
  const indexPrefixes = new Set([...componentKeys].map(key => indexPrefix(key, prefixLength)));
  const indexChunks = await Promise.all(
    [...indexPrefixes].map(prefix => fetchOptionalJson<FootprintIndexChunk>(baseUrl, `index/${prefix}.json`, {cacheKey}))
  );
  const referencesByKey = new Map<string, FootprintReference[]>();
  const dataChunkIds = new Set<string>();

  for (const key of componentKeys) {
    const indexChunk = indexChunks.find(chunk => chunk?.prefix === indexPrefix(key, prefixLength));
    const references = indexChunk?.keys[key] ?? [];
    if (references.length === 0) continue;

    referencesByKey.set(key, references);
    references.forEach(reference => dataChunkIds.add(reference[0]));
  }

  if (dataChunkIds.size === 0) return emptyFootprintLibrary;

  const dataChunks = await Promise.all(
    [...dataChunkIds].map(async chunkId => ({
      chunkId,
      chunk: await fetchJson<FootprintDataChunk>(baseUrl, `data/${chunkId}.json`, {cacheKey}),
    }))
  );
  const entriesByReference = new Map<string, FootprintLibraryEntry>();
  for (const {chunkId, chunk} of dataChunks) {
    if (chunk.format !== "bomboard-footprint-data-v1" || chunk.unit !== "mm") continue;
    chunk.footprints.forEach((entry, entryIndex) => {
      entriesByReference.set(referenceKey(chunkId, entryIndex), entry);
    });
  }

  const entriesByKey = new Map<string, FootprintLibraryEntry[]>();
  for (const [key, references] of referencesByKey.entries()) {
    const entries = references
      .map(reference => entriesByReference.get(referenceKey(reference[0], reference[1])) ?? null)
      .filter((entry): entry is FootprintLibraryEntry => entry !== null);
    if (entries.length > 0) entriesByKey.set(key, entries);
  }

  return {entriesByKey};
}

export function resolveFootprintCandidates(
  library: FootprintLibrary | null | undefined,
  component: BomCoordinateComponent
): FootprintLibraryCandidate[] {
  if (!library || library.entriesByKey.size === 0) return [];

  const candidatesById = new Map<string, FootprintLibraryCandidate>();
  componentPackageNames(component).forEach((name, nameIndex) => {
    footprintNameKeys(name, componentExpectedPins(component)).forEach((key, keyIndex) => {
      const entries = library.entriesByKey.get(key) ?? [];
      for (const entry of entries) {
        const exact = entry.key === key;
        const score = nameIndex * 1000 + keyIndex * 20 + (exact ? 0 : 5);
        const existing = candidatesById.get(entry.id);
        if (!existing || score < existing.score) {
          candidatesById.set(entry.id, {entry, score, matchedKey: key});
        }
      }
    });
  });

  return [...candidatesById.values()]
    .sort((left, right) => {
      const score = left.score - right.score;
      if (score !== 0) return score;
      const specificity = right.matchedKey.length - left.matchedKey.length;
      if (specificity !== 0) return specificity;
      return left.entry.name.localeCompare(right.entry.name);
    });
}

export function normalizeFootprintKey(value: string): string {
  return value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function componentFootprintKeys(component: BomCoordinateComponent): string[] {
  const expectedPins = componentExpectedPins(component);
  return componentPackageNames(component).flatMap(name => footprintNameKeys(name, expectedPins));
}

function componentPackageNames(component: BomCoordinateComponent): string[] {
  const footprintNames = [
    component.placement?.footprint ?? "",
    component.bom?.footprint ?? "",
  ]
    .map(name => name.trim())
    .filter(name => name !== "");

  const names = [...footprintNames];
  const packagePrefixes = footprintNames
    .map(packagePrefix)
    .filter((prefix): prefix is string => prefix !== null);
  const contextNames = [
    component.placement?.comment ?? "",
    component.bom?.comment ?? "",
    component.bom?.libRef ?? "",
  ]
    .map(name => name.trim())
    .filter(name => isPackageLikeContextName(name));

  for (const prefix of packagePrefixes) {
    for (const contextName of contextNames) {
      names.push(`${prefix}_${contextName}`);
    }
  }

  return [...new Set(names)];
}

function componentExpectedPins(component: BomCoordinateComponent): number | null {
  return positiveInteger(component.placement?.pins ?? null)
    ?? positiveInteger(component.bom?.pins ?? null);
}

function footprintNameKeys(name: string, expectedPins: number | null = null): string[] {
  const exact = normalizeFootprintKey(name);
  if (!exact) return [];

  const aliasKeys = new Set<string>();

  for (const alias of generatedAliases(name, expectedPins)) {
    const key = normalizeFootprintKey(alias);
    if (key && key !== exact) aliasKeys.add(key);
  }

  return [
    exact,
    ...[...aliasKeys].sort((left, right) => right.length - left.length || left.localeCompare(right)),
  ];
}

function generatedAliases(name: string, expectedPins: number | null = null): string[] {
  const aliases = new Set<string>();
  const trimmed = name.trim();
  const parts = trimmed.split("_").filter(Boolean);
  const addAlias = (alias: string) => {
    if (isSpecificAlias(alias)) aliases.add(alias.trim());
  };

  for (let index = parts.length - 1; index >= 1; index -= 1) {
    const prefix = parts.slice(0, index).join("_");
    addAlias(prefix);
  }

  let stripped = trimmed;
  for (let count = 0; count < 4; count += 1) {
    const next = stripped.replace(/(?:[_-](?:REV|VER|ALT|COPY|NEW|OLD)?[A-Z]?\d+|[_-](?:REV|VER|ALT|COPY|NEW|OLD)[A-Z0-9]*|[_-][A-Z])$/i, "");
    if (next === stripped || !/[_-]/.test(stripped)) break;
    stripped = next;
    addAlias(stripped);
  }

  const passive = /^(?:[RCLDF]|LED|FB)(0[12468]0[1256]|1[028]0[126]|2[05]1[02]|0603|0402|0201|0805|1206|1210|1812|2010|2512)$/i.exec(trimmed);
  if (passive?.[1]) addAlias(passive[1]);

  addPackageSemanticAliases(trimmed, aliases, expectedPins);

  const normalizedName = normalizeFootprintKey(trimmed);
  return [...aliases]
    .filter(alias => normalizeFootprintKey(alias) !== normalizedName)
    .sort((left, right) => normalizeFootprintKey(right).length - normalizeFootprintKey(left).length || left.localeCompare(right));
}

function isSpecificAlias(value: string): boolean {
  const normalized = normalizeFootprintKey(value);
  if (normalized.length < 4 || !/\d/.test(normalized)) return false;
  if (/^(?:HDR|CONN|SOCKET|SW|BTN|LED|DIODE|CAP|RES|IND|IC)$/.test(normalized)) return false;
  return true;
}

function addPackageSemanticAliases(
  name: string,
  aliases: Set<string>,
  expectedPins: number | null
): void {
  const prefix = packagePrefix(name);
  const counts = packagePositionCounts(name);
  const pitch = packagePitch(name);
  const hasTypeC = /TYPE[-_ ]*C|USB[-_ ]*C/i.test(name);
  const expected = positiveInteger(expectedPins);
  const addAlias = (alias: string) => {
    if (isSpecificAlias(alias)) aliases.add(alias.trim());
  };

  if (expected !== null) {
    for (const variant of expectedPinTextVariants(name, expected)) {
      addAlias(variant);
    }
  }

  const prefixes = packageSemanticPrefixes(name, prefix, hasTypeC);
  if (prefixes.length === 0) return;

  for (const count of counts) {
    for (const candidatePrefix of prefixes) {
      addAlias(`${candidatePrefix}_${count}P`);
      addAlias(`${candidatePrefix}_${count}PIN`);
      addAlias(`${candidatePrefix}_${count}BALL`);
      addAlias(`${candidatePrefix}_${count}BALLS`);
      if (pitch) addAlias(`${candidatePrefix}_${count}P-P${pitch}`);
      if (hasTypeC) {
        addAlias(`${candidatePrefix}_TYPE-C-${count}P`);
        addAlias(`${candidatePrefix}_TYPE-C-${count}PIN`);
        addAlias(`${candidatePrefix}_TYPE_C_${count}PIN`);
      }
    }
  }

  if (expected !== null) {
    for (const candidatePrefix of prefixes) {
      addAlias(`${candidatePrefix}_${expected}P`);
      addAlias(`${candidatePrefix}_${expected}PAD`);
      addAlias(`${candidatePrefix}_${expected}PADS`);
      if (isBallGridPackageName(name)) {
        addAlias(`${candidatePrefix}_${expected}BALL`);
        addAlias(`${candidatePrefix}_${expected}BALLS`);
      }
      if (hasTypeC) {
        addAlias(`${candidatePrefix}_TYPE-C-${expected}P`);
        addAlias(`${candidatePrefix}_TYPE-C-${expected}PIN`);
        addAlias(`${candidatePrefix}_TYPE_C_${expected}PIN`);
      }
    }
  }
}

function packageSemanticPrefixes(
  name: string,
  prefix: string | null,
  hasTypeC: boolean
): string[] {
  if (prefix) {
    return packagePrefixVariants(ballGridFamilyPrefix(prefix) ?? prefix, hasTypeC);
  }

  return isBallGridPackageName(name) ? ["BGA", "FBGA"] : [];
}

function packagePrefix(name: string): string | null {
  const prefix = name.split("_")[0]?.trim() ?? "";
  return prefix !== "" && prefix !== name.trim() ? prefix : null;
}

function packagePrefixVariants(prefix: string, hasTypeC: boolean): string[] {
  const variants = new Set([prefix]);
  const upper = prefix.toUpperCase();
  if (upper.endsWith("BGA")) {
    variants.add("BGA");
    variants.add("FBGA");
  }
  if (upper.endsWith("CSP")) {
    variants.add("CSP");
    variants.add("WLCSP");
    variants.add("FCCSP");
  }
  if (hasTypeC) {
    if (/^USB-C-SMD$/i.test(prefix)) {
      variants.add("USB-TYPE-C-SMD");
      variants.add("USB-SMD");
    } else if (/^USB-TYPE-C-SMD$/i.test(prefix)) {
      variants.add("USB-C-SMD");
      variants.add("USB-SMD");
    } else if (/^USB-C-TH$/i.test(prefix)) {
      variants.add("USB-TYPE-C-TH");
    } else if (/^USB-TYPE-C-TH$/i.test(prefix)) {
      variants.add("USB-C-TH");
    }
  }
  return [...variants];
}

function ballGridFamilyPrefix(prefix: string): string | null {
  const match = /^([A-Z]*BGA|[A-Z]*CSP)[-_ ]*\d{2,4}(?=$|[^A-Z0-9])/i.exec(prefix);
  return match?.[1] ?? null;
}

function isBallGridPackageName(name: string): boolean {
  return /LPDDR|DDR|[A-Z]*BGA|[A-Z]*CSP|\d{2,4}\s*BALLS?/i.test(name);
}

function packagePositionCounts(name: string): number[] {
  const counts = new Set<number>();
  const upper = name.toUpperCase();
  const patterns = [
    /(?:^|[^A-Z0-9])(\d{1,4})\s*(?:PINS?|PIN|BALLS?|BALL|PLT)(?=$|[^A-Z0-9])/g,
    /(?:^|[^A-Z0-9])(\d{1,4})P(?=$|[^A-Z0-9])/g,
    /(?:^|[^A-Z0-9])(?:[A-Z]*BGA|[A-Z]*CSP)[-_ ]*(\d{2,4})(?=$|[^A-Z0-9])/g,
  ];

  for (const pattern of patterns) {
    for (const match of upper.matchAll(pattern)) {
      const count = positiveInteger(Number(match[1]));
      if (count !== null && count <= 2000) counts.add(count);
    }
  }

  return [...counts];
}

function packagePitch(name: string): string | null {
  const explicit = /(?:^|[^A-Z0-9])P(\d+(?:\.\d+)?)(?=$|[^A-Z0-9])/i.exec(name)?.[1];
  if (explicit) return normalizeDecimalText(explicit);

  const connectorPitch = /(?:^|[_-])(?:HC|MX|GH|PH|ZH)[-_ ]*(\d+(?:\.\d+)?)[-_ ]*\d{1,4}(?:P|PLT|PIN)/i.exec(name)?.[1];
  return connectorPitch ? normalizeDecimalText(connectorPitch) : null;
}

function expectedPinTextVariants(name: string, expectedPins: number): string[] {
  const variants = new Set<string>();
  const replacePinWord = (match: string, count: string, suffix: string) => {
    const parsed = positiveInteger(Number(count));
    return parsed !== null && parsed !== expectedPins ? `${expectedPins}${suffix}` : match;
  };
  const withPinWord = name.replace(/(\d{1,4})(\s*PINS?)/gi, replacePinWord);
  if (withPinWord !== name) variants.add(withPinWord);
  return [...variants];
}

function normalizeDecimalText(value: string): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : value;
}

function isPackageLikeContextName(name: string): boolean {
  if (name === "") return false;
  if (isSpecificAlias(name)) return true;
  return /TYPE[-_ ]*C|HDMI|USB|AUDIO|CONN|SOCKET|QFN|BGA|CSP|LPDDR/i.test(name);
}

async function fetchOptionalJson<T>(
  baseUrl: string,
  relativePath: string,
  options: FootprintFetchOptions = {}
): Promise<T | null> {
  try {
    return await fetchJson<T>(baseUrl, relativePath, options);
  } catch {
    return null;
  }
}

interface FootprintFetchOptions {
  cache?: RequestCache;
  cacheKey?: string | null;
}

async function fetchJson<T>(
  baseUrl: string,
  relativePath: string,
  options: FootprintFetchOptions = {}
): Promise<T> {
  const response = await fetch(
    libraryUrl(baseUrl, relativePath, options.cacheKey),
    options.cache ? {cache: options.cache} : undefined
  );
  if (!response.ok) {
    throw new Error(`Failed to load footprint library file: ${relativePath}`);
  }

  return await response.json() as T;
}

function libraryUrl(baseUrl: string, relativePath: string, cacheKey: string | null = null): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const origin = typeof document === "undefined" ? "http://localhost/" : document.baseURI;
  const url = new URL(relativePath, new URL(normalizedBase, origin));
  if (cacheKey) url.searchParams.set("v", cacheKey);
  return url.toString();
}

function indexPrefix(key: string, prefixLength: number): string {
  return (key.slice(0, prefixLength) || "_").padEnd(prefixLength, "_");
}

function referenceKey(chunkId: string, entryIndex: number): string {
  return `${chunkId}:${entryIndex}`;
}

function positiveInteger(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isInteger(value) && value > 0 ? value : null;
}
