# Gerber Parser Design

## 1. Purpose

The Gerber parser restores PCB graphics from manufacturing files so BOMBoard can render a 2D board view and support later component cross-probing.

The parser should extract graphic information first:

- board outline
- copper regions, tracks, flashes, and pads
- solder mask openings
- paste regions
- silkscreen and drawing graphics
- drill hits and slots
- mechanical/profile geometry

Non-graphic information should be ignored unless it affects parsing, classification, coordinate normalization, validation, or rendering.

## 2. Scope

### In Scope

- Gerber layer/image files using modern `.gbr` names or common legacy layer extensions such as `.gtl`, `.gbl`, `.gts`, `.gbs`, `.gto`, `.gtp`, `.gm`, and similar Altium-style files.
- Excellon/NC drill files, commonly exported as `.drl`, `.txt`, or `.xnc`.
- Gerber Job files (`.gbrjob`) as optional metadata for layer stack, board properties, and file relationships.
- ZIP-based project imports containing multiple board files.
- Layer classification through both formal attributes and legacy naming conventions.
- Conversion from parsed source commands into a stable internal geometry model.
- Rendering through a viewer-facing render model, not direct coupling to a specific Gerber library API.

### Out of Scope for the Initial Parser

- 3D board reconstruction.
- CAM editing, DFM correction, or Gerber export.
- Full electrical netlist extraction from copper geometry.
- Inferring component placement when the coordinate file is missing.
- Vendor-specific repair of severely malformed manufacturing data beyond clear validation errors.

## 3. Design Principles

- Keep one shared Gerber language parser. Gerber layer files use the same syntax even when filenames imply different layer types.
- Put file-type-specific behavior in classification, validation, render styling, and layer composition modules.
- Preserve source fidelity. Internal geometry should represent what the manufacturing data says, not what we assume the PCB should be.
- Normalize units and coordinates once before viewer consumption.
- Keep parser output independent from PixiJS so parsing can be tested without a renderer.
- Prefer spec attributes over filename conventions, but support real-world legacy exports.

## 4. Input Dataset Model

An imported board dataset is a collection of source files:

```ts
export interface GerberSourceFile {
  id: string;
  name: string;
  extension: string;
  bytes: Uint8Array;
  text?: string;
}

export interface BoardImportSet {
  gerberLayers: GerberSourceFile[];
  drillFiles: GerberSourceFile[];
  jobFiles: GerberSourceFile[];
  supportFiles: GerberSourceFile[];
}
```

The import stage should not assume that every file extension is standard. It should classify files by content first, then metadata, then extension.

## 5. File Discovery and Classification

### 5.1 Classification Order

Use the following priority:

1. Content signature:
   - Gerber: `%FS`, `%MO`, aperture definitions, Gerber commands, `G04` comments.
   - Excellon/NC drill: `M48`, tool table declarations such as `T01C...`, drill coordinates.
   - Gerber Job: valid JSON with Gerber job structure.
2. Formal Gerber attributes:
   - `TF.FileFunction`
   - `TF.FilePolarity`
   - `TF.SameCoordinates`
   - `TF.GenerationSoftware`
3. Sidecar metadata:
   - Altium extension reports such as `.extrep`
   - generation reports such as `.rep`
   - drill reports such as `.drr`
4. Legacy filename extension conventions.
5. User mapping in the import UI when classification is ambiguous.

### 5.2 Layer Function Model

```ts
export type BoardLayerKind =
  | "copper"
  | "solderMask"
  | "paste"
  | "legend"
  | "profile"
  | "drill"
  | "pads"
  | "mechanical"
  | "drawing"
  | "unknown";

export type BoardSide = "top" | "bottom" | "inner" | "both" | null;

export interface LayerIdentity {
  sourceFileId: string;
  kind: BoardLayerKind;
  side: BoardSide;
  copperIndex: number | null;
  name: string;
  polarity: "positive" | "negative" | null;
  confidence: "explicit" | "report" | "extension" | "user" | "unknown";
}
```

### 5.3 Legacy Extension Mapping

The parser should include a default extension map for common exports:

| Extension | Default classification |
| --- | --- |
| `.gtl` | top copper |
| `.gbl` | bottom copper |
| `.g1`, `.g2`, `.g3`, etc. | inner copper, index inferred from stack order or report |
| `.gts` | top solder mask |
| `.gbs` | bottom solder mask |
| `.gto` | top legend/silkscreen |
| `.gbo` | bottom legend/silkscreen |
| `.gtp` | top paste |
| `.gbp` | bottom paste |
| `.gm`, `.gko`, `.outline` | profile/board outline candidate |
| `.gpt`, `.gpb` | pad master layers |
| `.gd*`, `.gg*` | drill drawing or drill guide |
| `.gm*` | mechanical layer unless sidecar metadata says otherwise |
| `.drl`, `.xnc`, `.txt` | drill candidate, content must confirm |

The mapping is a fallback. Formal `TF.FileFunction` attributes and sidecar reports override it.

## 6. Parser Pipeline

```text
ZIP/files
  -> file discovery
  -> content decoding
  -> file classification
  -> Gerber/NC parsing
  -> geometry normalization
  -> layer-specific interpretation
  -> board composition
  -> render model
  -> viewer rendering
```

### 6.1 File Discovery

Responsibilities:

- Extract ZIPs.
- Deduplicate files by normalized name.
- Group sidecar reports with matching base names.
- Separate candidate Gerber, drill, job, and support files.
- Emit validation warnings for ignored files.

### 6.2 Gerber Syntax Parsing

Responsibilities:

- Parse comments, format statements, unit statements, aperture definitions, aperture macros, coordinate operations, region operations, interpolation modes, and step-and-repeat blocks.
- Maintain Gerber plot state:
  - unit
  - coordinate format
  - current point
  - interpolation mode
  - quadrant mode
  - selected aperture
  - region mode
  - polarity
  - transform/repeat state
- Convert commands into graphic elements.

The syntax parser should not care whether the file is top copper, solder mask, paste, or mechanical. It emits geometry with source metadata.

### 6.3 Drill Parsing

Responsibilities:

- Parse Excellon/XNC drill files.
- Read units and coordinate format.
- Parse tool declarations and selected tool state.
- Emit circular drill hits and routed slots/arcs.
- Mark plated/non-plated status when available from file comments, reports, or job metadata.

### 6.4 Geometry Normalization

Responsibilities:

- Convert all coordinates to millimeters.
- Preserve source coordinate precision.
- Compute bounds per file and per layer.
- Normalize arc and path representations.
- Preserve layer polarity so rendering can apply additive/subtractive composition correctly.

## 7. Internal Geometry Model

The parser should emit a small set of graphics primitives:

```ts
export type GraphicElement =
  | GraphicFlash
  | GraphicStroke
  | GraphicRegion
  | GraphicDrillHit
  | GraphicSlot;

export interface GraphicBase {
  id: string;
  sourceFileId: string;
  layerId: string;
  polarity: "dark" | "clear";
  bounds: Bounds;
}

export interface GraphicFlash extends GraphicBase {
  type: "flash";
  aperture: ApertureShape;
  x: number;
  y: number;
  rotation: number;
}

export interface GraphicStroke extends GraphicBase {
  type: "stroke";
  aperture: ApertureShape;
  path: PathSegment[];
}

export interface GraphicRegion extends GraphicBase {
  type: "region";
  contours: PathSegment[][];
}

export interface GraphicDrillHit extends GraphicBase {
  type: "drillHit";
  x: number;
  y: number;
  diameter: number;
  plated: boolean | null;
}

export interface GraphicSlot extends GraphicBase {
  type: "slot";
  path: PathSegment[];
  diameter: number;
  plated: boolean | null;
}
```

The model should avoid renderer-specific types. PixiJS conversion belongs in `packages/viewer`.

## 8. Layer-Type Modules

Each layer-type module consumes common parsed geometry and produces normalized board-layer data plus render hints.

```ts
export interface LayerModule {
  kind: BoardLayerKind;
  classify(input: ClassificationInput): LayerIdentity | null;
  validate(layer: ParsedLayer): LayerValidationMessage[];
  buildRenderLayer(layer: ParsedLayer): RenderLayerDescriptor;
}
```

Initial modules:

| Module | Input files | Main behavior |
| --- | --- | --- |
| `CopperLayerModule` | `.gtl`, `.gbl`, `.g1`, `.g2`, `FileFunction=Copper` | Preserve pads, tracks, fills, and copper ordering. |
| `SolderMaskLayerModule` | `.gts`, `.gbs`, `FileFunction=Soldermask` | Treat negative-polarity openings correctly. |
| `PasteLayerModule` | `.gtp`, `.gbp`, `FileFunction=Paste` | Render stencil/paste openings. |
| `LegendLayerModule` | `.gto`, `.gbo`, `FileFunction=Legend` | Render silkscreen/overlay graphics above mask/copper. |
| `ProfileLayerModule` | `.gm`, `.gko`, `FileFunction=Profile` | Identify board outline bounds and clipping path. |
| `DrillLayerModule` | Excellon, XNC, `FileFunction=Plated/NonPlated` | Render holes and slots, normalize plating metadata. |
| `PadMasterLayerModule` | `.gpt`, `.gpb`, `FileFunction=Pads` | Provide pad-only overlays when exported. |
| `DrawingLayerModule` | `.gd*`, `.gg*`, `FileFunction=Drillmap/FabricationDrawing` | Render optional documentation layers. |
| `MechanicalLayerModule` | `.gm*`, unknown mechanical files | Keep visible but mark as auxiliary until mapped. |

## 9. Board Composition

Board composition combines parsed layers into one renderable board model:

```ts
export interface ParsedBoard {
  layers: ParsedLayer[];
  outline: BoardOutline | null;
  bounds: Bounds;
  units: "mm";
  diagnostics: ImportDiagnostic[];
}

export interface ParsedLayer {
  id: string;
  identity: LayerIdentity;
  elements: GraphicElement[];
  bounds: Bounds;
  render: RenderLayerDescriptor;
}
```

Composition responsibilities:

- Choose the best outline/profile candidate.
- Determine copper layer ordering.
- Align all layers using the shared coordinate system.
- Flag layers with suspiciously different bounds or origins.
- Apply default display ordering:
  - profile
  - bottom copper
  - inner copper
  - top copper
  - solder mask
  - paste
  - legend
  - drill
  - mechanical/drawing overlays

## 10. Rendering Contract

The parser should not call PixiJS directly. It should return render descriptors:

```ts
export interface RenderLayerDescriptor {
  layerId: string;
  label: string;
  kind: BoardLayerKind;
  side: BoardSide;
  defaultVisible: boolean;
  defaultOpacity: number;
  zIndex: number;
  colorRole: BoardColorRole;
  compositeMode: "normal" | "mask" | "subtract";
}
```

The viewer converts `GraphicElement[]` to PixiJS graphics or cached meshes.

Rendering rules:

- Static board layers should be cached after parsing.
- Dynamic selection and component overlays should be separate from raw Gerber layers.
- Layer visibility toggles should operate on `RenderLayerDescriptor`, not raw filenames.
- Hit testing should use normalized geometry and spatial indexes, not pixel picking alone.

## 11. Diagnostics and Validation

The parser should return diagnostics instead of throwing for recoverable issues.

Examples:

- missing board outline
- ambiguous top/bottom side
- unknown mechanical layer
- no formal `TF.FileFunction`; fallback mapping used
- drill file found but plating status inferred from report
- multiple outline candidates
- layer coordinate bounds do not overlap
- unsupported aperture macro
- malformed command skipped

Severity levels:

```ts
export type DiagnosticSeverity = "info" | "warning" | "error";
```

Import should fail only when the board cannot be rendered as a coherent PCB dataset.

## 12. Worker Boundary

Parsing belongs in a Web Worker to keep the UI responsive.

Worker input:

- raw file names and bytes
- optional user layer mappings

Worker output:

- parsed board model
- diagnostics
- transferable geometry buffers where practical

The worker should not depend on React or PixiJS.

## 13. Sample Dataset Findings

The current sample in `tmp/gerber_extracted` is an Altium export with:

- 21 Gerber layer/image files
- 1 Excellon/NC drill file
- support reports and aperture files
- no `.gbrjob`
- no formal `TF.FileFunction` attributes
- `TF.FilePolarity` present in layer headers
- layer identity available through the `.extrep` and `.rep` sidecar reports

Important implications:

- The parser must support legacy extension/report-based layer identification.
- The parser cannot require `.gbr` filenames.
- The parser cannot require `TF.FileFunction` for MVP compatibility.
- Drill parsing must support `.txt` Excellon files.

## 14. Suggested Package Layout

```text
packages/parsers/src/
  index.ts
  gerber/
    classify.ts
    parse-gerber.ts
    parse-drill.ts
    parse-job.ts
    aperture.ts
    macro.ts
    plot-state.ts
    geometry.ts
    diagnostics.ts
    modules/
      copper.ts
      solder-mask.ts
      paste.ts
      legend.ts
      profile.ts
      drill.ts
      pads.ts
      drawing.ts
      mechanical.ts
```

`packages/core` should own shared domain types if they are needed outside the parser package. `packages/viewer` should own PixiJS conversion and drawing.

## 15. Implementation Phases

### Phase 1: Classification and Diagnostics

- Read ZIP/file inputs.
- Classify Gerber, drill, job, and support files.
- Parse `TF.*` attributes and sidecar reports.
- Build `LayerIdentity` records.
- Verify the sample dataset maps to expected layers.

### Phase 2: Basic Gerber Geometry

- Parse units, coordinate format, aperture definitions, flashes, strokes, regions, and polarity.
- Emit normalized `GraphicElement[]`.
- Render copper, solder mask, paste, legend, profile, and mechanical layers.

### Phase 3: Drill Geometry

- Parse Excellon/XNC drill files.
- Emit drill hits and slots.
- Overlay holes on the board view.
- Validate alignment with copper/profile bounds.

### Phase 4: Composition and Viewer Integration

- Build `ParsedBoard`.
- Add layer toggles and default visual ordering.
- Cache static layers in the viewer.
- Add fit-to-view from board bounds/profile.

### Phase 5: Hardening

- Add fixture tests for real exports.
- Improve aperture macro support.
- Add user layer-mapping fallback UI.
- Profile large boards and optimize geometry buffers.

## 16. Test Plan

Unit tests:

- content-based file classification
- legacy extension mapping
- `TF.FileFunction` parsing
- coordinate format parsing
- unit conversion
- aperture parsing
- polarity handling
- drill tool parsing

Fixture tests:

- current Altium sample in `tmp/gerber_extracted`
- simple two-layer board
- four-layer board with internal copper
- board with formal `.gbr` + `TF.FileFunction`
- board with `.gbrjob`
- board with Excellon `.drl`
- board with drill exported as `.txt`

Visual regression tests:

- rendered layer count
- board bounds
- outline visibility
- top/bottom copper visibility
- solder mask polarity
- drill-hole alignment

## 17. Open Questions

- Should mechanical layers be shown by default, or hidden until users enable them?
- Should pad master files be used for component hit testing when coordinate matching is available?
- Should bottom-side rendering be mirrored in the parser model or only in viewer transforms?
- How much malformed Gerber recovery should be implemented before MVP?
- Should tracespace remain the first parser implementation, or should BOMBoard own a minimal RS-274X parser from the start?

## 18. 2D Renderer MVP File Priority

The initial 2D renderer is limited to vias, pads, and top/bottom silkscreen. Routing, inner layers, paste, mechanical drawings, and other fabrication details are intentionally ignored unless they help establish the board shape or align the visible graphics.

Priority order:

| Priority | Files | Purpose | MVP implementation note |
| --- | --- | --- | --- |
| 1 | `.GM`, `.GKO`, `.GBR` with profile/outline function | Board outline and render bounds | Required first so review SVGs have stable dimensions and clipping. |
| 2 | Excellon drill files: `.TXT`, `.DRL`, `.XNC`; optional `.DRR` and `-viainfo.txt` | Vias, drill holes, plated-through-hole locations, via cover oil markers | Use `-viainfo.txt` when present for via pad/hole dimensions; parse Excellon coordinates directly for aligned hole masks. |
| 3 | `.GPT`, `.GPB` pad master layers | Top and bottom pad graphics without route geometry | Preferred for this MVP because pad master layers avoid rendering copper traces while preserving pad shapes. |
| 4 | `.GTL`, `.GBL` copper layers | Top and bottom copper pads when pad master layers are missing | Fallback only for now; route strokes and copper pours are not part of the requested view. |
| 5 | `.GTS`, `.GBS` solder mask layers | Green solder mask, exposed copper openings, via cover oil behavior | Render process green solder mask over copper and let mask openings expose pads. |
| 6 | `.GTO`, `.GBO` silkscreen/legend layers | Top and bottom silk print graphics | Render in white/off-white process silkscreen color over solder mask. |

Modern `.GBR` filenames remain supported when formal Gerber attributes such as `TF.FileFunction` identify the same functions. For the supplied Altium sample, legacy extensions and sidecar reports are required because `TF.FileFunction` is absent.
