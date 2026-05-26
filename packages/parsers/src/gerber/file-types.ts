import type {
  BoardSide,
  Gerber2DFileClassification,
  Gerber2DFileKind,
  Gerber2DFileTypePriority,
  Gerber2DInputFile,
} from "./types.js";
import layerRulesData from "./layer-rules.json" with {type: "json"};

const layerRules = layerRulesData as GerberLayerRules;

interface GerberLayerRules {
  fixedNames: ConfiguredLayerRule[];
  suffixRules: Array<ConfiguredLayerRule & {suffix: string}>;
  extensionRules: Array<ConfiguredLayerRule & {extensions: string[]}>;
  extensionPatternRules: Array<ConfiguredLayerRule & {pattern: string}>;
  genericNameRules: {
    extensions: string[];
    topTokens: string[];
    topCompactTokens: string[];
    bottomTokens: string[];
    bottomCompactTokens: string[];
    functions: ConfiguredGenericNameRule[];
  };
}

interface ConfiguredLayerRule {
  equals?: string;
  kind: Gerber2DFileKind;
  side: BoardSide;
  priority: number | null;
  renderable: boolean;
  reason: string;
}

interface ConfiguredGenericNameRule {
  tokens: string[];
  kind: Gerber2DFileKind;
  side?: BoardSide;
  priority: number | null;
  renderable: boolean;
  reason: string;
  requiresSide: boolean;
}

export const gerber2DFileTypePriorities: Gerber2DFileTypePriority[] = [
  {
    priority: 1,
    extensions: [".gm", ".gko", ".outline", ".gbr"],
    kind: "profile",
    side: "all",
    function: "Board profile/outline and render bounds.",
    implementation:
      "Parse first so all SVG reviews share the same viewBox and clipping shape.",
  },
  {
    priority: 2,
    extensions: [".txt", ".drl", ".xnc", ".drr", "-viainfo.txt"],
    kind: "drill",
    side: "all",
    function: "Via and plated-through-hole locations, hole sizes, and via cover markers.",
    implementation:
      "Sniff ambiguous .txt files by Excellon syntax, then parse drill coordinates directly for aligned masks.",
  },
  {
    priority: 3,
    extensions: [".gpt", ".gpb"],
    kind: "padMaster",
    side: "by-extension",
    function: "Top and bottom pad graphics without route strokes.",
    implementation:
      "Preferred for this MVP because pad master files avoid copper routing by construction.",
  },
  {
    priority: 4,
    extensions: [".gtl", ".gbl", ".gbr"],
    kind: "copper",
    side: "by-extension",
    function: "Top and bottom copper artwork.",
    implementation:
      "Keep copper in the board artwork stack; component geometry can still prefer pad masters or paste.",
  },
  {
    priority: 5,
    extensions: [".gts", ".gbs", ".gbr"],
    kind: "solderMask",
    side: "by-extension",
    function: "Green solder mask and exposed copper openings.",
    implementation:
      "Render process green solder mask over copper; mask openings expose pads and holes.",
  },
  {
    priority: 6,
    extensions: [".gto", ".gbo", ".gbr"],
    kind: "silkscreen",
    side: "by-extension",
    function: "Top and bottom silk print.",
    implementation: "Render as white/off-white legend ink above solder mask.",
  },
  {
    priority: 7,
    extensions: [".gtp", ".gbp", ".gbr"],
    kind: "paste",
    side: "by-extension",
    function: "Top and bottom solder paste openings.",
    implementation:
      "Use as preferred SMD component pad geometry for hit testing and highlighting; not part of the normal board artwork stack.",
  },
];

const drillCandidateExtensions = new Set([".txt", ".drl", ".xnc", ".drd"]);

export interface Gerber2DSelection {
  classifications: Gerber2DFileClassification[];
  tracespaceFiles: Array<{
    input: Gerber2DInputFile;
    classification: Gerber2DFileClassification;
  }>;
  drillFiles: Array<{
    input: Gerber2DInputFile;
    classification: Gerber2DFileClassification;
  }>;
  viaInfoFiles: Array<{
    input: Gerber2DInputFile;
    classification: Gerber2DFileClassification;
  }>;
}

export function classifyGerber2DFileName(
  fileName: string
): Gerber2DFileClassification {
  const name = baseName(fileName);
  const lowerName = name.toLowerCase();
  const extension = getExtension(lowerName);
  const searchableName = lowerName.replaceAll(/[-_.]/g, " ");
  const configuredClassification = classifyConfiguredGerberName(name, lowerName, extension, searchableName);
  if (configuredClassification) return configuredClassification;

  return classification(name, extension, "unknown", null, null, false, "unrecognized file type");
}

export function classifyGerber2DFile(
  input: Gerber2DInputFile
): Gerber2DFileClassification {
  const name = baseName(input.name);
  const lowerName = name.toLowerCase();
  const extension = getExtension(lowerName);
  const fileFunctionClassification = input.text
    ? classifyGerberFileFunction(name, extension, input.text)
    : null;

  if (fileFunctionClassification) return fileFunctionClassification;

  const nameClassification = classifyGerber2DFileName(input.name);
  if (!input.text || !drillCandidateExtensions.has(extension)) {
    return nameClassification;
  }

  if (looksLikeExcellonDrill(input.text)) {
    return classification(name, extension, "drill", "all", 2, false, "Excellon/NC drill content");
  }

  if (extension === ".txt" && nameClassification.kind === "unknown") {
    return classification(name, extension, "support", null, null, false, "text file without Excellon drill signatures");
  }

  if (nameClassification.kind === "drill") {
    return classification(name, extension, "support", null, null, false, "drill extension without Excellon drill signatures");
  }

  return nameClassification;
}

function looksLikeExcellonDrill(text: string): boolean {
  const header = text.slice(0, 131072);
  if (/%FSLA[XY]|%MO(?:MM|IN)|\bD0[123]\*/i.test(header)) return false;

  let score = 0;
  let coordinateRecords = 0;
  let toolDeclarations = 0;

  for (const rawLine of header.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^M48\b/i.test(line)) {
      score += 4;
      continue;
    }

    if (/^;FILE_FORMAT=\d+:\d+/i.test(line)) {
      score += 3;
      continue;
    }

    if (/^(?:INCH|METRIC)(?:\b|,)/i.test(line)) {
      score += 3;
      continue;
    }

    if (/^T0?\d+\b.*C[+-]?(?:\d+(?:\.\d*)?|\.\d+)/i.test(line)) {
      toolDeclarations += 1;
      score += 3;
      continue;
    }

    if (/^T0?\d+$/i.test(line)) {
      score += 1;
      continue;
    }

    if (/^(?:%|M30|M00|M95)$/i.test(line)) {
      score += 1;
      continue;
    }

    if (/^(?:G0?[05]|G81)$/i.test(line)) {
      score += 1;
      continue;
    }

    if (/^(?=.*[XY])(?:X[+-]?(?:\d+(?:\.\d*)?|\.\d+))?(?:Y[+-]?(?:\d+(?:\.\d*)?|\.\d+))?$/i.test(line)) {
      coordinateRecords += 1;
      score += 1;
    }
  }

  return score >= 5 && (coordinateRecords > 0 || toolDeclarations > 0);
}

function classifyGerberFileFunction(
  name: string,
  extension: string,
  text: string
): Gerber2DFileClassification | null {
  const fields = gerberFileFunctionFields(text);
  if (!fields) return null;

  const functionName = normalizeFileFunctionToken(fields[0] ?? "");
  const side = sideFromFileFunctionFields(fields);
  const reason = `Gerber X2 FileFunction ${fields.join(",")}`;

  if (functionName === "PROFILE") {
    return classification(name, extension, "profile", "all", 1, true, reason);
  }

  if (functionName === "COPPER") {
    const copperSide = side ?? copperSideFromLayerField(fields);
    if (copperSide === "top" || copperSide === "bottom") {
      return classification(name, extension, "copper", copperSide, 4, true, reason);
    }

    if (copperSide === "inner") {
      return classification(name, extension, "copper", "inner", null, false, `${reason}; inner copper ignored for 2D MVP`);
    }

    return classification(name, extension, "copper", null, null, false, `${reason}; copper side unknown`);
  }

  if (functionName === "SOLDERMASK" || functionName === "SOLDERRESIST") {
    return sidedLayerClassification(name, extension, "solderMask", side, 5, reason);
  }

  if (functionName === "PASTE" || functionName === "SOLDERPASTE" || functionName === "CREAM") {
    return sidedLayerClassification(name, extension, "paste", side, 7, reason);
  }

  if (functionName === "LEGEND" || functionName === "SILKSCREEN" || functionName === "SILK") {
    return sidedLayerClassification(name, extension, "silkscreen", side, 6, reason);
  }

  return classification(name, extension, "support", side, null, false, `${reason}; unsupported FileFunction`);
}

function sidedLayerClassification(
  name: string,
  extension: string,
  kind: Gerber2DFileKind,
  side: BoardSide,
  priority: number,
  reason: string
): Gerber2DFileClassification {
  const renderable = side === "top" || side === "bottom";
  return classification(name, extension, kind, side, renderable ? priority : null, renderable, reason);
}

function gerberFileFunctionFields(text: string): string[] | null {
  const header = text.slice(0, 65536);
  const modernMatch = header.match(/%TF\.FileFunction,([^*%]+)\*%/i);
  const legacyMatch = modernMatch ?? header.match(/%AF,FileFunction,([^*%]+)\*%/i);
  if (!legacyMatch) return null;

  const fieldText = legacyMatch[1] ?? "";
  const fields = splitGerberAttributeFields(fieldText)
    .map(field => field.trim())
    .filter(Boolean);

  return fields.length > 0 ? fields : null;
}

function splitGerberAttributeFields(text: string): string[] {
  const fields: string[] = [];
  let field = "";
  let escaped = false;

  for (const character of text) {
    if (escaped) {
      field += character;
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      continue;
    }

    if (character === ",") {
      fields.push(field);
      field = "";
      continue;
    }

    field += character;
  }

  fields.push(field);
  return fields;
}

function sideFromFileFunctionFields(fields: readonly string[]): BoardSide {
  const tokens = fields.map(normalizeFileFunctionToken);
  if (tokens.some(token => token === "TOP")) return "top";
  if (tokens.some(token => token === "BOT" || token === "BOTTOM")) return "bottom";
  if (tokens.some(token => token === "INR" || token === "INNER" || token === "INTERNAL")) return "inner";
  return null;
}

function copperSideFromLayerField(fields: readonly string[]): BoardSide {
  const layerToken = fields.map(normalizeFileFunctionToken).find(token => /^L\d+$/.test(token));
  if (layerToken === "L1") return "top";
  if (layerToken) return "inner";
  return null;
}

function normalizeFileFunctionToken(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function classifyConfiguredGerberName(
  name: string,
  lowerName: string,
  extension: string,
  searchableName: string
): Gerber2DFileClassification | null {
  const fixedNameRule = layerRules.fixedNames.find(rule => rule.equals === lowerName);
  if (fixedNameRule) return classificationFromRule(name, extension, fixedNameRule);

  const suffixRule = layerRules.suffixRules.find(rule => lowerName.endsWith(rule.suffix));
  if (suffixRule) return classificationFromRule(name, extension, suffixRule);

  const extensionRule = layerRules.extensionRules.find(rule => rule.extensions.includes(extension));
  if (extensionRule) return classificationFromRule(name, extension, extensionRule);

  const extensionPatternRule = layerRules.extensionPatternRules.find(rule => new RegExp(rule.pattern).test(extension));
  if (extensionPatternRule) return classificationFromRule(name, extension, extensionPatternRule);

  return classifyConfiguredGenericGerberName(name, extension, searchableName);
}

function classifyConfiguredGenericGerberName(
  name: string,
  extension: string,
  searchableName: string
): Gerber2DFileClassification | null {
  const rules = layerRules.genericNameRules;
  if (!rules.extensions.includes(extension)) return null;

  const tokens = new Set(searchableName.split(/\s+/).filter(Boolean));
  const compactName = searchableName.replaceAll(/\s+/g, "");
  const side = configuredSideFromTokens(tokens, compactName);

  for (const rule of rules.functions) {
    if (!hasAny(tokens, compactName, rule.tokens)) continue;
    if (rule.requiresSide && side !== "top" && side !== "bottom") continue;

    return classification(
      name,
      extension,
      rule.kind,
      rule.requiresSide ? side : rule.side ?? side,
      rule.priority,
      rule.renderable,
      rule.requiresSide ? `${side} ${rule.reason}` : rule.reason
    );
  }

  return null;
}

function configuredSideFromTokens(tokens: ReadonlySet<string>, compactName: string): BoardSide {
  const rules = layerRules.genericNameRules;
  if (rules.topTokens.some(token => tokens.has(token)) || rules.topCompactTokens.some(token => compactName.includes(token))) {
    return "top";
  }

  if (rules.bottomTokens.some(token => tokens.has(token)) || rules.bottomCompactTokens.some(token => compactName.includes(token))) {
    return "bottom";
  }

  return null;
}

function classificationFromRule(
  name: string,
  extension: string,
  rule: ConfiguredLayerRule
): Gerber2DFileClassification {
  return classification(name, extension, rule.kind, rule.side, rule.priority, rule.renderable, rule.reason);
}

function hasAny(tokens: ReadonlySet<string>, compactName: string, values: readonly string[]): boolean {
  return values.some(value => tokens.has(value) || compactName.includes(value));
}

export function selectGerber2DFiles(
  files: readonly Gerber2DInputFile[]
): Gerber2DSelection {
  const rows = files.map(input => ({
    input,
    classification: classifyGerber2DFile(input),
  }));

  return {
    classifications: rows.map(row => row.classification),
    tracespaceFiles: rows.filter(({classification}) => classification.renderable),
    drillFiles: rows.filter(row => row.classification.kind === "drill"),
    viaInfoFiles: rows.filter(row => row.classification.kind === "viaInfo"),
  };
}

export function baseName(pathOrName: string): string {
  return pathOrName.split(/[\\/]/).pop() ?? pathOrName;
}

function getExtension(lowerName: string): string {
  const index = lowerName.lastIndexOf(".");
  return index === -1 ? "" : lowerName.slice(index);
}

function classification(
  name: string,
  extension: string,
  kind: Gerber2DFileKind,
  side: BoardSide,
  priority: number | null,
  renderable: boolean,
  reason: string
): Gerber2DFileClassification {
  return {name, extension, kind, side, priority, renderable, reason};
}
