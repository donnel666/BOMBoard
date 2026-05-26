# BOMBoard

English | [中文](./README.zh-CN.md)

BOMBoard is an open source 2D PCB review tool for cross-probing between board manufacturing data and BOM data.

The web app runs locally in the browser. It loads a ZIP package or a local directory, validates the project files, renders the PCB from Gerber and drill data, and links the board view with BOM and coordinate data. Project data is kept in browser storage so a refresh can restore the current workspace until the project is closed manually.

## Features

- Local ZIP package or directory loading. No server upload is required.
- Gerber and Excellon drill rendering.
- BOM CSV/XLSX and coordinate CSV/XLSX parsing.
- Cross-probing between the board view and component list.
- BOM fuzzy search by designator, package, and component name.
- BOM sorting optimized for common SMD resistors, capacitors, and inductors.
- Browser-language based Chinese and English UI.
- Open source under GPL-3.0.

## Project Links

- GitHub: <https://github.com/donnel666/BOMBoard>
- QQ group: [2163055552](https://qm.qq.com/q/iBHcSKY3wk)
- License: [GNU General Public License v3.0](./LICENSE)

## Quick Tutorial

Place the tutorial screenshots in `docs/images/` with the file names shown below. Recommended screenshot size: 1440x900 or wider. Keep the same file names when replacing the images.

### 1. Open BOMBoard

Open BOMBoard in the browser. The first screen prompts you to select a local ZIP package or directory. No upload is required; all files are loaded locally in the browser.

![Open the BOMBoard website](./docs/images/01-open-project.png)

### 2. Load a Project

Select a ZIP package or directory that includes complete Gerber files, Excellon drill files, a coordinate CSV/XLSX file, and a BOM CSV/XLSX file. After validation, BOMBoard renders the PCB and lists the BOM components. The project name is shown at the top center of the viewer.

![BOMBoard project loaded without highlights](./docs/images/02-project-loaded.png)


### 3. Review Components by Side

Use the `Top` and `Bottom` controls to switch board sides. When the search box is empty, the BOM list follows the current board side. Search by designator, package, or component name when you need to locate parts quickly. Search results include both top and bottom components, and results from the other side are marked with a side label.

### 4. Highlight a Matching Component Group

Click the package/name area in the BOM to highlight the matching component group. This is useful for reviewing all components with the same identity on the current board side.

![Highlight all components in BOMBoard](./docs/images/03-highlight-all-components.png)

### 5. Highlight One Designator

Click a single designator in the BOM, or click a component directly in the 2D viewer, to highlight only that component. The BOM list scrolls to the selected component automatically. If a search result is on the other board side, clicking it switches the viewer to that side and selects the component.

![Highlight one designator in BOMBoard](./docs/images/04-highlight-designator.png)

### 6. Clear or Restore the Workspace

Click the selected BOM item again, or click empty space in the viewer, to clear the selection. Refreshing the browser restores the current workspace from local browser storage. Use the `X` button beside the side switch to close the project and clear the saved workspace.

## Requirements

- Node.js 22 or newer
- pnpm 10 or newer

## Development

```bash
pnpm install
pnpm dev:web
```

## Verification

```bash
pnpm build
pnpm typecheck
pnpm test
```
