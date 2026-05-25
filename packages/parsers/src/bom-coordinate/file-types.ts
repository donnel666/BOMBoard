import type {BomCoordinateFileClassification, BomCoordinateFileKind} from "./types.js";

export function classifyBomCoordinateFileName(fileName: string): BomCoordinateFileClassification {
  const name = baseName(fileName);
  const lowerName = name.toLowerCase();
  const extension = getExtension(lowerName);

  if (extension !== ".csv") {
    return classification(name, extension, "unknown", "not a CSV BOM/coordinate candidate");
  }

  if (lowerName.includes("bom")) {
    return classification(name, extension, "bom", "BOM CSV filename");
  }

  if (
    lowerName.includes("pickplace") ||
    lowerName.includes("pick-place") ||
    lowerName.includes("pick_places") ||
    lowerName.includes("placement") ||
    lowerName.includes("coordinate") ||
    lowerName.includes("coords")
  ) {
    return classification(name, extension, "coordinates", "coordinate/pick-place CSV filename");
  }

  return classification(name, extension, "unknown", "unrecognized CSV filename");
}

function baseName(pathOrName: string): string {
  return pathOrName.split(/[\\/]/).pop() ?? pathOrName;
}

function getExtension(lowerName: string): string {
  const index = lowerName.lastIndexOf(".");
  return index === -1 ? "" : lowerName.slice(index);
}

function classification(
  name: string,
  extension: string,
  kind: BomCoordinateFileKind,
  reason: string
): BomCoordinateFileClassification {
  return {name, extension, kind, reason};
}
