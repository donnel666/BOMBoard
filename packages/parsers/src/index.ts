export const parsersPackageName = "@bomboard/parsers";

export {parseBomCsv} from "./bom-coordinate/bom-parser.js";
export {
  parseCoordinateCsv,
  parseLengthMm,
  parsePlacementSide,
} from "./bom-coordinate/coordinate-parser.js";
export {decodeBomCoordinateText} from "./bom-coordinate/csv.js";
export {
  classifyBomCoordinateFile,
  classifyBomCoordinateFileName,
} from "./bom-coordinate/file-types.js";
export {
  mergeBomAndCoordinates,
  parseBomCoordinateProject,
} from "./bom-coordinate/project-parser.js";
export {
  parseManufacturingProject,
} from "./manufacturing/project-ir.js";
export {
  manufacturingProjectParser,
} from "./manufacturing/project-parser.js";
export {
  classifyGerber2DFile,
  classifyGerber2DFileName,
  gerber2DFileTypePriorities,
  selectGerber2DFiles,
} from "./gerber/file-types.js";
export {parseExcellonDrill} from "./gerber/excellon-parser.js";
export {parseViaInfoCsv} from "./gerber/via-info-parser.js";
export {parseGerber2DProject} from "./gerber/tracespace-adapter.js";

export type {
  BomComponent,
  BomCoordinateComponent,
  BomCoordinateEncoding,
  BomCoordinateFileClassification,
  BomCoordinateFileKind,
  BomCoordinateInput,
  BomCoordinateParseOptions,
  BomCoordinateProjectInput,
  BomCoordinateTextInput,
  BomRecord,
  CoordinateRecord,
  ParsedBomCoordinateProject,
  ParsedBomCsv,
  ParsedCoordinateCsv,
  PlacementSide,
  PointMm,
} from "./bom-coordinate/types.js";
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
  ManufacturingProjectInput,
} from "./manufacturing/project-ir.js";
