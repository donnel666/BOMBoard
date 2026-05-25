import type {
  BoardSide,
  Gerber2DFileClassification,
  Gerber2DFileKind,
  Gerber2DFileTypePriority,
  Gerber2DInputFile,
} from "./types.js";

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
      "Use via-info CSV when present and parse Excellon drill coordinates directly for aligned masks.",
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
    function: "Top and bottom copper pad fallback when pad master files are missing.",
    implementation:
      "Fallback only for now; routing and pours are intentionally not part of the review target.",
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
];

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

  if (lowerName.endsWith("-viainfo.txt")) {
    return classification(name, extension, "viaInfo", "all", 2, false, "Altium via information CSV");
  }

  if (lowerName === "status report.txt") {
    return classification(name, extension, "ignored", null, null, false, "status report");
  }

  if ([".extrep", ".rep", ".drr", ".apr", ".ldp", ".htm"].includes(extension)) {
    return classification(name, extension, "support", null, null, false, "sidecar/support report");
  }

  if (lowerName.endsWith(".apr_lib")) {
    return classification(name, extension, "support", null, null, false, "aperture macro library");
  }

  if ([".txt", ".drl", ".xnc"].includes(extension)) {
    return classification(name, extension, "drill", "all", 2, false, "Excellon/NC drill candidate");
  }

  if ([".gm", ".gko", ".outline"].includes(extension)) {
    return classification(name, extension, "profile", "all", 1, true, "board profile/outline");
  }

  if (extension === ".gpt") {
    return classification(name, extension, "padMaster", "top", 3, true, "top pad master");
  }

  if (extension === ".gpb") {
    return classification(name, extension, "padMaster", "bottom", 3, true, "bottom pad master");
  }

  if (extension === ".gtl") {
    return classification(name, extension, "copper", "top", 4, true, "top copper fallback");
  }

  if (extension === ".gbl") {
    return classification(name, extension, "copper", "bottom", 4, true, "bottom copper fallback");
  }

  if (/^\.g\d+$/.test(extension)) {
    return classification(name, extension, "copper", "inner", null, false, "inner copper ignored for 2D MVP");
  }

  if (extension === ".gts") {
    return classification(name, extension, "solderMask", "top", 5, true, "top solder mask");
  }

  if (extension === ".gbs") {
    return classification(name, extension, "solderMask", "bottom", 5, true, "bottom solder mask");
  }

  if (extension === ".gto") {
    return classification(name, extension, "silkscreen", "top", 6, true, "top silkscreen");
  }

  if (extension === ".gbo") {
    return classification(name, extension, "silkscreen", "bottom", 6, true, "bottom silkscreen");
  }

  if (extension === ".gtp" || extension === ".gbp") {
    return classification(name, extension, "paste", sideFromExtension(extension), null, false, "paste ignored for 2D MVP");
  }

  if (/^\.gm\d+$/.test(extension) || /^\.gd\d+$/.test(extension) || /^\.gg\d+$/.test(extension)) {
    return classification(name, extension, "support", null, null, false, "mechanical/drawing layer ignored for 2D MVP");
  }

  return classification(name, extension, "unknown", null, null, false, "unrecognized file type");
}

export function selectGerber2DFiles(
  files: readonly Gerber2DInputFile[]
): Gerber2DSelection {
  const rows = files.map(input => ({
    input,
    classification: classifyGerber2DFileName(input.name),
  }));

  const hasTopPadMaster = rows.some(
    row => row.classification.kind === "padMaster" && row.classification.side === "top"
  );
  const hasBottomPadMaster = rows.some(
    row => row.classification.kind === "padMaster" && row.classification.side === "bottom"
  );

  return {
    classifications: rows.map(row => row.classification),
    tracespaceFiles: rows.filter(({classification}) => {
      if (!classification.renderable) return false;
      if (classification.kind !== "copper") return true;
      if (classification.side === "top") return !hasTopPadMaster;
      if (classification.side === "bottom") return !hasBottomPadMaster;
      return false;
    }),
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

function sideFromExtension(extension: string): BoardSide {
  if (extension.startsWith(".gt") || extension === ".gpt") return "top";
  if (extension.startsWith(".gb") || extension === ".gpb") return "bottom";
  return null;
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
