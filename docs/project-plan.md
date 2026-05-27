# BOMBoard Project Plan

## 1. Project Goal

Build a 2D PCB review tool for patch workers, maintenance workers, and similar operators.

The product must:

- Display PCB manufacturing data on the left side, including board outline, copper-related layers, pads, drill data, silkscreen, and similar board features.
- Display the BOM list on the right side.
- Support cross-probing between BOM items and board features.
- Run as both:
  - a web application
  - a desktop application packaged with Electron
- Use one shared frontend codebase.

This is a **2D project**, not a 3D project.

## 2. Hard Product Rules

These rules are fixed and should drive all design and implementation decisions.

### 2.1 Required Input Set

The minimum valid project input is:

- Gerber files
- Drill file
- Coordinate file
- BOM file

Supported coordinate files may be labeled as:

- XY
- CPL
- POS
- Pick-and-Place
- Centroid

If the coordinate file is missing, the project **cannot** support component mapping and should be rejected during import.

There is no heuristic fallback mode in the initial product design.

### 2.2 Single Codebase Rule

There must not be two separate implementations for web and desktop.

The desktop version is only a packaging shell around the same frontend application.

### 2.3 Local Processing Rule

All parsing, matching, and rendering logic should run locally in the frontend runtime:

- In the browser for the web version
- Inside the renderer process for the Electron version

This supports data-security-sensitive users who do not want to upload manufacturing data to a remote service.

## 3. Recommended Technology Stack

### 3.1 Core Stack

- **Runtime:** Node.js
- **Package manager / workspace:** pnpm
- **Language:** TypeScript
- **Web app:** React + Vite
- **Desktop shell:** Electron
- **Rendering:** PixiJS

### 3.2 Supporting Libraries

- **Viewport controls:** `pixi-viewport`
- **BOM table:** `@tanstack/react-table`
- **CSV/TXT parsing:** `papaparse`
- **Excel parsing:** `sheetjs` / `xlsx`
- **ZIP handling:** `fflate`
- **Spatial indexing / hit testing:** `flatbush` or `rbush`
- **Background parsing:** Web Workers

### 3.3 Gerber Handling

Initial pure-frontend evaluation target:

- `@tracespace/parser`
- `@tracespace/identify-layers`
- `@tracespace/plotter`
- `@tracespace/renderer`

Important note:

- Gerber support must be isolated behind an internal adapter layer.
- Do not let the rest of the application depend directly on a single Gerber library API.
- If the first Gerber library proves insufficient for real customer files, only the adapter layer should change.

## 4. Architecture Decision

The correct architecture is:

- one shared frontend application
- one shared domain/data-processing layer
- one shared rendering layer
- one desktop wrapper using Electron

The desktop version is not a separate product. It is the same application loaded in a desktop shell.

### 4.1 Monorepo Structure

Recommended structure:

```text
BOMBoard/
  apps/
    web/
    desktop-electron/
    desktop-tauri/
  packages/
    core/
    parsers/
    viewer/
    ui/
  docs/
```

### `apps/web`

Contains the browser application built with React and Vite.

### `apps/desktop-electron`

Contains Electron-specific code for the Chromium-bundled desktop build:

- `main` process
- `preload` bridge
- packaging configuration

This app should load the same shared frontend code used by the web application.

### `apps/desktop-tauri`

Contains Tauri-specific code for the Windows WebView2 desktop build.

### `packages/core`

Contains shared business logic:

- TypeScript domain models
- file normalization
- BOM/XY/Gerber matching
- coordinate normalization
- geometry helpers
- validation rules

### `packages/parsers`

Contains import adapters for:

- BOM
- coordinate file
- Gerber
- drill file

### `packages/viewer`

Contains the PixiJS board viewer:

- layer rendering
- component overlays
- selection state
- highlight logic
- hit testing
- pan/zoom behavior

### `packages/ui`

Contains shared React UI pieces if needed:

- table wrappers
- import panels
- validation report components
- search controls

## 5. Input Contract

The application should standardize around the following file categories.

### 5.1 Required Files

### Gerber

Board manufacturing layers, including as available:

- top copper
- bottom copper
- solder mask
- silkscreen
- paste
- board outline / profile
- internal layers if present

### Drill

Excellon drill data, including:

- plated holes
- non-plated holes

### Coordinate File

Must provide enough information to locate components on the board.

Required normalized fields:

- `refdes`
- `x`
- `y`
- `side`

Preferred additional fields:

- `rotation`
- `package`
- `description`

### BOM

Required normalized fields:

- `refdes[]`
- `value`
- `qty`

Preferred additional fields:

- `package`
- `mpn`
- `manufacturer`
- `description`
- `supplier`

### 5.2 Import Validation Rules

Import must fail or block entry into the viewer when:

- coordinate file is missing
- BOM is missing usable `RefDes`
- coordinate file is missing usable `RefDes`
- coordinate file is missing usable `X` or `Y`
- Gerber set cannot be identified as a valid board dataset

Import should show a validation report when:

- BOM and coordinate file contain unmatched `RefDes`
- units are ambiguous
- side values are inconsistent
- duplicate `RefDes` exist
- the board outline cannot be identified cleanly

## 6. Internal Data Model

All source files should be normalized into a stable internal model before rendering.

### 6.1 Suggested TypeScript Models

```ts
export type BoardSide = "top" | "bottom";

export type BoardFeatureKind =
  | "pad"
  | "track"
  | "region"
  | "hole"
  | "slot"
  | "silk"
  | "mask"
  | "paste"
  | "outline";

export interface BomItem {
  id: string;
  refdes: string[];
  value: string | null;
  package: string | null;
  mpn: string | null;
  manufacturer: string | null;
  description: string | null;
  qty: number | null;
}

export interface Placement {
  refdes: string;
  x: number;
  y: number;
  rotation: number;
  side: BoardSide;
  package: string | null;
}

export interface BoardFeature {
  id: string;
  layer: string;
  kind: BoardFeatureKind;
  side: BoardSide | null;
  geometry: unknown;
}

export interface ComponentInstance {
  refdes: string;
  bomItemId: string | null;
  x: number;
  y: number;
  rotation: number;
  side: BoardSide;
  package: string | null;
  featureIds: string[];
}

export interface ProjectFileSet {
  gerbers: File[];
  drill: File[];
  placements: File[];
  bom: File[];
}
```

The exact types can evolve, but the product should keep this architectural separation:

- raw imported files
- normalized parsed records
- joined component model
- renderable board model

## 7. Data Join Strategy

The primary join is:

- `BOM.RefDes <-> Placement.RefDes`

That gives the component identity and location.

The secondary join is:

- `Placement <-> board features`

That associates a component location with nearby pads and footprint geometry on the rendered board.

This structure enables the required product interactions.

### 7.1 Forward Cross-Probing

When the user clicks a BOM row:

1. Expand the row into one or more `RefDes`.
2. Resolve matching placements.
3. Highlight all matching component positions on the board.
4. Highlight the related footprint/pad region for each matching placement.
5. Zoom or center on the selected result when appropriate.

### 7.2 Reverse Cross-Probing

When the user clicks a board feature or footprint region:

1. Hit-test the clicked geometry.
2. Resolve the owning component instance.
3. Find the related BOM item.
4. Scroll and highlight the BOM row.
5. Highlight all same-part or same-selection components when required by the UI mode.

## 8. Normalization Requirements

The major engineering difficulty is not the UI framework. It is normalization.

The following must be handled explicitly in shared code:

- unit normalization
  - `mm`
  - `mil`
  - `inch`
- coordinate origin differences
- top/bottom side normalization
- bottom-side mirroring
- rotation convention normalization
- `RefDes` cleanup and case normalization
- `RefDes` range expansion such as `R1-R4,R8`
- duplicate or conflicting placement rows

This work belongs in `packages/core`, not scattered across UI components.

## 9. Rendering Model

The product is a 2D board viewer.

Recommended rendering behavior:

- use PixiJS for the main board viewport
- keep board rendering separate from DOM-based UI panels
- use a spatial index for fast hit-testing
- keep layer visibility controllable
- render component overlays as a separate layer from raw Gerber geometry

Suggested visual layers:

- board outline
- copper
- solder mask
- silkscreen
- drill holes
- pads / pad overlays
- component highlight overlays
- selection markers

## 10. Worker Strategy

To keep the UI responsive, expensive operations should run in Web Workers:

- ZIP extraction
- Gerber parsing
- drill parsing
- BOM parsing
- coordinate parsing
- normalization
- geometry indexing

The UI thread should be responsible for:

- user interaction
- table rendering
- viewport control
- selection state
- final rendering commands

This worker strategy should be shared between the web app and the Electron renderer.

## 11. Product Features for the First Version

The first release should focus on deterministic, production-relevant workflows.

### 11.1 Core Features

- import Gerber + drill + coordinate + BOM files
- validate the file set before opening the viewer
- render the board in 2D
- display the BOM list
- select BOM rows and highlight board components
- click board components and locate the BOM row
- search by `RefDes`, value, package, or MPN
- filter by side
- toggle board layers
- zoom, pan, and fit-to-view

### 11.2 Nice-to-Have Features After MVP

- multi-select components
- highlight all identical parts
- import preset templates for common BOM/XY formats
- remember column mapping rules
- recent file sets in the desktop version
- offline-first desktop mode

## 12. Delivery Phases

### Phase 1: Foundation

Goal:

- Establish the monorepo and package boundaries.

Tasks:

- initialize pnpm workspace
- create `apps/web`
- create `apps/desktop-electron`
- create `apps/desktop-tauri`
- create `packages/core`
- create `packages/parsers`
- create `packages/viewer`
- create `packages/ui`
- configure shared TypeScript settings

Verification:

- workspace installs cleanly
- web app runs
- Electron shell launches the shared frontend

### Phase 2: Input Pipeline

Goal:

- Import and normalize BOM and coordinate files reliably.

Tasks:

- implement BOM CSV/XLSX parsing
- implement coordinate CSV/TXT parsing
- add column mapping and normalization
- add strict validation
- add import report UI

Verification:

- sample BOMs parse into normalized records
- sample XY files parse into normalized placements
- `RefDes` joins work across real samples

### Phase 3: Board Parsing and Rendering

Goal:

- Render valid board datasets in a 2D viewer.

Tasks:

- implement Gerber adapter
- implement drill adapter
- identify layers
- convert board data into renderable geometry
- build PixiJS viewport
- add layer toggles and fit-to-view

Verification:

- multiple real board datasets render correctly
- pan/zoom remains smooth
- visible layers match expectations

### Phase 4: Cross-Probing

Goal:

- Link BOM and board interactions.

Tasks:

- build joined component model
- create component overlay layer
- implement BOM-to-board highlighting
- implement board-to-BOM reverse lookup
- add same-part highlighting behavior

Verification:

- clicking BOM rows highlights expected placements
- clicking board components locates the correct BOM row
- performance remains acceptable with realistic board sizes

### Phase 5: Desktop Packaging

Goal:

- Deliver the same application as a local desktop product.

Tasks:

- wire Electron main/preload
- load the shared frontend
- add local file-open support
- package installers

Verification:

- desktop build runs offline
- local file import works
- behavior matches the web version

### Phase 6: Hardening

Goal:

- Make the product production-ready for real operator use.

Tasks:

- add import templates for common customer formats
- improve validation error clarity
- add performance profiling
- test large boards and large BOMs
- stabilize layer mapping and coordinate normalization

Verification:

- test suite passes
- sample-project regression set passes
- large-file interaction remains usable

## 13. Testing Strategy

Testing should focus on data correctness first.

### Unit Tests

- `RefDes` normalization
- `RefDes` range expansion
- unit conversion
- rotation normalization
- side normalization
- BOM/XY join behavior

### Integration Tests

- import BOM + XY + Gerber + drill sample sets
- validate component linking
- validate selection and reverse lookup

### Regression Fixtures

Create a fixture library of real customer-like projects:

- simple single-side boards
- double-side boards
- boards with dense passive populations
- projects with awkward BOM column names
- projects with awkward coordinate exports

## 14. Risks and Mitigations

### Risk 1: Gerber library limitations

Risk:

- The first browser-native Gerber library may not handle all real-world files well enough.

Mitigation:

- isolate Gerber handling behind an adapter
- maintain fixture-based validation
- swap parser implementation only inside `packages/parsers`

### Risk 2: Coordinate normalization differences

Risk:

- Different CAD/CAM exports will use different origins, units, and side conventions.

Mitigation:

- centralize normalization logic
- add import-time validation and preview
- support importer presets per vendor format

### Risk 3: Performance on large boards

Risk:

- Large Gerber datasets may affect responsiveness.

Mitigation:

- move parsing to workers
- spatially index geometry
- separate static board rendering from dynamic selection overlays

## 15. Final Recommendation

The project should proceed with the following decisions fixed:

- This is a **2D** product.
- The required input set is **Gerber + drill + coordinate file + BOM**.
- There is **no support** for component mapping without the coordinate file.
- The application should use **one shared frontend codebase**.
- The web version and Electron desktop version must reuse the same parsing, matching, and rendering logic.
- The recommended stack is **Node.js + pnpm + React + Vite + TypeScript + Electron + PixiJS**.

This keeps the product aligned with mainstream PCB manufacturing data flows while avoiding two independent implementations.
