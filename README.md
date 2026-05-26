# BOMBoard

English | [中文](./README.zh-CN.md)

BOMBoard is an open source 2D PCB review tool for cross-probing between board manufacturing data and BOM data.

The web app runs locally in the browser. It loads a ZIP package or a local directory, validates the project files, renders the PCB from Gerber and drill data, and links the board view with BOM and coordinate data. Project data is kept in browser storage so a refresh can restore the current workspace until the project is closed manually.

## Features

- Local ZIP package or directory loading. No server upload is required.
- Gerber and Excellon drill rendering.
- BOM CSV and coordinate CSV parsing.
- Cross-probing between the board view and component list.
- BOM fuzzy search by designator, package, and component name.
- BOM sorting optimized for common SMD resistors, capacitors, and inductors.
- Browser-language based Chinese and English UI.
- Open source under GPL-3.0.

## Project Links

- GitHub: <https://github.com/donnel666/BOMBoard>
- QQ group: [2163055552](https://qm.qq.com/q/iBHcSKY3wk)
- License: [GNU General Public License v3.0](./LICENSE)

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
