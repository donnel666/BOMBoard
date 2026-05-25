import type {Gerber2DProject} from "./tracespace-adapter.js";
import type {BoardSide, DrillHit, Gerber2DFileKind, ViaInfoRecord, ViewBox} from "./types.js";

export interface Gerber2DProcessColors {
  substrate: string;
  copper: string;
  solderMask: string;
  viaCoverOil: string;
  silkscreen: string;
  maskOpening: string;
  drillHole: string;
  boardEdge: string;
}

export interface Gerber2DRenderOptions {
  colors?: Partial<Gerber2DProcessColors>;
  mirrorBottom?: boolean;
}

export const defaultGerber2DProcessColors: Gerber2DProcessColors = {
  substrate: "#4f3a1f",
  copper: "#d8a73f",
  solderMask: "#087a3d",
  viaCoverOil: "#18a75a",
  silkscreen: "#f4f1e8",
  maskOpening: "#e0b64f",
  drillHole: "#151515",
  boardEdge: "#123524",
};

export function renderGerber2DSideSvg(
  project: Gerber2DProject,
  side: Exclude<BoardSide, "inner" | "all" | null>,
  options: Gerber2DRenderOptions = {}
): string {
  const colors = {...defaultGerber2DProcessColors, ...options.colors};
  const viewBox = project.fragments.boardShapeRenderFragment.viewBox as ViewBox;
  const copper = layerFragments(project, ["padMaster", "copper"], side);
  const solderMask = layerFragments(project, ["solderMask"], side);
  const silkscreen = layerFragments(project, ["silkscreen"], side);
  const drill = drillFragment(project.drills.flatMap(parsed => parsed.hits));
  const viaCovers = viaCoverFragment(project.vias);
  const ids = svgIds(`bomboard-${side}`);
  const shape = project.fragments.boardShapeRenderFragment.svgFragment;
  const [x, y, width, height] = viewBox;
  const clipPath = shape ? ` clip-path="url(#${ids.clip})"` : "";
  const sideTransform =
    side === "bottom" && options.mirrorBottom !== false
      ? ` transform="translate(${formatNumber(2 * x + width)},0) scale(-1,1)"`
      : "";

  return wrapSvg(viewBox, [
    "<defs>",
    shape ? `<clipPath id="${ids.clip}">${shape}</clipPath>` : "",
    `<mask id="${ids.drillMask}"><rect x="${formatNumber(x)}" y="${formatNumber(y)}" width="${formatNumber(width)}" height="${formatNumber(height)}" fill="#fff"/><g color="#000">${drill}</g></mask>`,
    `<mask id="${ids.resistMask}"><rect x="${formatNumber(x)}" y="${formatNumber(y)}" width="${formatNumber(width)}" height="${formatNumber(height)}" fill="#fff"/><g color="#000">${solderMask}</g></mask>`,
    "</defs>",
    `<g${sideTransform}${clipPath}>`,
    `<g mask="url(#${ids.drillMask})">`,
    `<rect x="${formatNumber(x)}" y="${formatNumber(y)}" width="${formatNumber(width)}" height="${formatNumber(height)}" fill="${colors.substrate}"/>`,
    `<g color="${colors.copper}">${copper}</g>`,
    "</g>",
    `<g mask="url(#${ids.resistMask})">`,
    `<rect x="${formatNumber(x)}" y="${formatNumber(y)}" width="${formatNumber(width)}" height="${formatNumber(height)}" fill="${colors.solderMask}" opacity="0.92"/>`,
    `<g color="${colors.viaCoverOil}">${viaCovers}</g>`,
    `<g color="${colors.silkscreen}">${silkscreen}</g>`,
    "</g>",
    shape ? `<g color="${colors.boardEdge}" fill="none" stroke="currentColor" stroke-width="0.12">${shape}</g>` : "",
    "</g>",
  ]);
}

export function renderGerber2DLayerSvg(
  project: Gerber2DProject,
  kind: Gerber2DFileKind | "vias",
  side: Exclude<BoardSide, "inner" | "all"> = null,
  options: Gerber2DRenderOptions = {}
): string {
  const colors = {...defaultGerber2DProcessColors, ...options.colors};
  const viewBox = project.fragments.boardShapeRenderFragment.viewBox as ViewBox;
  const [x, y, width, height] = viewBox;
  const shape = project.fragments.boardShapeRenderFragment.svgFragment;
  const clipId = `clip-${kind}-${side ?? "all"}`;
  const clipPath = shape ? ` clip-path="url(#${clipId})"` : "";
  const layer = reviewLayerFragment(project, kind, side);
  const color = reviewLayerColor(kind, colors);

  return wrapSvg(viewBox, [
    shape ? `<defs><clipPath id="${clipId}">${shape}</clipPath></defs>` : "",
    `<g${clipPath}>`,
    `<rect x="${formatNumber(x)}" y="${formatNumber(y)}" width="${formatNumber(width)}" height="${formatNumber(height)}" fill="${colors.solderMask}" opacity="0.24"/>`,
    kind === "profile" && shape
      ? `<g color="${colors.boardEdge}" fill="${colors.solderMask}" stroke="currentColor" stroke-width="0.16">${shape}</g>`
      : "",
    `<g color="${color}">${layer}</g>`,
    "</g>",
  ]);
}

export function renderGerber2DReviewSvgs(
  project: Gerber2DProject,
  options: Gerber2DRenderOptions = {}
): Record<string, string> {
  const svgs: Record<string, string> = {
    "01-profile.svg": renderGerber2DLayerSvg(project, "profile", null, options),
    "02-drill-vias.svg": renderGerber2DLayerSvg(project, "vias", null, options),
  };

  if (hasLayer(project, ["padMaster", "copper"], "top")) {
    svgs["03-top-pads.svg"] = renderGerber2DLayerSvg(project, "padMaster", "top", options);
  }

  if (hasLayer(project, ["padMaster", "copper"], "bottom")) {
    svgs["04-bottom-pads.svg"] = renderGerber2DLayerSvg(project, "padMaster", "bottom", options);
  }

  if (hasLayer(project, ["solderMask"], "top")) {
    svgs["05-top-solder-mask.svg"] = renderGerber2DLayerSvg(project, "solderMask", "top", options);
  }

  if (hasLayer(project, ["solderMask"], "bottom")) {
    svgs["06-bottom-solder-mask.svg"] = renderGerber2DLayerSvg(project, "solderMask", "bottom", options);
  }

  if (hasLayer(project, ["silkscreen"], "top")) {
    svgs["07-top-silkscreen.svg"] = renderGerber2DLayerSvg(project, "silkscreen", "top", options);
  }

  if (hasLayer(project, ["silkscreen"], "bottom")) {
    svgs["08-bottom-silkscreen.svg"] = renderGerber2DLayerSvg(project, "silkscreen", "bottom", options);
  }

  svgs["09-top-composite.svg"] = renderGerber2DSideSvg(project, "top", options);
  svgs["10-bottom-composite.svg"] = renderGerber2DSideSvg(project, "bottom", options);

  return svgs;
}

function reviewLayerFragment(
  project: Gerber2DProject,
  kind: Gerber2DFileKind | "vias",
  side: Exclude<BoardSide, "inner" | "all">
): string {
  if (kind === "vias") {
    return [viaCoverFragment(project.vias), drillFragment(project.drills.flatMap(parsed => parsed.hits))].join("");
  }

  if (kind === "profile") {
    return project.fragments.boardShapeRenderFragment.svgFragment ?? "";
  }

  if (kind === "padMaster") {
    return layerFragments(project, ["padMaster", "copper"], side);
  }

  return layerFragments(project, [kind], side);
}

function reviewLayerColor(kind: Gerber2DFileKind | "vias", colors: Gerber2DProcessColors): string {
  switch (kind) {
    case "profile":
      return colors.boardEdge;
    case "vias":
      return colors.viaCoverOil;
    case "padMaster":
    case "copper":
      return colors.copper;
    case "solderMask":
      return colors.maskOpening;
    case "silkscreen":
      return colors.silkscreen;
    case "drill":
      return colors.drillHole;
    case "viaInfo":
    case "paste":
    case "support":
    case "ignored":
    case "unknown":
      return colors.boardEdge;
  }
}

function layerFragments(
  project: Gerber2DProject,
  kinds: Gerber2DFileKind[],
  side: Exclude<BoardSide, "inner" | "all">
): string {
  return project.fragments.layers
    .filter(layer => {
      const classification = project.layerClassificationsById[layer.id];
      if (!classification) return false;
      return kinds.includes(classification.kind) && (side === null || classification.side === side);
    })
    .map(layer => project.fragments.svgFragmentsById[layer.id] ?? "")
    .join("");
}

function hasLayer(
  project: Gerber2DProject,
  kinds: Gerber2DFileKind[],
  side: Exclude<BoardSide, "inner" | "all" | null>
): boolean {
  return project.fragments.layers.some(layer => {
    const classification = project.layerClassificationsById[layer.id];
    return Boolean(classification && kinds.includes(classification.kind) && classification.side === side);
  });
}

function drillFragment(hits: DrillHit[]): string {
  if (hits.length === 0) return "";

  return `<g>${hits
    .map(hit => {
      const radius = Math.max(hit.diameterMm / 2, 0.04);
      return `<circle cx="${formatNumber(hit.xMm)}" cy="${formatNumber(-hit.yMm)}" r="${formatNumber(radius)}"/>`;
    })
    .join("")}</g>`;
}

function viaCoverFragment(vias: ViaInfoRecord[]): string {
  if (vias.length === 0) return "";

  return `<g>${vias
    .map(via => {
      const radius = Math.max(via.padDiameterMm / 2, via.holeDiameterMm / 2);
      return `<circle cx="${formatNumber(via.xMm)}" cy="${formatNumber(-via.yMm)}" r="${formatNumber(radius)}"/>`;
    })
    .join("")}</g>`;
}

function wrapSvg(viewBox: ViewBox, children: string[]): string {
  const [x, y, width, height] = viewBox;

  return [
    `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="${formatNumber(x)} ${formatNumber(y)} ${formatNumber(width)} ${formatNumber(height)}" width="${formatNumber(width)}mm" height="${formatNumber(height)}mm" stroke-linecap="round" stroke-linejoin="round" stroke-width="0" fill-rule="evenodd" clip-rule="evenodd" fill="currentColor" stroke="currentColor">`,
    ...children.filter(Boolean),
    "</svg>",
  ].join("");
}

function svgIds(prefix: string): {clip: string; drillMask: string; resistMask: string} {
  return {
    clip: `${prefix}-clip`,
    drillMask: `${prefix}-drill-mask`,
    resistMask: `${prefix}-resist-mask`,
  };
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number(value.toFixed(5)).toString();
}
