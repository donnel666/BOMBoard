import type {BoardViewerColors} from "./types.js";

export const defaultBoardViewerColors: BoardViewerColors = {
  background: "#0b1110",
  dimOverlay: "#050706",
  componentFill: "#e8eef2",
  componentStroke: "#6f7d86",
  hoverStroke: "#e9f7ff",
  similarFill: "#ffd35c",
  similarStroke: "#fff1a8",
  selectedFill: "#ff8a4c",
  selectedStroke: "#ffffff",
};

export function colorToHexNumber(color: string): number {
  const normalized = color.trim().replace(/^#/, "");

  if (/^[0-9a-f]{3}$/i.test(normalized)) {
    return Number.parseInt(
      normalized
        .split("")
        .map(character => `${character}${character}`)
        .join(""),
      16
    );
  }

  if (/^[0-9a-f]{6}$/i.test(normalized)) {
    return Number.parseInt(normalized, 16);
  }

  return 0xffffff;
}
