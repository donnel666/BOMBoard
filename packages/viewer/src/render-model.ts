import {createBoardViewerModel, viewerComponentSourcesFromProjectIR} from "./model.js";
import {loadFootprintLibraryForComponents} from "./footprint-library.js";
import type {
  BoardRenderer,
  BoardRenderOptions,
  BoardArtworkPrimitiveIR,
  BomBoardProjectIR,
  DrillHitIR,
  ViaIR,
  ViewBox,
} from "@bomboard/core";
import type {
  BoardRenderModel,
  BoardViewerSide,
  LegacyBoardRenderModelOptions,
} from "./types.js";

export interface BoardProcessColors {
  substrate: string;
  copper: string;
  solderMask: string;
  viaCoverOil: string;
  silkscreen: string;
  maskOpening: string;
  drillHole: string;
  boardEdge: string;
}

export interface BoardRenderModelOptions extends LegacyBoardRenderModelOptions {
  project: BomBoardProjectIR;
  processColors?: Partial<BoardProcessColors>;
}

export const defaultBoardProcessColors: BoardProcessColors = {
  substrate: "#4f3a1f",
  copper: "#d8a73f",
  solderMask: "#087a3d",
  viaCoverOil: "#18a75a",
  silkscreen: "#f4f1e8",
  maskOpening: "#e0b64f",
  drillHole: "#151515",
  boardEdge: "#123524",
};

export const defaultBoardRenderer: BoardRenderer<BoardRenderModel> = {
  id: "pixi-board-renderer",
  displayName: "Pixi board renderer",
  async createRenderModel(
    project: BomBoardProjectIR,
    options: BoardRenderOptions = {}
  ): Promise<BoardRenderModel> {
    const footprintComponentSources = viewerComponentSourcesFromProjectIR(project);
    const footprintLibrary = await loadFootprintLibraryForComponents(
      footprintComponentSources,
      {baseUrl: options.footprintBaseUrl ?? "footprints"}
    );

    return createBoardRenderModel({
      project,
      footprintLibrary,
      mirrorBottom: options.mirrorBottom,
    });
  },
};

export function createBoardRenderModel(
  options: BoardRenderModelOptions
): BoardRenderModel {
  const mirrorBottom = options.mirrorBottom !== false;
  const model = createBoardViewerModel({...options, mirrorBottom});
  const processColors = {...defaultBoardProcessColors, ...options.processColors};

  return {
    ...model,
    mirrorBottom,
    artwork: {
      sideSvgs: {
        top: renderBoardSideSvg(options.project, "top", processColors, mirrorBottom),
        bottom: renderBoardSideSvg(options.project, "bottom", processColors, mirrorBottom),
      },
    },
  };
}

function renderBoardSideSvg(
  project: BomBoardProjectIR,
  side: BoardViewerSide,
  colors: BoardProcessColors,
  mirrorBottom: boolean
): string {
  const viewBox = project.board.viewBox;
  const [x, y, width, height] = viewBox;
  const copper = layerFragments(project, side, layer => layer.geometrySource === "padMaster" || layer.geometrySource === "copper");
  const solderMask = layerFragments(project, side, layer => layer.geometrySource === "solderMask");
  const silkscreen = layerFragments(project, side, layer => layer.function === "silkscreen");
  const drill = drillFragment(project.board.artwork.drillHits);
  const viaCovers = viaCoverFragment(project.board.artwork.vias);
  const ids = svgIds(`bomboard-${side}`);
  const shape = boardShapeFragment(project, side);
  const clipPath = shape ? ` clip-path="url(#${ids.clip})"` : "";
  const sideTransform =
    side === "bottom" && mirrorBottom
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

function boardShapeFragment(project: BomBoardProjectIR, side: BoardViewerSide): string {
  return project.board.artwork.layers.find(layer => (
    layer.layerId === "board-shape" && layer.side === side
  ))?.primitives.map(artworkPrimitiveSvg).join("") ?? "";
}

function layerFragments(
  project: BomBoardProjectIR,
  side: BoardViewerSide,
  predicate: (layer: BomBoardProjectIR["board"]["artwork"]["layers"][number]) => boolean
): string {
  return project.board.artwork.layers
    .filter(layer => layer.side === side && predicate(layer))
    .map(layer => layer.primitives.map(artworkPrimitiveSvg).join(""))
    .join("");
}

function artworkPrimitiveSvg(primitive: BoardArtworkPrimitiveIR): string {
  const style = artworkStyleAttributes(primitive);

  switch (primitive.kind) {
    case "circle":
      return `<circle cx="${formatNumber(primitive.center.x)}" cy="${formatNumber(primitive.center.y)}" r="${formatNumber(primitive.radius)}"${style}></circle>`;
    case "path":
      return `<path d="${escapeAttribute(primitive.data)}"${style}></path>`;
    case "polygon":
      return `<polygon points="${pointsAttribute(primitive.points)}"${style}></polygon>`;
    case "polyline":
      return `<polyline points="${pointsAttribute(primitive.points)}"${style}></polyline>`;
    case "rect":
      return `<rect x="${formatNumber(primitive.x)}" y="${formatNumber(primitive.y)}" width="${formatNumber(primitive.width)}" height="${formatNumber(primitive.height)}"${optionalNumberAttribute("rx", primitive.radiusX)}${optionalNumberAttribute("ry", primitive.radiusY)}${style}></rect>`;
  }
}

function artworkStyleAttributes(primitive: BoardArtworkPrimitiveIR): string {
  const style = primitive.style;
  if (!style) return "";

  return [
    style.fill === "none" ? ' fill="none"' : "",
    style.stroke === "none" ? ' stroke="none"' : "",
    style.strokeWidth !== undefined ? ` stroke-width="${formatNumber(style.strokeWidth)}"` : "",
  ].join("");
}

function pointsAttribute(points: readonly {x: number; y: number}[]): string {
  return points.map(point => `${formatNumber(point.x)},${formatNumber(point.y)}`).join(" ");
}

function optionalNumberAttribute(name: string, value: number | undefined): string {
  return value !== undefined ? ` ${name}="${formatNumber(value)}"` : "";
}

function drillFragment(hits: readonly DrillHitIR[]): string {
  if (hits.length === 0) return "";

  return `<g>${hits
    .map(hit => {
      const radius = Math.max(hit.diameter / 2, 0.04);
      return `<circle cx="${formatNumber(hit.position.x)}" cy="${formatNumber(hit.position.y)}" r="${formatNumber(radius)}"/>`;
    })
    .join("")}</g>`;
}

function viaCoverFragment(vias: readonly ViaIR[]): string {
  if (vias.length === 0) return "";

  return `<g>${vias
    .map(via => {
      const radius = Math.max(via.padDiameter / 2, via.holeDiameter / 2);
      return `<circle cx="${formatNumber(via.position.x)}" cy="${formatNumber(via.position.y)}" r="${formatNumber(radius)}"/>`;
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

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
