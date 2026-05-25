# BOMBoard

BOMBoard is a 2D PCB review tool for cross-probing between board manufacturing data and BOM data.

The repository is initialized as a single workspace with:

- a shared React + Vite frontend
- an Electron desktop shell
- placeholder shared packages for parsers, rendering, and core domain logic

No product functionality is implemented yet. This scaffold only establishes the project structure.

## Workspace

```text
BOMBoard/
  apps/
    web/
    desktop/
  packages/
    core/
    parsers/
    viewer/
    ui/
  docs/
```

## Tooling

- Node.js
- pnpm
- React
- Vite
- TypeScript
- Electron

## Commands

```bash
pnpm install
pnpm dev:web
pnpm dev:desktop
pnpm build
pnpm typecheck
```

## Documentation

- Project plan: [docs/project-plan.md](./docs/project-plan.md)
