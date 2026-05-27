import {
  BomBoardImportError,
  type BoardProjectViewerMountOptions,
  type BoardRenderOptions,
  type BoardRenderer,
  type BoardViewerHandle,
  type BoardViewerHost,
  type BoardViewerMountOptions,
  type BoardViewerSelectionChange,
  type BomBoardProjectIR,
  type BomBoardRuntime,
  type OpenProjectInput,
  type OpenProjectResult,
  type ProjectImportInput,
  type ProjectParser,
} from "@bomboard/core";
import {manufacturingProjectParser} from "@bomboard/parsers";
import {
  defaultBoardRenderer,
  pixiBoardViewerHost,
  type BoardRenderModel as ViewerBoardRenderModel,
} from "@bomboard/viewer";

export interface WebBoardViewerMountInput extends BoardProjectViewerMountOptions<HTMLElement> {
  footprintBaseUrl: string;
}

export interface OpenBomBoardProjectInput extends ProjectImportInput {
  container: HTMLElement;
  footprintBaseUrl: string;
  side?: "top" | "bottom";
  showSideControls?: boolean;
  mirrorBottom?: boolean;
  onSelectionChange?: (event: BoardViewerSelectionChange) => void;
}

export interface OpenBomBoardProjectResult {
  project: BomBoardProjectIR;
  viewer: BoardViewerHandle;
}

export interface WebBomBoardRuntimeOptions {
  parsers?: readonly ProjectParser[];
  renderer?: BoardRenderer<ViewerBoardRenderModel>;
  viewerHost?: BoardViewerHost<HTMLElement, ViewerBoardRenderModel>;
}

export {manufacturingProjectParser};
export const boardRenderer = defaultBoardRenderer;
export const boardViewerHost = pixiBoardViewerHost;

export function createWebBomBoardRuntime(
  options: WebBomBoardRuntimeOptions = {}
): BomBoardRuntime<HTMLElement, ViewerBoardRenderModel> {
  return new WebBomBoardRuntime(
    options.parsers ?? [manufacturingProjectParser],
    options.renderer ?? boardRenderer,
    options.viewerHost ?? boardViewerHost
  );
}

export async function parseBomBoardProject(
  input: ProjectImportInput
): Promise<BomBoardProjectIR> {
  return defaultRuntime.parseProject(input);
}

export async function mountBomBoardViewer(
  input: WebBoardViewerMountInput
): Promise<BoardViewerHandle> {
  return defaultRuntime.mountProjectViewer(input);
}

export async function openBomBoardProject(
  input: OpenBomBoardProjectInput
): Promise<OpenBomBoardProjectResult> {
  return defaultRuntime.openProject(input);
}

class WebBomBoardRuntime implements BomBoardRuntime<HTMLElement, ViewerBoardRenderModel> {
  private readonly parsers: readonly ProjectParser[];
  private readonly renderer: BoardRenderer<ViewerBoardRenderModel>;
  private readonly viewerHost: BoardViewerHost<HTMLElement, ViewerBoardRenderModel>;

  constructor(
    parsers: readonly ProjectParser[],
    renderer: BoardRenderer<ViewerBoardRenderModel>,
    viewerHost: BoardViewerHost<HTMLElement, ViewerBoardRenderModel>
  ) {
    this.parsers = parsers;
    this.renderer = renderer;
    this.viewerHost = viewerHost;
  }

  async parseProject(input: ProjectImportInput): Promise<BomBoardProjectIR> {
    const selected = await selectParser(this.parsers, input);
    return selected.parse(input, {createdAt: input.createdAt});
  }

  async createRenderModel(
    project: BomBoardProjectIR,
    options?: BoardRenderOptions
  ): Promise<ViewerBoardRenderModel> {
    return this.renderer.createRenderModel(project, options);
  }

  async mountViewer(
    options: BoardViewerMountOptions<HTMLElement, ViewerBoardRenderModel>
  ): Promise<BoardViewerHandle> {
    return this.viewerHost.mount(options);
  }

  async mountProjectViewer(
    options: BoardProjectViewerMountOptions<HTMLElement>
  ): Promise<BoardViewerHandle> {
    const renderModel = await this.createRenderModel(options.project, {
      mirrorBottom: options.mirrorBottom,
      footprintBaseUrl: options.footprintBaseUrl,
    });

    return this.mountViewer({
      container: options.container,
      renderModel,
      side: options.side,
      showSideControls: options.showSideControls,
      onSelectionChange: options.onSelectionChange,
    });
  }

  async openProject(input: OpenProjectInput<HTMLElement>): Promise<OpenProjectResult> {
    const project = await this.parseProject(input);
    const viewer = await this.mountProjectViewer({
      project,
      container: input.container,
      footprintBaseUrl: input.footprintBaseUrl,
      side: input.side,
      showSideControls: input.showSideControls,
      mirrorBottom: input.mirrorBottom,
      onSelectionChange: input.onSelectionChange,
    });

    return {project, viewer};
  }
}

const defaultRuntime = createWebBomBoardRuntime();

async function selectParser(
  parsers: readonly ProjectParser[],
  input: ProjectImportInput
): Promise<ProjectParser> {
  const probes = await Promise.all(parsers.map(async parser => ({
    parser,
    probe: await parser.probe(input),
  })));
  const selected = probes
    .filter(entry => entry.probe.supported)
    .sort((left, right) => right.probe.confidence - left.probe.confidence)[0];

  if (!selected) {
    throw new BomBoardImportError("unsupported-project", "No parser supports the provided project files.");
  }

  return selected.parser;
}
