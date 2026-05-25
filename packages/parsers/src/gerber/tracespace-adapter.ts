import {plot, read, renderFragments} from "@tracespace/core";

import {baseName, selectGerber2DFiles} from "./file-types.js";
import {parseExcellonDrill} from "./excellon-parser.js";
import {parseViaInfoCsv} from "./via-info-parser.js";

import type {
  Layer,
  ReadResult,
  RenderFragmentsResult,
} from "@tracespace/core";
import type {
  Gerber2DFileClassification,
  Gerber2DInputFile,
  ParsedExcellonDrill,
  ViaInfoRecord,
} from "./types.js";

export interface Gerber2DProject {
  classifications: Gerber2DFileClassification[];
  fragments: RenderFragmentsResult;
  layerClassificationsById: Record<string, Gerber2DFileClassification>;
  drills: ParsedExcellonDrill[];
  vias: ViaInfoRecord[];
  warnings: string[];
}

export async function parseGerber2DProject(
  files: readonly Gerber2DInputFile[]
): Promise<Gerber2DProject> {
  const selection = selectGerber2DFiles(files);
  const tracespaceInputs: Array<string | File> = [];
  const traceClassificationsByName = new Map<string, Gerber2DFileClassification>();
  const warnings: string[] = [];

  for (const {input, classification} of selection.tracespaceFiles) {
    const traceInput = input.path ?? input.file;
    if (!traceInput) {
      warnings.push(`Skipping ${input.name}: no path or File object was provided`);
      continue;
    }

    tracespaceInputs.push(traceInput);
    traceClassificationsByName.set(baseName(input.name).toLowerCase(), classification);
  }

  const readResult = await readTraceInputs(tracespaceInputs);
  const correctedReadResult = applyLayerClassificationOverrides(
    readResult,
    traceClassificationsByName
  );
  const fragments = renderFragments(plot(correctedReadResult));
  const layerClassificationsById: Record<string, Gerber2DFileClassification> = {};

  for (const layer of correctedReadResult.layers) {
    const classification = traceClassificationsByName.get(layer.filename.toLowerCase());
    if (classification) layerClassificationsById[layer.id] = classification;
  }

  const drills = selection.drillFiles.flatMap(({input}) => {
    if (!input.text) {
      warnings.push(`Skipping drill parse for ${input.name}: no text was provided`);
      return [];
    }

    const parsed = parseExcellonDrill(input.text, input.name);
    warnings.push(...parsed.warnings);
    return [parsed];
  });

  const vias = selection.viaInfoFiles.flatMap(({input}) => {
    if (!input.text) {
      warnings.push(`Skipping via-info parse for ${input.name}: no text was provided`);
      return [];
    }

    return parseViaInfoCsv(input.text);
  });

  return {
    classifications: selection.classifications,
    fragments,
    layerClassificationsById,
    drills,
    vias,
    warnings,
  };
}

async function readTraceInputs(inputs: Array<string | File>): Promise<ReadResult> {
  if (inputs.every((input): input is string => typeof input === "string")) {
    return read(inputs);
  }

  if (inputs.every((input): input is File => typeof input !== "string")) {
    return read(inputs);
  }

  throw new Error("Gerber2DProject cannot mix filesystem paths and File objects in one parse call");
}

function applyLayerClassificationOverrides(
  readResult: ReadResult,
  classificationsByName: Map<string, Gerber2DFileClassification>
): ReadResult {
  const layers = readResult.layers.map(layer => {
    const classification = classificationsByName.get(layer.filename.toLowerCase());
    if (!classification) return layer;

    return {
      ...layer,
      type: toTraceType(classification),
      side: toTraceSide(classification),
    };
  });

  return {...readResult, layers};
}

function toTraceType(classification: Gerber2DFileClassification): Layer["type"] {
  switch (classification.kind) {
    case "profile":
      return "outline";
    case "padMaster":
    case "copper":
      return "copper";
    case "solderMask":
      return "soldermask";
    case "silkscreen":
      return "silkscreen";
    case "paste":
      return "solderpaste";
    case "drill":
      return "drill";
    case "viaInfo":
    case "support":
    case "ignored":
    case "unknown":
      return null;
  }
}

function toTraceSide(classification: Gerber2DFileClassification): Layer["side"] {
  switch (classification.side) {
    case "top":
      return "top";
    case "bottom":
      return "bottom";
    case "inner":
      return "inner";
    case "all":
      return "all";
    case null:
      return null;
  }
}
