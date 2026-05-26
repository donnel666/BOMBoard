import {mkdir, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

import {
  classifyBomCoordinateFile,
  parseBomCoordinateProject,
  parseGerber2DProject,
  renderGerber2DSideSvg,
  selectGerber2DFiles,
} from "../packages/parsers/dist/index.js";
import {
  createBoardViewerModel,
  loadFootprintLibraryForComponents,
  resolveFootprintCandidates,
} from "../packages/viewer/dist/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputRoot = path.resolve(repoRoot, process.argv[2] ?? "tmp/jlc");
const outputRoot = path.resolve(repoRoot, process.argv[3] ?? "tmp/highlight-review");
const footprintRoot = path.resolve(repoRoot, "apps/web/public/footprints");
const mirrorBottom = true;
const textDecoder = new TextDecoder("utf-8");
const viewerColors = {
  background: "#0b1110",
  dimOverlay: "#050706",
  similarFill: "#ffd35c",
  selectedFill: "#ff8a4c",
};

const categoryOrder = [
  "passive-resistor",
  "passive-capacitor",
  "passive-inductor",
  "diode-led",
  "ic-sot",
  "ic-qfn-dfn",
  "ic-qfp",
  "ic-sop",
  "ic-array",
  "oscillator",
  "connector",
  "switch",
  "through-hole",
  "other",
];

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const files = await readProjectFiles(inputRoot);
  if (files.length === 0) {
    throw new Error(`No project files found in ${inputRoot}`);
  }

  const bomFile = selectBomCoordinateFile(files, "bom");
  if (!bomFile) throw new Error("Could not identify a BOM CSV/XLSX file.");

  const coordinateFile = selectBomCoordinateFile(files, "coordinates");
  if (!coordinateFile) throw new Error("Could not identify a coordinate CSV/XLSX file.");

  const gerberFiles = files.map(toGerberInputFile);
  const gerberSelection = selectGerber2DFiles(gerberFiles);
  if (gerberSelection.tracespaceFiles.length === 0) {
    throw new Error("Could not identify renderable Gerber files.");
  }

  installLocalFootprintFetch();

  const bomCoordinates = parseBomCoordinateProject({
    bom: {name: bomFile.name, bytes: bomFile.bytes},
    coordinates: {name: coordinateFile.name, bytes: coordinateFile.bytes},
  });
  const gerber = await parseGerber2DProject(gerberFiles);
  const footprintLibrary = await loadFootprintLibraryForComponents(
    bomCoordinates.components,
    {baseUrl: "http://bomboard.local/footprints"}
  );
  const model = createBoardViewerModel({
    gerber,
    bomCoordinates,
    footprintLibrary,
    mirrorBottom,
  });

  const representatives = selectRepresentatives(model.components, footprintLibrary);
  const highlightElementsByDesignator = new Map(
    model.components.map(component => [
      component.designator,
      component.highlightElements,
    ])
  );
  const boardBaseSvgs = {
    top: renderGerber2DSideSvg(gerber, "top", {mirrorBottom}),
    bottom: renderGerber2DSideSvg(gerber, "bottom", {mirrorBottom}),
  };

  await rm(outputRoot, {recursive: true, force: true});
  await mkdir(outputRoot, {recursive: true});

  const manifestEntries = [];
  for (let index = 0; index < representatives.length; index += 1) {
    const item = representatives[index];
    const highlightItems = item.components
      .map(component => ({
        component,
        highlightElements: highlightElementsByDesignator.get(component.designator) ?? [],
      }))
      .filter(entry => entry.highlightElements.length > 0);
    const filename = `${String(index + 1).padStart(3, "0")}-${safeFileName([
      item.side,
      item.category,
      item.footprint,
      item.component.designator,
    ].join("-"))}.svg`;
    const svg = renderComponentReviewSvg({
      ...item,
      highlightItems,
    }, boardBaseSvgs[item.side], model.viewBox);
    await writeFile(path.join(outputRoot, filename), svg, "utf8");
    manifestEntries.push({
      filename,
      side: item.side,
      category: item.category,
      footprint: item.footprint,
      designator: item.component.designator,
      comment: item.component.comment,
      highlightedComponentCount: highlightItems.length,
      highlightElements: highlightItems.reduce((sum, entry) => sum + entry.highlightElements.length, 0),
      sameTypeCount: item.sameTypeCount,
    });
  }

  const overviewEntries = [];
  for (const side of ["top", "bottom"]) {
    const filename = `${side}-all-devices.svg`;
    const sideComponents = model.components.filter(component => component.side === side);
    const highlightItems = sideComponents
      .map(component => ({
        component,
        highlightElements: highlightElementsByDesignator.get(component.designator) ?? [],
      }))
      .filter(item => item.highlightElements.length > 0);
    const svg = renderSideOverviewSvg(
      side,
      boardBaseSvgs[side],
      model.viewBox,
      highlightItems
    );
    await writeFile(path.join(outputRoot, filename), svg, "utf8");
    overviewEntries.push({
      filename,
      side,
      componentCount: sideComponents.length,
      highlightedComponentCount: highlightItems.length,
      highlightElements: highlightItems.reduce((sum, item) => sum + item.highlightElements.length, 0),
    });
  }

  await writeFile(
    path.join(outputRoot, "manifest.json"),
    `${JSON.stringify({
      source: path.relative(repoRoot, inputRoot),
      generatedAt: new Date().toISOString(),
      componentCount: model.components.length,
      typeCount: manifestEntries.length,
      overviews: overviewEntries,
      items: manifestEntries,
    }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(path.join(outputRoot, "index.html"), renderIndexHtml(manifestEntries, overviewEntries), "utf8");

  console.log(`Generated ${manifestEntries.length} package/side review image(s).`);
  console.log(`Generated ${overviewEntries.length} all-device overview image(s).`);
  console.log(pathToFileURL(path.join(outputRoot, "index.html")).toString());
}

async function readProjectFiles(root) {
  const files = [];
  const rootStat = await stat(root);

  if (rootStat.isFile()) {
    files.push({
      name: path.basename(root),
      path: root,
      bytes: await readFile(root),
    });
    return files;
  }

  await walk(root, "");
  return files;

  async function walk(directory, relativeDirectory) {
    const entries = await readdir(directory, {withFileTypes: true});
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolutePath = path.join(directory, entry.name);
      const relativePath = normalizePath(path.join(relativeDirectory, entry.name));
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        files.push({
          name: relativePath,
          path: absolutePath,
          bytes: await readFile(absolutePath),
        });
      }
    }
  }
}

function selectBomCoordinateFile(files, kind) {
  const matches = files
    .filter(file => classifyBomCoordinateFile({name: file.name, bytes: file.bytes}).kind === kind)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }));

  return matches[0] ?? null;
}

function toGerberInputFile(file) {
  return {
    name: file.name,
    path: file.path,
    text: textDecoder.decode(file.bytes),
  };
}

function installLocalFootprintFetch() {
  globalThis.fetch = async url => {
    const parsed = new URL(String(url));
    if (parsed.origin !== "http://bomboard.local") {
      return new Response("Not found", {status: 404});
    }

    const relativePath = decodeURIComponent(parsed.pathname).replace(/^\/footprints\/?/, "");
    const filePath = path.resolve(footprintRoot, relativePath);
    if (!filePath.startsWith(`${footprintRoot}${path.sep}`) && filePath !== footprintRoot) {
      return new Response("Forbidden", {status: 403});
    }

    try {
      const body = await readFile(filePath);
      return new Response(body, {
        status: 200,
        headers: {"content-type": "application/json"},
      });
    } catch {
      return new Response("Not found", {status: 404});
    }
  };
}

function selectRepresentatives(components, footprintLibrary) {
  const groups = new Map();

  for (const component of components) {
    if (component.side !== "top" && component.side !== "bottom") continue;
    const category = componentCategory(component, footprintLibrary);
    const footprint = cleanLabel(component.footprint || component.source.placement?.footprint || "unknown");
    const key = [component.side, category, footprint].join("|");
    const existing = groups.get(key);
    if (!existing || compareDesignators(component.designator, existing.component.designator) < 0) {
      groups.set(key, {
        side: component.side,
        category,
        footprint,
        component,
        components: [],
        sameTypeCount: 0,
      });
    }
  }

  for (const component of components) {
    if (component.side !== "top" && component.side !== "bottom") continue;
    const category = componentCategory(component, footprintLibrary);
    const footprint = cleanLabel(component.footprint || component.source.placement?.footprint || "unknown");
    const group = groups.get([component.side, category, footprint].join("|"));
    if (group) {
      group.sameTypeCount += 1;
      group.components.push(component);
    }
  }

  return [...groups.values()].sort((left, right) => {
    const category = categoryRank(left.category) - categoryRank(right.category);
    if (category !== 0) return category;
    const side = left.side.localeCompare(right.side);
    if (side !== 0) return side;
    const footprint = left.footprint.localeCompare(right.footprint, undefined, {
      numeric: true,
      sensitivity: "base",
    });
    if (footprint !== 0) return footprint;
    return compareDesignators(left.component.designator, right.component.designator);
  });
}

function componentCategory(component, footprintLibrary) {
  const passiveCategory = passiveCategoryByDesignator(component.designator);
  if (passiveCategory) return passiveCategory;

  const candidate = resolveFootprintCandidates(footprintLibrary, component.source)[0];
  if (candidate?.entry.category) return candidate.entry.category;
  return inferCategory(component);
}

function inferCategory(component) {
  const designator = component.designator.toUpperCase();
  const footprint = `${component.footprint} ${component.comment}`.toUpperCase();
  const passiveCategory = passiveCategoryByDesignator(designator);
  if (passiveCategory) return passiveCategory;
  if (/^(?:D|LED)\d/.test(designator) || /\b(?:LED|SOD|SMA|SMB|SMC)\b/.test(footprint)) return "diode-led";
  if (/\b(?:QFN|DFN)\b/.test(footprint)) return "ic-qfn-dfn";
  if (/\bQFP\b/.test(footprint)) return "ic-qfp";
  if (/\b(?:SOP|SOIC|SSOP|TSSOP|MSOP)\b/.test(footprint)) return "ic-sop";
  if (/\b(?:BGA|CSP|LGA)\b/.test(footprint)) return "ic-array";
  if (/\bSOT\b/.test(footprint)) return "ic-sot";
  if (/^(?:J|P|CN|USB|RJ)\d/.test(designator) || /\b(?:CONN|SOCKET|USB|RJ)\b/.test(footprint)) return "connector";
  if (/\b(?:TH|THT|DIP|HDR-TH)\b/.test(footprint)) return "through-hole";
  if (/^(?:Y|X)\d/.test(designator) || /\b(?:OSC|XTAL|CRYSTAL)\b/.test(footprint)) return "oscillator";
  if (/^SW\d/.test(designator) || /\b(?:SW|BUTTON|BTN)\b/.test(footprint)) return "switch";
  return "other";
}

function passiveCategoryByDesignator(designator) {
  const prefix = designator.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? "";
  if (prefix === "R" || prefix === "RN" || prefix === "RP") return "passive-resistor";
  if (prefix === "C") return "passive-capacitor";
  if (prefix === "L" || prefix === "FB") return "passive-inductor";
  return null;
}

function renderComponentReviewSvg(item, boardSvg, viewBox) {
  const component = item.component;
  const [x, y, width, height] = viewBox;
  const selectedElements = worldElementsForComponent(component, item.highlightItems);
  const similarElements = item.highlightItems
    .filter(entry => entry.component.designator !== component.designator)
    .flatMap(entry => worldElementsForComponent(entry.component, [entry]));
  const worldElements = [...similarElements, ...selectedElements];
  const title = `${component.designator} | ${item.side} | ${item.category} | ${item.footprint}`;
  const subtitle = [
    component.comment,
    `${item.highlightItems.length} highlighted component(s)`,
    `${worldElements.length} preview highlight element(s)`,
    `${item.sameTypeCount} same type`,
  ].filter(Boolean).join(" | ");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${formatNumber(x)} ${formatNumber(y)} ${formatNumber(width)} ${formatNumber(height)}" width="1600" height="1100" fill-rule="evenodd" clip-rule="evenodd" stroke-linecap="round" stroke-linejoin="round">`,
    `<title>${escapeText(title)}</title>`,
    `<desc>${escapeText(subtitle)}</desc>`,
    `<rect x="${formatNumber(x)}" y="${formatNumber(y)}" width="${formatNumber(width)}" height="${formatNumber(height)}" fill="${viewerColors.background}"/>`,
    innerSvg(boardSvg),
    worldElements.length > 0 ? renderDimOverlay({minX: x, minY: y, maxX: x + width, maxY: y + height}) : "",
    similarElements.length > 0 ? renderViewerHighlight(similarElements, "similar") : "",
    selectedElements.length > 0 ? renderViewerHighlight(selectedElements, "selected") : "",
    "</svg>",
  ].join("");
}

function renderSideOverviewSvg(side, boardSvg, viewBox, items) {
  const [x, y, width, height] = viewBox;
  const worldElements = items.flatMap(item => worldElementsForComponent(item.component, [item]));

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${formatNumber(x)} ${formatNumber(y)} ${formatNumber(width)} ${formatNumber(height)}" width="1600" height="1100" fill-rule="evenodd" clip-rule="evenodd" stroke-linecap="round" stroke-linejoin="round">`,
    `<rect x="${formatNumber(x)}" y="${formatNumber(y)}" width="${formatNumber(width)}" height="${formatNumber(height)}" fill="${viewerColors.background}"/>`,
    innerSvg(boardSvg),
    worldElements.length > 0 ? renderDimOverlay({minX: x, minY: y, maxX: x + width, maxY: y + height}) : "",
    worldElements.length > 0 ? renderViewerHighlight(worldElements, "similar") : "",
    `<!-- ${side} side: ${items.length} device(s), ${worldElements.length} preview highlight element(s). -->`,
    "</svg>",
  ].join("");
}

function worldElementsForComponent(component, items) {
  const item = items.find(entry => entry.component.designator === component.designator);
  if (!item) return [];

  const rotation = componentDisplayRotation(component);
  return item.highlightElements.map(element => localElementToWorld(element, component, rotation));
}

function renderDimOverlay(bounds) {
  return `<rect x="${formatNumber(bounds.minX)}" y="${formatNumber(bounds.minY)}" width="${formatNumber(boundsWidth(bounds))}" height="${formatNumber(boundsHeight(bounds))}" fill="${viewerColors.dimOverlay}" opacity="0.58"/>`;
}

function renderViewerHighlight(elements, state) {
  const selected = state === "selected";
  const fill = selected ? viewerColors.selectedFill : viewerColors.similarFill;

  return renderViewerHighlightFill(elements, {fill, alpha: 0.95});
}

function renderViewerHighlightFill(elements, style) {
  return elements.map(element => {
    if (element.kind === "circle") {
      return `<circle cx="${formatNumber(element.center.x)}" cy="${formatNumber(element.center.y)}" r="${formatNumber(element.radiusMm)}" fill="${style.fill}" fill-opacity="${formatNumber(style.alpha)}"/>`;
    }

    if (element.kind === "polyline") {
      const points = element.points.map(point => `${formatNumber(point.x)},${formatNumber(point.y)}`).join(" ");
      return `<polyline points="${points}" fill="none" stroke="${style.fill}" stroke-opacity="${formatNumber(style.alpha)}" stroke-width="${formatNumber(element.strokeWidthMm)}"/>`;
    }

    const points = element.points.map(point => `${formatNumber(point.x)},${formatNumber(point.y)}`).join(" ");
    return `<polygon points="${points}" fill="${style.fill}" fill-opacity="${formatNumber(style.alpha)}"/>`;
  }).join("");
}

function localElementToWorld(element, component, rotation) {
  if (element.kind === "circle") {
    return {
      kind: "circle",
      center: localPointToWorld(element.center, component.displayPosition, rotation),
      radiusMm: element.radiusMm,
    };
  }

  if (element.kind === "polyline") {
    return {
      kind: "polyline",
      points: element.points.map(point => localPointToWorld(point, component.displayPosition, rotation)),
      strokeWidthMm: element.strokeWidthMm,
    };
  }

  return {
    kind: "polygon",
    points: element.points.map(point => localPointToWorld(point, component.displayPosition, rotation)),
  };
}

function localPointToWorld(point, position, rotation) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: position.x + point.x * cos - point.y * sin,
    y: position.y + point.x * sin + point.y * cos,
  };
}

function renderIndexHtml(items, overviews) {
  const overviewCards = overviews.map(item => [
    `<article class="card overview-card">`,
    `<a href="${escapeAttr(item.filename)}" target="_blank" rel="noreferrer">`,
    `<img src="${escapeAttr(item.filename)}" alt="${escapeAttr(`${item.side} all devices`)}">`,
    `</a>`,
    `<div class="meta">`,
    `<strong>${escapeText(item.side)} all devices <span>overview</span></strong>`,
    `<p>${item.highlightedComponentCount}/${item.componentCount} device(s) with preview overlays</p>`,
    `<small>${item.highlightElements} preview highlight element(s)</small>`,
    `</div>`,
    `</article>`,
  ].join("")).join("");
  const topCards = renderCards(items.filter(item => item.side === "top"));
  const bottomCards = renderCards(items.filter(item => item.side === "bottom"));

  return [
    "<!doctype html>",
    `<html lang="en">`,
    "<head>",
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>BOMBoard Highlight Review</title>`,
    `<style>`,
    `body{margin:0;background:#101615;color:#f4f0e6;font-family:Arial,Helvetica,sans-serif}`,
    `header{position:sticky;top:0;z-index:1;padding:16px 20px;background:#171b20;border-bottom:1px solid rgba(255,255,255,.12)}`,
    `h1{margin:0 0 6px;font-size:20px}`,
    `h2{margin:20px 16px 0;font-size:16px}`,
    `p{margin:0}`,
    `.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;padding:16px}`,
    `.card{overflow:hidden;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:#1d2422}`,
    `.overview-card{border-color:rgba(246,215,121,.42)}`,
    `.card img{display:block;width:100%;aspect-ratio:4/3;object-fit:contain;background:#0b1110}`,
    `.meta{display:grid;gap:4px;padding:10px 12px}`,
    `.meta strong{display:flex;justify-content:space-between;gap:8px}`,
    `.meta span,.meta small{color:#f6d779}`,
    `.meta p{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#d7cdbb}`,
    `</style>`,
    "</head>",
    "<body>",
    "<header>",
    `<h1>BOMBoard Highlight Review</h1>`,
    `<p>${items.length} package/side full-board image(s), plus ${overviews.length} all-device overview image(s). Images use the same board and highlight renderer as the web preview.</p>`,
    "</header>",
    `<section><h2>Full Board</h2><main class="grid">${overviewCards}</main></section>`,
    `<section><h2>Top</h2><main class="grid">${topCards}</main></section>`,
    `<section><h2>Bottom</h2><main class="grid">${bottomCards}</main></section>`,
    "</body>",
    "</html>",
  ].join("");
}

function renderCards(items) {
  const cards = items.map(item => [
    `<article class="card">`,
    `<a href="${escapeAttr(item.filename)}" target="_blank" rel="noreferrer">`,
    `<img src="${escapeAttr(item.filename)}" alt="${escapeAttr(`${item.designator} ${item.footprint}`)}">`,
    `</a>`,
    `<div class="meta">`,
    `<strong>${escapeText(item.designator)} <span>${escapeText(item.side)}</span></strong>`,
    `<p>${escapeText(item.category)}</p>`,
    `<p>${escapeText(item.footprint)}</p>`,
    `<p>${escapeText(item.comment || "")}</p>`,
    `<small>${item.highlightedComponentCount}/${item.sameTypeCount} component(s), ${item.highlightElements} preview highlight element(s)</small>`,
    `</div>`,
    `</article>`,
  ].join("")).join("");

  return cards;
}

function componentDisplayRotation(component) {
  return component.side === "bottom" && mirrorBottom
    ? radians(component.rotationDeg)
    : -radians(component.rotationDeg);
}

function innerSvg(svg) {
  return svg
    .replace(/^<svg\b[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "");
}

function categoryRank(category) {
  const index = categoryOrder.indexOf(category);
  return index === -1 ? categoryOrder.length : index;
}

function compareDesignators(left, right) {
  const leftParts = splitDesignator(left);
  const rightParts = splitDesignator(right);
  if (leftParts && rightParts) {
    const prefix = leftParts.prefix.localeCompare(rightParts.prefix);
    if (prefix !== 0) return prefix;
    return leftParts.number - rightParts.number;
  }
  return left.localeCompare(right, undefined, {numeric: true, sensitivity: "base"});
}

function splitDesignator(designator) {
  const match = designator.match(/^([A-Za-z]+)(\d+)$/);
  if (!match) return null;
  return {
    prefix: match[1],
    number: Number.parseInt(match[2], 10),
  };
}

function boundsWidth(bounds) {
  return bounds.maxX - bounds.minX;
}

function boundsHeight(bounds) {
  return bounds.maxY - bounds.minY;
}

function cleanLabel(value) {
  return String(value || "unknown").trim() || "unknown";
}

function safeFileName(value) {
  return value
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "component";
}

function normalizePath(value) {
  return value.replaceAll(path.sep, "/");
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "0";
  return Number(value.toFixed(5)).toString();
}

function radians(degrees) {
  return (degrees * Math.PI) / 180;
}

function escapeText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(value) {
  return escapeText(value)
    .replaceAll('"', "&quot;");
}
