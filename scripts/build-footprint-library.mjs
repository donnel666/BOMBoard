import {createHash} from "node:crypto";
import {existsSync} from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const corpusRoot = path.resolve(repoRoot, process.argv[2] ?? "corpus");
const outputRoot = path.resolve(repoRoot, process.argv[3] ?? "apps/web/public/footprints");
const partsRoot = path.join(corpusRoot, "parts");
const footprintIndexPath = path.join(corpusRoot, "footprint_index.json");
const milToMm = 0.0254;
const indexPrefixLength = 2;
const dataChunkHashLength = 1;
const ellipseSegments = 24;

function normalizeKey(value) {
  return value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function mm(value) {
  return Number((Number(value) * milToMm).toFixed(4));
}

function roundedDegrees(value) {
  return Number(Number(value ?? 0).toFixed(3));
}

function compactJson(value) {
  return JSON.stringify(value, null, 0);
}

function hashText(value, length = 10) {
  return createHash("sha1").update(value).digest("hex").slice(0, length);
}

function generatedAliases(name, featureCounts = {}, extraAliases = []) {
  const aliases = new Set();
  const trimmed = name.trim();
  const separators = /[_-]/;
  const parts = trimmed.split("_").filter(Boolean);
  const addAlias = (alias) => {
    if (isSpecificAlias(alias)) aliases.add(alias.trim());
  };

  for (let index = parts.length - 1; index >= 1; index -= 1) {
    const prefix = parts.slice(0, index).join("_");
    addAlias(prefix);
  }

  let stripped = trimmed;
  for (let count = 0; count < 4; count += 1) {
    const next = stripped.replace(/(?:[_-](?:REV|VER|ALT|COPY|NEW|OLD)?[A-Z]?\d+|[_-](?:REV|VER|ALT|COPY|NEW|OLD)[A-Z0-9]*|[_-][A-Z])$/i, "");
    if (next === stripped || !separators.test(stripped)) break;
    stripped = next;
    addAlias(stripped);
  }

  const passive = /^(?:[RCLDF]|LED|FB)(0[12468]0[1256]|1[028]0[126]|2[05]1[02]|0603|0402|0201|0805|1206|1210|1812|2010|2512)$/i.exec(trimmed);
  if (passive?.[1]) addAlias(passive[1]);

  addPackageSemanticAliases(trimmed, aliases, featureCounts);

  for (const alias of extraAliases) addAlias(alias);

  const normalizedName = normalizeKey(trimmed);
  return [...aliases]
    .filter(alias => normalizeKey(alias) !== normalizedName)
    .sort((left, right) => normalizeKey(right).length - normalizeKey(left).length || left.localeCompare(right));
}

function isSpecificAlias(value) {
  const normalized = normalizeKey(value);
  if (normalized.length < 4 || !/\d/.test(normalized)) return false;
  if (/^(?:HDR|CONN|SOCKET|SW|BTN|LED|DIODE|CAP|RES|IND|IC)$/.test(normalized)) return false;
  return true;
}

function addPackageSemanticAliases(name, aliases, featureCounts) {
  const prefix = packagePrefix(name);
  const counts = packagePositionCounts(name);
  const pitch = packagePitch(name);
  const hasTypeC = /TYPE[-_ ]*C|USB[-_ ]*C/i.test(name);
  const padCount = positiveInteger(featureCounts.padCount);
  const addAlias = (alias) => {
    if (isSpecificAlias(alias)) aliases.add(alias.trim());
  };

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

  if (padCount !== null) {
    for (const candidatePrefix of prefixes) {
      addAlias(`${candidatePrefix}_${padCount}P`);
      addAlias(`${candidatePrefix}_${padCount}PAD`);
      addAlias(`${candidatePrefix}_${padCount}PADS`);
      if (isBallGridPackageName(name)) {
        addAlias(`${candidatePrefix}_${padCount}BALL`);
        addAlias(`${candidatePrefix}_${padCount}BALLS`);
      }
      if (hasTypeC) {
        addAlias(`${candidatePrefix}_TYPE-C-${padCount}P`);
        addAlias(`${candidatePrefix}_TYPE-C-${padCount}PIN`);
        addAlias(`${candidatePrefix}_TYPE_C_${padCount}PIN`);
      }
    }
  }
}

function packageSemanticPrefixes(name, prefix, hasTypeC) {
  if (prefix) {
    const familyPrefix = ballGridFamilyPrefix(prefix) ?? prefix;
    return packagePrefixVariants(familyPrefix, hasTypeC);
  }

  return isBallGridPackageName(name) ? ["BGA", "FBGA"] : [];
}

function packagePrefix(name) {
  const prefix = name.split("_")[0]?.trim() ?? "";
  return prefix !== "" && prefix !== name.trim() ? prefix : null;
}

function packagePrefixVariants(prefix, hasTypeC) {
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

function ballGridFamilyPrefix(prefix) {
  const match = /^([A-Z]*BGA|[A-Z]*CSP)[-_ ]*\d{2,4}(?=$|[^A-Z0-9])/i.exec(prefix);
  return match?.[1] ?? null;
}

function isBallGridPackageName(name) {
  return /LPDDR|DDR|[A-Z]*BGA|[A-Z]*CSP|\d{2,4}\s*BALLS?/i.test(name);
}

function packagePositionCounts(name) {
  const counts = new Set();
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

function packagePitch(name) {
  const explicit = /(?:^|[^A-Z0-9])P(\d+(?:\.\d+)?)(?=$|[^A-Z0-9])/i.exec(name)?.[1];
  if (explicit) return normalizeDecimalText(explicit);

  const connectorPitch = /(?:^|[_-])(?:HC|MX|GH|PH|ZH)[-_ ]*(\d+(?:\.\d+)?)[-_ ]*\d{1,4}(?:P|PLT|PIN)/i.exec(name)?.[1];
  return connectorPitch ? normalizeDecimalText(connectorPitch) : null;
}

function normalizeDecimalText(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : value;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function categoryForFootprint(name, pads, holes) {
  const upper = name.toUpperCase();
  if (upper.startsWith("HDR") || upper.includes("CONN") || upper.includes("SOCKET") || upper.includes("USB") || upper.includes("RJ")) return "connector";
  if (upper.includes("-TH") || upper.startsWith("TH_") || holes.length > pads.length * 0.5) return "through-hole";
  if (/^(?:R|RES)[-_]?\d/.test(upper) || upper.startsWith("RES-SMD") || /^R(?:01005|0201|0402|0603|0805|1206|1210|1812|2010|2512)$/.test(upper)) return "passive-resistor";
  if (/^(?:C|CAP)[-_]?\d/.test(upper) || upper.startsWith("CAP-SMD") || /^C(?:01005|0201|0402|0603|0805|1206|1210|1812|2010|2512)$/.test(upper)) return "passive-capacitor";
  if (/^(?:L|IND|FB)[-_]?\d/.test(upper) || upper.startsWith("IND-SMD") || /^L(?:01005|0201|0402|0603|0805|1206|1210|1812|2010|2512)$/.test(upper)) return "passive-inductor";
  if (upper.startsWith("LED") || upper.startsWith("D") || upper.startsWith("SOD") || upper.startsWith("SMA") || upper.startsWith("SMB") || upper.startsWith("SMC")) return "diode-led";
  if (upper.startsWith("BGA") || upper.includes("BGA") || upper.includes("CSP") || upper.includes("LGA")) return "ic-array";
  if (upper.includes("QFN") || upper.includes("DFN")) return "ic-qfn-dfn";
  if (upper.includes("QFP")) return "ic-qfp";
  if (upper.includes("SOP") || upper.includes("SOIC") || upper.includes("SSOP") || upper.includes("TSSOP") || upper.includes("MSOP")) return "ic-sop";
  if (upper.includes("SOT")) return "ic-sot";
  if (upper.startsWith("OSC") || upper.startsWith("XTAL") || upper.includes("CRYSTAL")) return "oscillator";
  if (upper.startsWith("SW") || upper.startsWith("BTN") || upper.includes("BUTTON")) return "switch";
  return "other";
}

function featureBounds(feature) {
  const [, x, y, rotationDeg, shape] = feature;
  const points = shapePoints(shape);
  const radians = rotationDeg * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const transformed = points.map(point => ({
    x: x + point.x * cos - point.y * sin,
    y: y + point.x * sin + point.y * cos,
  }));
  return boundsFromPoints(transformed);
}

function shapePoints(shape) {
  const kind = shape[0];
  if (kind === "circle") {
    const [, cx, cy, radius] = shape;
    return [
      {x: cx - radius, y: cy - radius},
      {x: cx + radius, y: cy - radius},
      {x: cx + radius, y: cy + radius},
      {x: cx - radius, y: cy + radius},
    ];
  }
  if (kind === "rect" || kind === "roundRect") {
    const [, x1, y1, x2, y2] = shape;
    return [
      {x: x1, y: y1},
      {x: x2, y: y1},
      {x: x2, y: y2},
      {x: x1, y: y2},
    ];
  }
  const points = shape[1];
  const result = [];
  for (let index = 0; index < points.length - 1; index += 2) {
    result.push({x: points[index], y: points[index + 1]});
  }
  return result;
}

function boundsFromPoints(points) {
  return {
    minX: Math.min(...points.map(point => point.x)),
    minY: Math.min(...points.map(point => point.y)),
    maxX: Math.max(...points.map(point => point.x)),
    maxY: Math.max(...points.map(point => point.y)),
  };
}

function unionBounds(bounds) {
  return bounds.reduce((current, next) => ({
    minX: Math.min(current.minX, next.minX),
    minY: Math.min(current.minY, next.minY),
    maxX: Math.max(current.maxX, next.maxX),
    maxY: Math.max(current.maxY, next.maxY),
  }));
}

function boundsArray(bounds) {
  return [
    Number(bounds.minX.toFixed(4)),
    Number(bounds.minY.toFixed(4)),
    Number(bounds.maxX.toFixed(4)),
    Number(bounds.maxY.toFixed(4)),
  ];
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readOptionalJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

async function readOptionalText(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function readFootprintIndexCandidates() {
  if (!existsSync(footprintIndexPath)) return new Map();
  const index = await readJson(footprintIndexPath);
  const byName = new Map();
  for (const bucket of Object.values(index.buckets ?? {})) {
    const name = bucket?.footprint_name;
    if (typeof name !== "string" || !Array.isArray(bucket.candidates)) continue;
    const key = normalizeKey(name);
    const candidates = byName.get(key) ?? new Set();
    for (const candidate of bucket.candidates) {
      if (typeof candidate === "string" && candidate !== "") candidates.add(candidate);
    }
    byName.set(key, candidates);
  }
  return byName;
}

function footprintNameFromRaw(device, footprintPro) {
  const footprint = device?.footprint ?? {};
  return firstNonEmptyString([
    footprint.display_title,
    footprint.title,
    footprintPro?.meta?.display_title,
    device?.attributes?.["3D Model Title"],
    device?.attributes?.["Supplier Footprint"],
  ]);
}

function footprintAliasesFromRaw(device, primaryName) {
  const footprint = device?.footprint ?? {};
  const attributes = device?.attributes ?? {};
  const aliases = [
    footprint.display_title,
    footprint.title,
    attributes["3D Model Title"],
    attributes["Supplier Footprint"],
    attributes["Manufacturer Part"],
    attributes["LCSC Part Name"],
  ];
  const primaryKey = normalizeKey(primaryName);
  return [...new Set(
    aliases
      .filter(alias => typeof alias === "string")
      .map(alias => alias.trim())
      .filter(alias => alias !== "" && normalizeKey(alias) !== primaryKey)
  )];
}

function firstNonEmptyString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

function rawFootprintFeatures(legacyText, footprintPro) {
  return legacyText !== null
    ? rawFeaturesFromLegacyRows(legacyRows(legacyText))
    : rawFeaturesFromProRecords(footprintPro?.records ?? []);
}

function legacyRows(text) {
  const rows = [];
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed);
      if (Array.isArray(row)) rows.push(row);
    } catch {
      continue;
    }
  }
  return rows;
}

function rawFeaturesFromLegacyRows(rows) {
  const pads = [];
  const holes = [];
  const vias = [];

  for (const row of rows) {
    const type = row[0];
    if (type === "PAD") {
      const padFeature = featureFromRawPad({
        designator: row[5],
        centerX: row[6],
        centerY: row[7],
        rotationDeg: row[8],
        defaultPad: row[10],
      });
      if (padFeature) pads.push(padFeature);

      const holeFeature = featureFromRawPadHole({
        designator: row[5],
        centerX: row[6],
        centerY: row[7],
        rotationDeg: row[8],
        hole: row[9],
      });
      if (holeFeature) holes.push(holeFeature);
      continue;
    }

    if (type === "VIA") {
      const viaFeature = featureFromRawVia({
        designator: row[1],
        x: row[4],
        y: -Number(row[5]),
        diameter: row[6],
        hole: row[7],
      });
      if (viaFeature) vias.push(viaFeature);
    }
  }

  return {pads, holes, vias};
}

function rawFeaturesFromProRecords(records) {
  const pads = [];
  const holes = [];
  const vias = [];

  for (const record of records) {
    const type = record?.type;
    const data = record?.data ?? {};
    if (type === "PAD") {
      const padFeature = featureFromRawPad({
        designator: data.num,
        centerX: data.centerX,
        centerY: data.centerY,
        rotationDeg: data.padAngle,
        defaultPad: data.defaultPad,
      });
      if (padFeature) pads.push(padFeature);

      const holeFeature = featureFromRawPadHole({
        designator: data.num,
        centerX: data.centerX,
        centerY: data.centerY,
        rotationDeg: data.padAngle,
        hole: data.hole,
      });
      if (holeFeature) holes.push(holeFeature);
      continue;
    }

    if (type === "VIA") {
      const viaFeature = featureFromRawVia({
        designator: record.id,
        x: data.x,
        y: data.y,
        diameter: data.diameter,
        hole: data.hole,
      });
      if (viaFeature) vias.push(viaFeature);
    }
  }

  return {pads, holes, vias};
}

function featureFromRawPad(input) {
  const x = Number(input.centerX);
  const y = Number(input.centerY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const shape = shapeFromRawPad(input.defaultPad, {x, y});
  if (!shape) return null;

  if (shape.absolute) {
    return [
      String(input.designator ?? ""),
      0,
      0,
      0,
      shape.shape,
    ];
  }

  return [
    String(input.designator ?? ""),
    mm(x),
    mm(y),
    roundedDegrees(input.rotationDeg),
    shape.shape,
  ];
}

function shapeFromRawPad(defaultPad, center) {
  const padType = rawPadType(defaultPad);
  if (!padType) return null;

  if (padType === "POLY") {
    const pathPoints = rawPadPolygonPath(defaultPad);
    const polygon = polygonShapeFromPath(pathPoints, null);
    return polygon ? {shape: polygon, absolute: true} : null;
  }

  const size = rawPadSize(defaultPad);
  if (!size) return null;
  const {width, height} = size;

  if (padType === "RECT") {
    return {
      shape: ["rect", mm(-width / 2), mm(-height / 2), mm(width / 2), mm(height / 2)],
      absolute: false,
    };
  }

  if (padType === "ELLIPSE") {
    if (Math.abs(width - height) <= 0.001) {
      return {shape: ["circle", 0, 0, mm(width / 2)], absolute: false};
    }
    return {shape: ellipsePolygonShape(width, height), absolute: false};
  }

  if (padType === "OVAL") {
    if (Math.abs(width - height) <= 0.001) {
      return {shape: ["circle", 0, 0, mm(width / 2)], absolute: false};
    }
    return {shape: capsulePolygonShape(width, height), absolute: false};
  }

  return null;
}

function rawPadType(defaultPad) {
  const type = Array.isArray(defaultPad) ? defaultPad[0] : defaultPad?.padType;
  return typeof type === "string" ? type.toUpperCase() : null;
}

function rawPadSize(defaultPad) {
  const width = Number(Array.isArray(defaultPad) ? defaultPad[1] : defaultPad?.width);
  const height = Number(Array.isArray(defaultPad) ? defaultPad[2] ?? defaultPad[1] : defaultPad?.height ?? defaultPad?.width);
  if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return {width, height};
}

function rawPadPolygonPath(defaultPad) {
  const path = Array.isArray(defaultPad) ? defaultPad[1] : defaultPad?.width;
  return Array.isArray(path) ? path : null;
}

function featureFromRawPadHole(input) {
  const x = Number(input.centerX);
  const y = Number(input.centerY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const shape = holeShapeFromRaw(input.hole);
  if (!shape) return null;

  return [
    String(input.designator ?? ""),
    mm(x),
    mm(y),
    roundedDegrees(input.rotationDeg),
    shape,
  ];
}

function holeShapeFromRaw(rawHole) {
  if (!Array.isArray(rawHole) || rawHole.length < 2) return null;
  const type = typeof rawHole[0] === "string" ? rawHole[0].toUpperCase() : "";
  const width = Number(rawHole[1]);
  const height = Number(rawHole[2] ?? rawHole[1]);
  if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;

  if (type === "SLOT" || Math.abs(width - height) > 0.001) {
    return capsulePolygonShape(width, height);
  }

  return ["circle", 0, 0, mm(width / 2)];
}

function featureFromRawVia(input) {
  const x = Number(input.x);
  const y = Number(input.y);
  const diameter = Number(input.hole ?? input.diameter);
  if (![x, y, diameter].every(Number.isFinite) || diameter <= 0) return null;
  return [
    String(input.designator ?? ""),
    mm(x),
    mm(y),
    0,
    ["circle", 0, 0, mm(diameter / 2)],
  ];
}

function ellipsePolygonShape(widthMil, heightMil) {
  const points = [];
  for (let index = 0; index < ellipseSegments; index += 1) {
    const radians = index * Math.PI * 2 / ellipseSegments;
    points.push(mm(Math.cos(radians) * widthMil / 2), mm(Math.sin(radians) * heightMil / 2));
  }
  return ["polygon", points];
}

function capsulePolygonShape(widthMil, heightMil) {
  const radius = Math.min(widthMil, heightMil) / 2;
  const horizontal = widthMil >= heightMil;
  const halfStraight = Math.max(widthMil, heightMil) / 2 - radius;
  const points = [];
  const segmentCount = Math.max(8, Math.floor(ellipseSegments / 2));

  if (horizontal) {
    for (let index = 0; index <= segmentCount; index += 1) {
      const radians = -Math.PI / 2 + index * Math.PI / segmentCount;
      points.push(mm(halfStraight + Math.cos(radians) * radius), mm(Math.sin(radians) * radius));
    }
    for (let index = 0; index <= segmentCount; index += 1) {
      const radians = Math.PI / 2 + index * Math.PI / segmentCount;
      points.push(mm(-halfStraight + Math.cos(radians) * radius), mm(Math.sin(radians) * radius));
    }
  } else {
    for (let index = 0; index <= segmentCount; index += 1) {
      const radians = index * Math.PI / segmentCount;
      points.push(mm(Math.cos(radians) * radius), mm(halfStraight + Math.sin(radians) * radius));
    }
    for (let index = 0; index <= segmentCount; index += 1) {
      const radians = Math.PI + index * Math.PI / segmentCount;
      points.push(mm(Math.cos(radians) * radius), mm(-halfStraight + Math.sin(radians) * radius));
    }
  }

  return ["polygon", points];
}

function polygonShapeFromPath(path, center) {
  if (!Array.isArray(path)) return null;
  if (path[0] === "CIRCLE") {
    const cx = Number(path[1]);
    const cy = Number(path[2]);
    const radius = Number(path[3]);
    if (![cx, cy, radius].every(Number.isFinite) || radius <= 0) return null;
    const offsetX = center ? cx - center.x : cx;
    const offsetY = center ? cy - center.y : cy;
    return ["circle", mm(offsetX), mm(offsetY), mm(radius)];
  }

  const points = [];
  const numeric = path.filter(value => typeof value === "number" && Number.isFinite(value));
  for (let index = 0; index < numeric.length - 1; index += 2) {
    const x = center ? numeric[index] - center.x : numeric[index];
    const y = center ? numeric[index + 1] - center.y : numeric[index + 1];
    points.push(mm(x), mm(y));
  }

  return points.length >= 6 ? ["polygon", points] : null;
}

async function buildEntries() {
  const candidatesByName = await readFootprintIndexCandidates();
  const entriesBySignature = new Map();
  const partDirs = await readdir(partsRoot, {withFileTypes: true});

  for (const partDir of partDirs) {
    if (!partDir.isDirectory()) continue;
    const lcsc = partDir.name;
    const rawDir = path.join(partsRoot, lcsc, "raw");
    if (!existsSync(rawDir)) continue;

    const [device, footprintPro, legacyText] = await Promise.all([
      readOptionalJson(path.join(rawDir, "device.json")),
      readOptionalJson(path.join(rawDir, "footprint_pro.json")),
      readOptionalText(path.join(rawDir, "footprint_legacy.txt")),
    ]);
    const name = footprintNameFromRaw(device, footprintPro);
    if (!name) continue;

    const {pads, holes, vias} = rawFootprintFeatures(legacyText, footprintPro);

    if (pads.length === 0 && holes.length === 0 && vias.length === 0) continue;

    const key = normalizeKey(name);
    const signature = compactJson([key, pads, holes, vias]);
    const signatureHash = hashText(signature, 12);
    const entryKey = `${key}:${signatureHash}`;
    const existing = entriesBySignature.get(entryKey);
    if (existing) {
      existing.lcscSet.add(lcsc);
      continue;
    }

    const featureBoundsList = [...pads, ...holes, ...vias].map(featureBounds);
    const lcscSet = new Set(candidatesByName.get(key) ?? []);
    lcscSet.add(lcsc);
    const aliases = generatedAliases(name, {padCount: pads.length, holeCount: holes.length}, footprintAliasesFromRaw(device, name));
    const category = categoryForFootprint(name, pads, holes);
    const id = `${key.toLowerCase().slice(0, 56)}_${signatureHash}`;

    entriesBySignature.set(entryKey, {
      id,
      name,
      key,
      aliases,
      lcscSet,
      category,
      bounds: boundsArray(unionBounds(featureBoundsList)),
      pads,
      holes,
      vias,
    });
  }

  return [...entriesBySignature.values()]
    .map(entry => ({
      id: entry.id,
      name: entry.name,
      key: entry.key,
      aliases: entry.aliases,
      lcsc: [...entry.lcscSet].sort(comparePartIds),
      category: entry.category,
      bounds: entry.bounds,
      pads: entry.pads,
      holes: entry.holes,
      vias: entry.vias,
    }))
    .sort((left, right) => left.category.localeCompare(right.category) || left.key.localeCompare(right.key) || left.id.localeCompare(right.id));
}

function comparePartIds(left, right) {
  const leftNumber = /^C(\d+)$/.exec(left)?.[1];
  const rightNumber = /^C(\d+)$/.exec(right)?.[1];
  if (leftNumber && rightNumber) return Number(leftNumber) - Number(rightNumber);
  return left.localeCompare(right);
}

function chunkEntries(entries) {
  const chunksById = new Map();
  for (const entry of entries) {
    const id = dataChunkIdForEntry(entry);
    const chunk = chunksById.get(id) ?? {id, category: entry.category, entries: []};
    chunk.entries.push(entry);
    chunksById.set(id, chunk);
  }

  return [...chunksById.values()]
    .map(chunk => ({
      ...chunk,
      entries: chunk.entries.sort((left, right) => left.key.localeCompare(right.key) || left.id.localeCompare(right.id)),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function dataChunkIdForEntry(entry) {
  return [
    entry.category,
    `${indexPrefix(entry.key)}-${hashText(entry.id, dataChunkHashLength).toUpperCase()}`,
  ].join("/");
}

async function writeFileIfChanged(filePath, content) {
  const previous = await readOptionalText(filePath);
  if (previous === content) return false;

  await mkdir(path.dirname(filePath), {recursive: true});
  await writeFile(filePath, content);
  return true;
}

async function removeStaleGeneratedFiles(root, desiredFiles) {
  if (!existsSync(root)) return 0;

  let removed = 0;
  for (const filePath of await generatedJsonFiles(root)) {
    if (desiredFiles.has(filePath)) continue;
    await rm(filePath, {force: true});
    removed += 1;
  }

  await removeEmptyDirectories(path.join(root, "index"));
  await removeEmptyDirectories(path.join(root, "data"));
  return removed;
}

async function generatedJsonFiles(root) {
  const files = [];

  async function walk(directory) {
    if (!existsSync(directory)) return;
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.name.endsWith(".json")) {
        files.push(entryPath);
      }
    }
  }

  await walk(path.join(root, "index"));
  await walk(path.join(root, "data"));
  const manifestPath = path.join(root, "manifest.json");
  if (existsSync(manifestPath)) files.push(manifestPath);
  return files;
}

async function removeEmptyDirectories(directory) {
  if (!existsSync(directory)) return;

  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await removeEmptyDirectories(entryPath);
  }

  const remaining = await readdir(directory);
  if (remaining.length === 0) await rm(directory, {recursive: true, force: true});
}

function indexPrefix(key) {
  return (key.slice(0, indexPrefixLength) || "_").padEnd(indexPrefixLength, "_");
}

function buildIndexChunks(chunks) {
  const indexChunks = new Map();
  for (const chunk of chunks) {
    chunk.entries.forEach((entry, entryIndex) => {
      for (const alias of [entry.name, ...entry.aliases]) {
        const key = normalizeKey(alias);
        if (key === "") continue;
        const prefix = indexPrefix(key);
        const indexChunk = indexChunks.get(prefix) ?? new Map();
        const refs = indexChunk.get(key) ?? [];
        refs.push([chunk.id, entryIndex]);
        indexChunk.set(key, refs);
        indexChunks.set(prefix, indexChunk);
      }
    });
  }

  return [...indexChunks.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([prefix, keys]) => ({
      prefix,
      keys: Object.fromEntries([...keys.entries()].sort(([left], [right]) => left.localeCompare(right))),
    }));
}

async function writeLibrary(entries) {
  await mkdir(path.join(outputRoot, "index"), {recursive: true});
  await mkdir(path.join(outputRoot, "data"), {recursive: true});

  const chunks = chunkEntries(entries);
  const indexChunks = buildIndexChunks(chunks);
  const categories = {};
  const revision = hashText(compactJson(entries), 16);
  const desiredFiles = new Set();
  let changedFiles = 0;
  let skippedFiles = 0;

  for (const chunk of chunks) {
    const category = categories[chunk.category] ?? {chunks: 0, footprints: 0, pads: 0, holes: 0, vias: 0};
    category.chunks += 1;
    category.footprints += chunk.entries.length;
    category.pads += chunk.entries.reduce((sum, entry) => sum + entry.pads.length, 0);
    category.holes += chunk.entries.reduce((sum, entry) => sum + entry.holes.length, 0);
    category.vias += chunk.entries.reduce((sum, entry) => sum + entry.vias.length, 0);
    categories[chunk.category] = category;

    const filePath = path.join(outputRoot, "data", `${chunk.id}.json`);
    desiredFiles.add(filePath);
    const changed = await writeFileIfChanged(
      filePath,
      compactJson({
        format: "bomboard-footprint-data-v1",
        unit: "mm",
        category: chunk.category,
        footprints: chunk.entries,
      })
    );
    if (changed) changedFiles += 1;
    else skippedFiles += 1;
  }

  for (const indexChunk of indexChunks) {
    const filePath = path.join(outputRoot, "index", `${indexChunk.prefix}.json`);
    desiredFiles.add(filePath);
    const changed = await writeFileIfChanged(
      filePath,
      compactJson({
        format: "bomboard-footprint-index-v1",
        prefix: indexChunk.prefix,
        keys: indexChunk.keys,
      })
    );
    if (changed) changedFiles += 1;
    else skippedFiles += 1;
  }

  const manifestPath = path.join(outputRoot, "manifest.json");
  desiredFiles.add(manifestPath);
  const manifestChanged = await writeFileIfChanged(
    manifestPath,
    `${JSON.stringify({
      format: "bomboard-footprint-library-v1",
      revision,
      source: "corpus",
      unit: "mm",
      indexPrefixLength,
      footprints: entries.length,
      pads: entries.reduce((sum, entry) => sum + entry.pads.length, 0),
      holes: entries.reduce((sum, entry) => sum + entry.holes.length, 0),
      vias: entries.reduce((sum, entry) => sum + entry.vias.length, 0),
      categories,
      indexChunks: indexChunks.map(chunk => chunk.prefix),
    }, null, 2)}\n`
  );
  if (manifestChanged) changedFiles += 1;
  else skippedFiles += 1;

  const removedFiles = await removeStaleGeneratedFiles(outputRoot, desiredFiles);
  return {changedFiles, skippedFiles, removedFiles};
}

const entries = await buildEntries();
const writeStats = await writeLibrary(entries);

const padCount = entries.reduce((sum, entry) => sum + entry.pads.length, 0);
const holeCount = entries.reduce((sum, entry) => sum + entry.holes.length, 0);
const viaCount = entries.reduce((sum, entry) => sum + entry.vias.length, 0);
console.log(`Generated ${entries.length} footprints, ${padCount} pads, ${holeCount} holes, ${viaCount} vias at ${path.relative(repoRoot, outputRoot)}`);
console.log(`Footprint library files: changed=${writeStats.changedFiles} skipped=${writeStats.skippedFiles} removed=${writeStats.removedFiles}`);
