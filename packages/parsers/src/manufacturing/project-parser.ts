import {
  BomBoardImportError,
  type BomBoardImportErrorCode,
  type ProjectImportFile,
  type ProjectImportInput,
  type ProjectParser,
  type ProjectParserProbe,
  type ProjectParseOptions,
} from "@bomboard/core";
import {classifyBomCoordinateFile} from "../bom-coordinate/file-types.js";
import type {BomCoordinateInput} from "../bom-coordinate/types.js";
import {selectGerber2DFiles} from "../gerber/file-types.js";
import type {Gerber2DInputFile} from "../gerber/types.js";
import {parseManufacturingProject} from "./project-ir.js";

export const manufacturingProjectParser: ProjectParser = {
  id: "manufacturing-files",
  displayName: "Manufacturing files",
  probe(input: ProjectImportInput): ProjectParserProbe {
    if (input.files.length === 0) {
      return unsupported("No readable files were provided.");
    }

    const bomFile = selectBomCoordinateFile(input.files, "bom");
    const coordinateFile = selectBomCoordinateFile(input.files, "coordinates");
    const gerbers = gerberCandidatesForInput(input.files, bomFile, coordinateFile);
    const gerberSelection = selectGerber2DFiles(gerbers);
    const complete = bomFile
      && coordinateFile
      && gerberSelection.tracespaceFiles.length > 0
      && gerberSelection.drillFiles.length > 0;
    const hasManufacturingSignal = Boolean(
      bomFile
      || coordinateFile
      || gerberSelection.tracespaceFiles.length > 0
      || gerberSelection.drillFiles.length > 0
      || gerberSelection.viaInfoFiles.length > 0
    );

    if (!hasManufacturingSignal) {
      return unsupported("No manufacturing file signatures were identified.");
    }

    return {
      supported: true,
      confidence: complete ? 0.95 : 0.25,
      formatId: "manufacturing-files",
      reason: complete
        ? "Gerber, drill, BOM, and coordinate files were identified."
        : "Some manufacturing inputs are missing; parse will return a specific import error.",
    };
  },
  async parse(
    input: ProjectImportInput,
    options: ProjectParseOptions = {}
  ) {
    if (input.files.length === 0) {
      throw importError("missing-readable-files", "No readable files were provided.");
    }

    const bomFile = selectBomCoordinateFile(input.files, "bom");
    if (!bomFile) {
      throw importError("missing-bom-file", "No BOM file could be identified.");
    }

    const coordinateFile = selectBomCoordinateFile(input.files, "coordinates");
    if (!coordinateFile) {
      throw importError("missing-coordinate-file", "No coordinate file could be identified.");
    }

    const gerbers = gerberCandidatesForInput(input.files, bomFile, coordinateFile);
    const gerberSelection = selectGerber2DFiles(gerbers);

    if (gerberSelection.tracespaceFiles.length === 0) {
      throw importError("missing-gerber-files", "No renderable Gerber files could be identified.");
    }

    if (gerberSelection.drillFiles.length === 0) {
      throw importError("missing-drill-file", "No drill file could be identified.");
    }

    const project = await parseManufacturingProject({
      sourceName: input.sourceName,
      bom: toBomCoordinateInput(bomFile),
      coordinates: toBomCoordinateInput(coordinateFile),
      gerbers,
      createdAt: options.createdAt ?? input.createdAt,
    });

    if (project.bom.items.every(item => item.refs.length === 0)) {
      throw importError("empty-bom-designators", "The BOM does not contain usable designators.");
    }

    if (!project.components.some(component => component.placement)) {
      throw importError("empty-coordinate-placements", "The coordinate file does not contain usable placements.");
    }

    return project;
  },
};

function selectBomCoordinateFile(
  files: readonly ProjectImportFile[],
  kind: "bom" | "coordinates"
): ProjectImportFile | null {
  const matches = files
    .filter(file => classifyBomCoordinateFile(toBomCoordinateInput(file)).kind === kind)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }));

  return matches[0] ?? null;
}

function toBomCoordinateInput(file: ProjectImportFile): BomCoordinateInput {
  return {
    name: file.name,
    bytes: file.bytes,
  };
}

function toGerberInputFile(file: ProjectImportFile): Gerber2DInputFile {
  const name = baseName(file.name);
  const text = new TextDecoder("utf-8").decode(file.bytes);
  if (file.path) {
    return {
      name: file.name,
      path: file.path,
      text,
    };
  }

  const sourceFile = nativeFile(file) ?? createTextFile(name, file.bytes);

  return {
    name: file.name,
    text,
    ...(sourceFile ? {file: sourceFile} : {}),
  };
}

function gerberCandidatesForInput(
  files: readonly ProjectImportFile[],
  bomFile: ProjectImportFile | null,
  coordinateFile: ProjectImportFile | null
): Gerber2DInputFile[] {
  return files
    .filter(file => file !== bomFile && file !== coordinateFile)
    .map(toGerberInputFile);
}

function nativeFile(file: ProjectImportFile): File | null {
  if (typeof File === "undefined") return null;
  const value = file.file;
  return typeof value === "object" && value !== null && value instanceof File ? value : null;
}

function createTextFile(name: string, bytes: Uint8Array): File | null {
  if (typeof File === "undefined") return null;

  return new File(
    [new Blob([copyBytes(bytes)], {type: "text/plain"})],
    name,
    {type: "text/plain"}
  );
}

function importError(code: BomBoardImportErrorCode, message: string): BomBoardImportError {
  return new BomBoardImportError(code, message);
}

function unsupported(reason: string): ProjectParserProbe {
  return {
    supported: false,
    confidence: 0,
    formatId: null,
    reason,
  };
}

function baseName(pathOrName: string): string {
  return pathOrName.split(/[\\/]/).pop() ?? pathOrName;
}

function copyBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
