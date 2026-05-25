export const parsersPackageName = "@bomboard/parsers";

export {
  classifyGerber2DFileName,
  gerber2DFileTypePriorities,
  selectGerber2DFiles,
} from "./gerber/file-types.js";
export {parseExcellonDrill} from "./gerber/excellon-parser.js";
export {parseViaInfoCsv} from "./gerber/via-info-parser.js";
export {parseGerber2DProject} from "./gerber/tracespace-adapter.js";
export {
  defaultGerber2DProcessColors,
  renderGerber2DLayerSvg,
  renderGerber2DReviewSvgs,
  renderGerber2DSideSvg,
} from "./gerber/svg-renderer.js";

export type {
  BoardSide,
  DrillHit,
  Gerber2DFileClassification,
  Gerber2DFileKind,
  Gerber2DFileTypePriority,
  Gerber2DInputFile,
  ParsedExcellonDrill,
  ViaInfoRecord,
  ViewBox,
} from "./gerber/types.js";
export type {Gerber2DProject} from "./gerber/tracespace-adapter.js";
export type {
  Gerber2DProcessColors,
  Gerber2DRenderOptions,
} from "./gerber/svg-renderer.js";
