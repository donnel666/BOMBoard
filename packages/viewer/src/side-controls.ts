import type {BoardViewerSide} from "./types.js";

export interface SideControls {
  element: HTMLDivElement;
  update(side: BoardViewerSide): void;
  destroy(): void;
}

export function createSideControls(
  container: HTMLElement,
  activeSide: BoardViewerSide,
  onSideChange: (side: BoardViewerSide) => void
): SideControls {
  const element = document.createElement("div");
  const topButton = createButton("Top", "Show top side");
  const bottomButton = createButton("Bottom", "Show bottom side");

  Object.assign(element.style, {
    position: "absolute",
    top: "12px",
    right: "12px",
    zIndex: "2",
    display: "inline-flex",
    gap: "4px",
    padding: "4px",
    border: "1px solid rgba(255,255,255,0.18)",
    borderRadius: "8px",
    background: "rgba(8, 14, 13, 0.78)",
    boxShadow: "0 8px 24px rgba(0,0,0,0.24)",
    backdropFilter: "blur(8px)",
  });

  topButton.addEventListener("click", () => onSideChange("top"));
  bottomButton.addEventListener("click", () => onSideChange("bottom"));
  element.append(topButton, bottomButton);
  container.appendChild(element);

  const update = (side: BoardViewerSide): void => {
    styleButton(topButton, side === "top");
    styleButton(bottomButton, side === "bottom");
  };

  update(activeSide);

  return {
    element,
    update,
    destroy() {
      element.remove();
    },
  };
}

function createButton(label: string, title: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.title = title;

  Object.assign(button.style, {
    minWidth: "56px",
    height: "32px",
    padding: "0 12px",
    border: "0",
    borderRadius: "6px",
    font: "600 13px/1 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    letterSpacing: "0",
    cursor: "pointer",
  });

  return button;
}

function styleButton(button: HTMLButtonElement, active: boolean): void {
  button.setAttribute("aria-pressed", active ? "true" : "false");
  button.style.background = active ? "#f4c64f" : "transparent";
  button.style.color = active ? "#141008" : "#f4f0e6";
}
