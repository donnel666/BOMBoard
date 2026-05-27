import {mkdir, readFile, readdir, stat, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {createWebBomBoardRuntime} from "../packages/runtime-web/dist/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2).filter(arg => arg !== "--");
const inputRoot = path.resolve(repoRoot, args[0] ?? "tmp/jlc");
const outputRoot = path.resolve(repoRoot, args[1] ?? "tmp/analysis");
const footprintRoot = path.resolve(repoRoot, "apps/web/public/footprints");
const unmatchedDotRadiusMm = 0.45;

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const files = await readProjectFiles(inputRoot);
  if (files.length === 0) {
    throw new Error(`No project files found in ${inputRoot}`);
  }

  installLocalFootprintFetch();

  const runtime = createWebBomBoardRuntime();
  const project = await runtime.parseProject({
    sourceName: path.basename(inputRoot),
    files,
  });
  const model = await runtime.createRenderModel(project, {
    footprintBaseUrl: "http://bomboard.local/footprints",
    mirrorBottom: true,
  });
  const bomItemsById = new Map(project.bom.items.map(item => [item.id, item]));

  const unmatchedComponents = model.components
    .filter(isUnmatchedDotComponent)
    .map(component => componentReport(component, bomItemsById))
    .sort(compareComponentReports);
  const unmatchedFootprints = groupUnmatchedFootprints(unmatchedComponents);
  const lcscCodes = extractLcscCodes(unmatchedComponents);

  await mkdir(outputRoot, {recursive: true});
  await writeFile(
    path.join(outputRoot, "unmatched-components.json"),
    `${JSON.stringify(unmatchedComponents, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(outputRoot, "unmatched-footprints.json"),
    `${JSON.stringify(unmatchedFootprints, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(outputRoot, "unmatched-lcsc-codes.txt"),
    lcscCodes.length > 0 ? `${lcscCodes.join("\n")}\n` : "",
    "utf8"
  );
  await writeFile(
    path.join(outputRoot, "unmatched-summary.md"),
    summaryMarkdown(model.components.length, unmatchedComponents, unmatchedFootprints, lcscCodes),
    "utf8"
  );

  console.log(`components=${model.components.length}`);
  console.log(`unmatched=${unmatchedComponents.length}`);
  console.log(`groups=${unmatchedFootprints.length}`);
  console.log(`lcsc_codes=${lcscCodes.length}`);
  for (const group of unmatchedFootprints.slice(0, 40)) {
    console.log(`${group.count}\t${group.designators.join(",")}\tfp=${group.footprint}\tcomment=${group.comment}\tpins=${group.pins}\tcandidates=${formatCandidateCount(group.candidateCount)}\tlcsc=${group.lcscCodes.join(",")}`);
  }
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

function isUnmatchedDotComponent(component) {
  const elements = component.highlightElements ?? [];
  if (elements.length !== 1) return false;
  const [element] = elements;
  return element.kind === "circle"
    && Math.abs(element.center.x) < 0.000001
    && Math.abs(element.center.y) < 0.000001
    && Math.abs(element.radiusMm - unmatchedDotRadiusMm) < 0.000001;
}

function componentReport(component, bomItemsById) {
  const bomRecord = component.source.bom
    ? bomItemsById.get(`bom:${component.source.bom.bomRecordIndex}`) ?? null
    : null;
  const raw = bomRecord?.fields ?? {};
  const values = reportValues(component, raw);

  return {
    designator: component.designator,
    side: component.side,
    footprint: component.footprint,
    comment: component.comment,
    libRef: component.libRef,
    pins: component.source.placement?.pins ?? component.source.bom?.pins ?? null,
    candidateCount: null,
    firstCandidates: [],
    rawLcs: pickRawFields(raw, [
      "LCSC Part Name",
      "Supplier Part",
      "Manufacturer Part",
      "Device",
      "Value",
    ]),
    device: values.device,
    lcscPartName: values.lcscPartName,
    lcscCodes: extractCodesFromObject(values),
    uniqueId: component.source.placement?.raw?.["Unique ID"] ?? component.source.placement?.raw?.["UniqueId"] ?? "",
  };
}

function reportValues(component, raw) {
  return {
    device: firstNonEmptyString([
      raw.Device,
      raw.device,
      raw["Manufacturer Part"],
      raw["Supplier Part"],
      component.libRef,
      component.comment,
    ]),
    lcscPartName: firstNonEmptyString([
      raw["LCSC Part Name"],
      raw["Supplier Part"],
      raw["Value"],
      component.comment,
    ]),
  };
}

function pickRawFields(raw, fields) {
  const result = {};
  for (const field of fields) {
    if (typeof raw[field] === "string" && raw[field] !== "") result[field] = raw[field];
  }
  return result;
}

function groupUnmatchedFootprints(components) {
  const groups = new Map();
  for (const component of components) {
    const key = [
      component.side,
      component.footprint,
      component.comment,
      component.libRef,
      component.pins ?? "",
    ].join("\u001f");
    const existing = groups.get(key);
    if (existing) {
      existing.designators.push(component.designator);
      existing.count += 1;
      for (const code of component.lcscCodes) existing.lcscCodeSet.add(code);
      continue;
    }

    groups.set(key, {
      ...component,
      designators: [component.designator],
      count: 1,
      lcscCodeSet: new Set(component.lcscCodes),
    });
  }

  return [...groups.values()]
    .map(group => {
      const {lcscCodeSet, ...rest} = group;
      return {
        ...rest,
        designators: rest.designators.sort(compareDesignators),
        lcscCodes: [...lcscCodeSet].sort(comparePartIds),
      };
    })
    .sort((left, right) => right.count - left.count || compareDesignators(left.designators[0], right.designators[0]));
}

function extractLcscCodes(components) {
  const codes = new Set();
  for (const component of components) {
    for (const code of component.lcscCodes) codes.add(code);
  }
  return [...codes].sort(comparePartIds);
}

function extractCodesFromObject(value) {
  const codes = new Set();
  const text = JSON.stringify(value);
  for (const match of text.matchAll(/C\d{3,}/g)) codes.add(match[0]);
  return [...codes].sort(comparePartIds);
}

function summaryMarkdown(totalComponents, components, groups, lcscCodes) {
  const lines = [
    "# Unmatched Footprint Scan",
    "",
    `- Components: ${totalComponents}`,
    `- Unmatched components: ${components.length}`,
    `- Unmatched footprint groups: ${groups.length}`,
    `- LCSC codes found: ${lcscCodes.length}`,
    "",
    "| Count | Designators | Footprint | Comment | Pins | Candidates | LCSC |",
    "|---:|---|---|---|---:|---:|---|",
  ];

  for (const group of groups) {
    lines.push(`| ${group.count} | ${group.designators.join(", ")} | ${escapeMarkdown(group.footprint)} | ${escapeMarkdown(group.comment)} | ${group.pins ?? ""} | ${formatCandidateCount(group.candidateCount)} | ${group.lcscCodes.join(", ")} |`);
  }

  return `${lines.join("\n")}\n`;
}

function formatCandidateCount(value) {
  return typeof value === "number" ? String(value) : "n/a";
}

function firstNonEmptyString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return "";
}

function compareComponentReports(left, right) {
  return compareDesignators(left.designator, right.designator);
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
  const match = String(designator).match(/^([A-Za-z]+)(\d+)$/);
  if (!match) return null;
  return {
    prefix: match[1],
    number: Number.parseInt(match[2], 10),
  };
}

function comparePartIds(left, right) {
  const leftNumber = /^C(\d+)$/.exec(left)?.[1];
  const rightNumber = /^C(\d+)$/.exec(right)?.[1];
  if (leftNumber && rightNumber) return Number(leftNumber) - Number(rightNumber);
  return left.localeCompare(right);
}

function escapeMarkdown(value) {
  return String(value ?? "").replaceAll("|", "\\|");
}

function normalizePath(value) {
  return value.replaceAll(path.sep, "/");
}
