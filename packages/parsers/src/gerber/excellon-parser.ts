import type {DrillHit, ParsedExcellonDrill} from "./types.js";

type Unit = "inch" | "mm";
type PaddingMode = "left" | "right";

interface ExcellonState {
  unit: Unit;
  integerDigits: number;
  decimalDigits: number;
  paddingMode: PaddingMode;
  plated: boolean | null;
  currentTool: string | null;
  currentX: number | null;
  currentY: number | null;
}

export function parseExcellonDrill(
  text: string,
  fileName = "drill"
): ParsedExcellonDrill {
  const state: ExcellonState = {
    unit: "inch",
    integerDigits: 2,
    decimalDigits: 5,
    paddingMode: "right",
    plated: null,
    currentTool: null,
    currentX: null,
    currentY: null,
  };
  const toolDiametersMm: Record<string, number> = {};
  const hits: DrillHit[] = [];
  const warnings: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const fileFormat = /^;FILE_FORMAT=(\d+):(\d+)/i.exec(line);
    if (fileFormat) {
      state.integerDigits = Number(fileFormat[1]);
      state.decimalDigits = Number(fileFormat[2]);
      continue;
    }

    if (/^(INCH|METRIC)/i.test(line)) {
      state.unit = line.toUpperCase().startsWith("METRIC") ? "mm" : "inch";
      state.paddingMode = line.toUpperCase().includes("TZ") ? "left" : "right";
      continue;
    }

    if (/^;TYPE=PLATED/i.test(line)) {
      state.plated = true;
      continue;
    }

    if (/^;TYPE=NON_PLATED/i.test(line)) {
      state.plated = false;
      continue;
    }

    const toolDeclaration = /^T0?(\d+).*C([+-]?\d*\.?\d+)/i.exec(line);
    if (toolDeclaration) {
      const tool = `T${Number(toolDeclaration[1])}`;
      toolDiametersMm[tool] = toMillimeters(Number(toolDeclaration[2]), state.unit);
      continue;
    }

    const toolSelection = /^T0?(\d+)$/i.exec(line);
    if (toolSelection) {
      state.currentTool = `T${Number(toolSelection[1])}`;
      continue;
    }

    if (!/[XY]/i.test(line)) continue;

    const xMatch = /X([+-]?\d*\.?\d+)/i.exec(line);
    const yMatch = /Y([+-]?\d*\.?\d+)/i.exec(line);

    if (xMatch) state.currentX = parseCoordinate(xMatch[1], state);
    if (yMatch) state.currentY = parseCoordinate(yMatch[1], state);

    if (state.currentX === null || state.currentY === null) continue;

    const tool = state.currentTool ?? "T0";
    const diameterMm = toolDiametersMm[tool] ?? 0;
    if (diameterMm === 0) {
      warnings.push(`Missing drill diameter for ${tool} at ${state.currentX},${state.currentY}`);
    }

    hits.push({
      xMm: state.currentX,
      yMm: state.currentY,
      diameterMm,
      tool,
      plated: state.plated,
    });
  }

  return {fileName, hits, toolDiametersMm, warnings};
}

function parseCoordinate(raw: string, state: ExcellonState): number {
  if (raw.includes(".")) return toMillimeters(Number(raw), state.unit);

  const sign = raw.startsWith("-") ? -1 : 1;
  const digits = raw.replace(/^[+-]/, "");
  const totalDigits = state.integerDigits + state.decimalDigits;
  const padded =
    state.paddingMode === "right"
      ? digits.padEnd(totalDigits, "0")
      : digits.padStart(totalDigits, "0");
  const integerPart = padded.slice(0, state.integerDigits) || "0";
  const decimalPart = padded.slice(state.integerDigits) || "0";
  const value = sign * Number(`${integerPart}.${decimalPart}`);

  return toMillimeters(value, state.unit);
}

function toMillimeters(value: number, unit: Unit): number {
  return unit === "inch" ? value * 25.4 : value;
}
