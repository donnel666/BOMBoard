import {
  Application,
  Assets,
  Container,
  Graphics,
  Rectangle,
  Sprite,
} from "pixi.js";
import {
  defaultGerber2DProcessColors,
  renderGerber2DSideSvg,
} from "@bomboard/parsers";

import {colorToHexNumber, defaultBoardViewerColors} from "./colors.js";
import {ViewerEventEmitter} from "./events.js";
import {
  createBoardViewerModel,
  highlightedDesignatorsForSelection,
  visibleComponentsForSide,
} from "./model.js";
import {createSideControls} from "./side-controls.js";

import type {FederatedPointerEvent, Texture} from "pixi.js";
import type {Gerber2DProcessColors, ViewBox} from "@bomboard/parsers";
import type {SideControls} from "./side-controls.js";
import type {
  BoardViewerColors,
  BoardViewerEventListener,
  BoardViewerEventName,
  BoardViewerModel,
  BoardViewerOptions,
  BoardViewerSide,
  BoardViewerState,
  BoardViewerStateChange,
  BoardViewerStateSource,
  ViewerComponent,
  ViewerComponentElement,
  ViewportTransform,
} from "./types.js";

interface ComponentDisplay {
  component: ViewerComponent;
  rotation: number;
}

interface DragState {
  startX: number;
  startY: number;
  viewportX: number;
  viewportY: number;
  targetDesignator: string | null;
  moved: boolean;
}

interface BoardTextureCacheEntry {
  src: string;
  promise: Promise<Texture>;
}

const defaultMinZoom = 0.5;
const defaultMaxZoom = 180;
const fitPaddingPx = 24;
const boardTexturePixelsPerMm = 64;
const maxBoardTextureSidePx = 6144;
const componentHitPaddingMm = 0.18;

export class BoardViewer {
  readonly model: BoardViewerModel;

  private readonly options: BoardViewerOptions;
  private readonly colors: BoardViewerColors;
  private readonly processColors: Gerber2DProcessColors;
  private readonly emitter = new ViewerEventEmitter();
  private readonly app = new Application();
  private readonly viewport = new Container();
  private readonly boardLayer = new Container();
  private readonly componentLayer = new Container();
  private readonly dimLayer = new Graphics();
  private readonly highlightLayer = new Container();
  private readonly componentDisplays = new Map<string, ComponentDisplay>();
  private readonly minZoom: number;
  private readonly maxZoom: number;
  private state: BoardViewerState;
  private sideControls: SideControls | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private dragState: DragState | null = null;
  private currentBoardSprite: Sprite | null = null;
  private readonly boardTextureCache = new Map<BoardViewerSide, BoardTextureCacheEntry>();
  private boardRenderVersion = 0;
  private pendingRenderFrame: number | null = null;
  private initialized = false;
  private destroyed = false;
  private userChangedViewport = false;
  private previousContainerPosition = "";
  private previousContainerOverflow = "";
  private changedContainerPosition = false;
  private changedContainerOverflow = false;

  private constructor(options: BoardViewerOptions) {
    this.options = options;
    this.colors = {...defaultBoardViewerColors, ...options.colors};
    this.processColors = {...defaultGerber2DProcessColors, ...options.processColors};
    this.model = createBoardViewerModel(options);
    this.minZoom = positiveNumber(options.minZoom) ?? defaultMinZoom;
    this.maxZoom = positiveNumber(options.maxZoom) ?? defaultMaxZoom;
    this.state = {
      side: options.side ?? "top",
      selectedDesignator: null,
      highlightedDesignators: [],
      hoveredDesignator: null,
      viewport: {x: 0, y: 0, scale: 1},
    };
  }

  static async create(options: BoardViewerOptions): Promise<BoardViewer> {
    const viewer = new BoardViewer(options);
    await viewer.initialize();
    return viewer;
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  getState(): BoardViewerState {
    return this.snapshotState();
  }

  getComponents(): readonly ViewerComponent[] {
    return this.model.components;
  }

  getVisibleComponents(): readonly ViewerComponent[] {
    return visibleComponentsForSide(this.model.components, this.state.side);
  }

  getComponent(designator: string): ViewerComponent | null {
    return this.model.components.find(component => component.designator === designator) ?? null;
  }

  on<TEventName extends BoardViewerEventName>(
    eventName: TEventName,
    listener: BoardViewerEventListener<TEventName>
  ): () => void {
    return this.emitter.on(eventName, listener);
  }

  off<TEventName extends BoardViewerEventName>(
    eventName: TEventName,
    listener: BoardViewerEventListener<TEventName>
  ): void {
    this.emitter.off(eventName, listener);
  }

  async setSide(
    side: BoardViewerSide,
    source: BoardViewerStateSource = "external"
  ): Promise<void> {
    this.assertReady();
    if (this.state.side === side) return;

    this.state = {...this.state, side};
    this.sideControls?.update(side);
    await this.renderBoardSide();
    this.renderComponents();
    this.emitStateChange(source);
    this.emitter.emit("sidechange", {
      state: this.snapshotState(),
      source,
      side,
    });
  }

  toggleComponentSelection(
    designator: string,
    source: BoardViewerStateSource = "external"
  ): void {
    if (this.state.selectedDesignator === designator) {
      this.clearSelection(source);
      return;
    }

    this.selectComponent(designator, source);
  }

  selectComponent(
    designator: string | null,
    source: BoardViewerStateSource = "external"
  ): void {
    this.assertReady();

    if (designator === null) {
      this.clearSelection(source);
      return;
    }

    const component = this.getComponent(designator);
    if (!component) return;

    const highlightedDesignators = highlightedDesignatorsForSelection(
      this.model.components,
      component.designator
    );
    this.state = {
      ...this.state,
      selectedDesignator: component.designator,
      highlightedDesignators,
    };
    this.renderSelectionState();
    this.emitSelectionChange(source);
  }

  selectSingleComponent(
    designator: string,
    source: BoardViewerStateSource = "external"
  ): void {
    this.assertReady();

    const component = this.getComponent(designator);
    if (!component) return;

    this.state = {
      ...this.state,
      selectedDesignator: component.designator,
      highlightedDesignators: [component.designator],
    };
    this.renderSelectionState();
    this.emitSelectionChange(source);
  }

  clearSelection(source: BoardViewerStateSource = "external"): void {
    this.assertReady();
    if (this.state.selectedDesignator === null && this.state.highlightedDesignators.length === 0) return;

    this.state = {
      ...this.state,
      selectedDesignator: null,
      highlightedDesignators: [],
    };
    this.renderSelectionState();
    this.emitSelectionChange(source);
  }

  setViewport(
    viewport: ViewportTransform,
    source: BoardViewerStateSource = "external"
  ): void {
    this.updateViewport(viewport, source, true);
  }

  private updateViewport(
    viewport: ViewportTransform,
    source: BoardViewerStateSource,
    emit: boolean
  ): void {
    this.assertReady();
    const scale = clamp(viewport.scale, this.minZoom, this.maxZoom);
    this.state = {
      ...this.state,
      viewport: {
        x: viewport.x,
        y: viewport.y,
        scale,
      },
    };
    this.applyViewport();
    if (emit) this.emitViewportChange(source);
  }

  panBy(deltaX: number, deltaY: number, source: BoardViewerStateSource = "external"): void {
    this.setViewport(
      {
        ...this.state.viewport,
        x: this.state.viewport.x + deltaX,
        y: this.state.viewport.y + deltaY,
      },
      source
    );
  }

  zoomBy(
    factor: number,
    screenPoint: {x: number; y: number} | null = null,
    source: BoardViewerStateSource = "external"
  ): void {
    this.assertReady();
    if (!Number.isFinite(factor) || factor <= 0) return;

    const point = screenPoint ?? {
      x: this.app.renderer.width / 2,
      y: this.app.renderer.height / 2,
    };
    const before = this.screenToWorld(point.x, point.y);
    const scale = clamp(this.state.viewport.scale * factor, this.minZoom, this.maxZoom);

    this.setViewport(
      {
        x: point.x - before.x * scale,
        y: point.y - before.y * scale,
        scale,
      },
      source
    );
  }

  fitToView(source: BoardViewerStateSource = "external"): void {
    this.assertReady();
    const viewport = fitViewportToViewBox(
      this.model.viewBox,
      this.app.renderer.width,
      this.app.renderer.height,
      fitPaddingPx
    );
    this.userChangedViewport = false;
    this.setViewport(viewport, source);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.canvas.removeEventListener("wheel", this.handleWheel);
    this.canvas.removeEventListener("pointerleave", this.handleCanvasPointerLeave);
    this.sideControls?.destroy();
    this.emitter.clear();
    if (this.pendingRenderFrame !== null) {
      globalThis.cancelAnimationFrame(this.pendingRenderFrame);
      this.pendingRenderFrame = null;
    }
    for (const entry of this.boardTextureCache.values()) {
      void Assets.unload(entry.src).catch(() => undefined);
    }
    this.boardTextureCache.clear();

    this.app.destroy(
      {removeView: true},
      {children: true, texture: true, textureSource: true}
    );

    if (this.changedContainerPosition) {
      this.options.container.style.position = this.previousContainerPosition;
    }

    if (this.changedContainerOverflow) {
      this.options.container.style.overflow = this.previousContainerOverflow;
    }
  }

  private async initialize(): Promise<void> {
    this.prepareContainer();

    await this.app.init({
      resizeTo: this.options.container,
      background: this.colors.background,
      antialias: true,
      autoDensity: true,
      autoStart: false,
      resolution: globalThis.devicePixelRatio || 1,
      eventFeatures: {
        click: true,
        globalMove: true,
        move: true,
        wheel: true,
      },
    });

    this.options.container.appendChild(this.app.canvas);
    Object.assign(this.app.canvas.style, {
      display: "block",
      width: "100%",
      height: "100%",
      touchAction: "none",
    });

    this.viewport.addChild(this.boardLayer, this.componentLayer, this.dimLayer, this.highlightLayer);
    this.boardLayer.eventMode = "none";
    this.componentLayer.eventMode = "none";
    this.dimLayer.eventMode = "none";
    this.highlightLayer.eventMode = "none";
    this.app.stage.addChild(this.viewport);
    this.app.stage.eventMode = "static";
    this.app.stage.hitArea = new Rectangle(0, 0, this.app.renderer.width, this.app.renderer.height);
    this.app.stage.cursor = "grab";
    this.app.stage.on("pointerdown", this.handleStagePointerDown);
    this.app.stage.on("globalpointermove", this.handleStagePointerMove);
    this.app.stage.on("pointerup", this.handleStagePointerUp);
    this.app.stage.on("pointerupoutside", this.handleStagePointerUp);
    this.app.canvas.addEventListener("wheel", this.handleWheel, {passive: false});
    this.app.canvas.addEventListener("pointerleave", this.handleCanvasPointerLeave);

    if (this.options.showSideControls !== false) {
      this.sideControls = createSideControls(this.options.container, this.state.side, side => {
        void this.setSide(side, "viewer");
      });
    }

    this.observeResize();
    await this.renderBoardSide();
    this.renderComponents();
    this.initialized = true;
    this.fitToView("viewer");
    this.emitStateChange("viewer");
  }

  private prepareContainer(): void {
    this.previousContainerPosition = this.options.container.style.position;
    this.previousContainerOverflow = this.options.container.style.overflow;
    const position = globalThis.getComputedStyle(this.options.container).position;
    if (position === "static") {
      this.options.container.style.position = "relative";
      this.changedContainerPosition = true;
    }

    if (!this.options.container.style.overflow) {
      this.options.container.style.overflow = "hidden";
      this.changedContainerOverflow = true;
    }
  }

  private observeResize(): void {
    this.resizeObserver = new ResizeObserver(() => {
      this.app.renderer.resize(
        this.options.container.clientWidth,
        this.options.container.clientHeight
      );
      this.app.stage.hitArea = new Rectangle(0, 0, this.app.renderer.width, this.app.renderer.height);
      if (!this.initialized) return;
      if (this.options.autoFitOnResize !== false && !this.userChangedViewport) {
        this.fitToView("viewer");
      } else {
        this.requestRender();
      }
    });
    this.resizeObserver.observe(this.options.container);
  }

  private async renderBoardSide(): Promise<void> {
    const renderVersion = ++this.boardRenderVersion;
    this.boardLayer.removeChildren();
    this.currentBoardSprite?.destroy({texture: false, textureSource: false});
    this.currentBoardSprite = null;

    const texture = await this.getBoardTexture(this.state.side);
    if (this.destroyed || renderVersion !== this.boardRenderVersion) return;

    const sprite = new Sprite(texture);
    const [x, y, width, height] = this.model.viewBox;
    sprite.position.set(x, y);
    sprite.width = width;
    sprite.height = height;
    this.currentBoardSprite = sprite;
    this.boardLayer.addChild(sprite);
    this.requestRender();
  }

  private getBoardTexture(side: BoardViewerSide): Promise<Texture> {
    const cached = this.boardTextureCache.get(side);
    if (cached) return cached.promise;

    const svg = renderGerber2DSideSvg(this.options.gerber, side, {
      colors: this.processColors,
      mirrorBottom: this.options.mirrorBottom,
    });
    const src = svgToDataUrl(prepareSvgForTexture(svg, this.model.viewBox));
    const entry: BoardTextureCacheEntry = {
      src,
      promise: Assets.load(src),
    };
    this.boardTextureCache.set(side, entry);
    entry.promise.catch(() => {
      if (this.boardTextureCache.get(side) === entry) {
        this.boardTextureCache.delete(side);
      }
    });

    return entry.promise;
  }

  private renderComponents(): void {
    this.componentLayer.removeChildren();
    this.highlightLayer.removeChildren();
    this.componentDisplays.clear();

    for (const component of this.getVisibleComponents()) {
      this.componentDisplays.set(component.designator, {
        component,
        rotation: this.componentDisplayRotation(component),
      });
    }

    this.renderSelectionState();
  }

  private renderSelectionState(): void {
    const highlighted = new Set(this.state.highlightedDesignators);
    const selected = this.state.selectedDesignator;

    this.dimLayer.clear();
    if (highlighted.size > 0) {
      const [x, y, width, height] = this.model.viewBox;
      this.dimLayer
        .rect(x, y, width, height)
        .fill({color: colorToHexNumber(this.colors.dimOverlay), alpha: 0.58});
    }

    this.highlightLayer.removeChildren();
    for (const {component, rotation} of this.componentDisplays.values()) {
      const isSelected = component.designator === selected;
      const isHighlighted = highlighted.has(component.designator);

      if (isHighlighted) {
        const marker = new Graphics();
        marker.position.set(component.displayPosition.x, component.displayPosition.y);
        marker.rotation = rotation;
        drawComponentGraphic(marker, component, this.colors, true, isSelected);
        this.highlightLayer.addChild(marker);
      }
    }

    this.requestRender();
  }

  private setHoveredComponent(
    designator: string | null,
    source: BoardViewerStateSource
  ): void {
    if (this.state.hoveredDesignator === designator) return;
    this.state = {...this.state, hoveredDesignator: designator};
    this.emitter.emit("hoverchange", {
      state: this.snapshotState(),
      source,
      hoveredComponent: designator ? this.getComponent(designator) : null,
    });
    this.emitStateChange(source);
  }

  private handleStagePointerDown = (event: FederatedPointerEvent): void => {
    const targetComponent = this.findComponentAtScreenPoint(event.global.x, event.global.y);
    this.dragState = {
      startX: event.global.x,
      startY: event.global.y,
      viewportX: this.state.viewport.x,
      viewportY: this.state.viewport.y,
      targetDesignator: targetComponent?.designator ?? null,
      moved: false,
    };
    this.app.stage.cursor = "grabbing";
  };

  private handleStagePointerMove = (event: FederatedPointerEvent): void => {
    if (!this.dragState) {
      this.updateHoverAtScreenPoint(event.global.x, event.global.y);
      return;
    }

    const deltaX = event.global.x - this.dragState.startX;
    const deltaY = event.global.y - this.dragState.startY;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 2) {
      this.dragState.moved = true;
    }

    this.userChangedViewport = true;
    this.updateViewport(
      {
        ...this.state.viewport,
        x: this.dragState.viewportX + deltaX,
        y: this.dragState.viewportY + deltaY,
      },
      "viewer",
      false
    );
  };

  private handleStagePointerUp = (event: FederatedPointerEvent): void => {
    if (!this.dragState) return;
    const dragState = this.dragState;
    const dragged = dragState.moved;
    this.dragState = null;
    this.updateHoverAtScreenPoint(event.global.x, event.global.y);

    if (dragged) {
      this.emitViewportChange("viewer");
      return;
    }

    const releaseComponent = this.findComponentAtScreenPoint(event.global.x, event.global.y);
    const clickedComponent = releaseComponent?.designator === dragState.targetDesignator
      ? releaseComponent
      : null;

    if (!clickedComponent) {
      this.clearSelection("viewer");
      return;
    }

    this.toggleComponentSelection(clickedComponent.designator, "viewer");
    this.emitter.emit("componentclick", {
      component: clickedComponent,
      state: this.snapshotState(),
    });
  };

  private handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const bounds = this.canvas.getBoundingClientRect();
    const screenPoint = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    const factor = Math.exp(-event.deltaY * 0.001);
    this.userChangedViewport = true;
    this.zoomBy(factor, screenPoint, "viewer");
  };

  private screenToWorld(x: number, y: number): {x: number; y: number} {
    const viewport = this.state.viewport;
    return {
      x: (x - viewport.x) / viewport.scale,
      y: (y - viewport.y) / viewport.scale,
    };
  }

  private applyViewport(): void {
    const viewport = this.state.viewport;
    this.viewport.position.set(viewport.x, viewport.y);
    this.viewport.scale.set(viewport.scale);
    this.requestRender();
  }

  private updateHoverAtScreenPoint(x: number, y: number): void {
    const hoveredComponent = this.findComponentAtScreenPoint(x, y);
    this.setHoveredComponent(hoveredComponent?.designator ?? null, "viewer");
    this.app.stage.cursor = hoveredComponent ? "pointer" : "grab";
  }

  private handleCanvasPointerLeave = (): void => {
    if (this.dragState) return;
    this.setHoveredComponent(null, "viewer");
    this.app.stage.cursor = "grab";
  };

  private findComponentAtScreenPoint(x: number, y: number): ViewerComponent | null {
    if (x < 0 || y < 0 || x > this.app.renderer.width || y > this.app.renderer.height) {
      return null;
    }

    const worldPoint = this.screenToWorld(x, y);
    let matchedComponent: ViewerComponent | null = null;
    let matchedScore = Number.POSITIVE_INFINITY;
    for (const {component, rotation} of this.componentDisplays.values()) {
      if (componentContainsPoint(component, rotation, worldPoint)) {
        const score = componentHitScore(component, worldPoint);
        if (score < matchedScore) {
          matchedComponent = component;
          matchedScore = score;
        }
      }
    }

    return matchedComponent;
  }

  private componentDisplayRotation(component: ViewerComponent): number {
    return component.side === "bottom" && this.options.mirrorBottom !== false
      ? radians(component.rotationDeg)
      : -radians(component.rotationDeg);
  }

  private requestRender(): void {
    if (this.destroyed || this.pendingRenderFrame !== null) return;
    this.pendingRenderFrame = globalThis.requestAnimationFrame(() => {
      this.pendingRenderFrame = null;
      if (!this.destroyed) this.app.render();
    });
  }

  private emitSelectionChange(source: BoardViewerStateSource): void {
    const event = {
      state: this.snapshotState(),
      source,
      selectedComponent: this.state.selectedDesignator
        ? this.getComponent(this.state.selectedDesignator)
        : null,
      highlightedComponents: this.state.highlightedDesignators
        .map(designator => this.getComponent(designator))
        .filter((component): component is ViewerComponent => component !== null),
    };

    this.emitStateChange(source);
    this.options.onSelectionChange?.(event);
    this.emitter.emit("selectionchange", event);
  }

  private emitViewportChange(source: BoardViewerStateSource): void {
    this.emitter.emit("viewportchange", {
      state: this.snapshotState(),
      source,
      viewport: {...this.state.viewport},
    });
    this.emitStateChange(source);
  }

  private emitStateChange(source: BoardViewerStateSource): void {
    const event: BoardViewerStateChange = {
      state: this.snapshotState(),
      source,
    };
    this.options.onStateChange?.(event);
    this.emitter.emit("statechange", event);
  }

  private snapshotState(): BoardViewerState {
    return {
      side: this.state.side,
      selectedDesignator: this.state.selectedDesignator,
      highlightedDesignators: [...this.state.highlightedDesignators],
      hoveredDesignator: this.state.hoveredDesignator,
      viewport: {...this.state.viewport},
    };
  }

  private assertReady(): void {
    if (this.destroyed) {
      throw new Error("BoardViewer has been destroyed.");
    }

    if (!this.initialized) {
      throw new Error("BoardViewer is not initialized yet.");
    }
  }
}

export function createBoardViewer(options: BoardViewerOptions): Promise<BoardViewer> {
  return BoardViewer.create(options);
}

function componentHitScore(
  component: ViewerComponent,
  point: {x: number; y: number}
): number {
  const centerDistance = Math.hypot(
    point.x - component.displayPosition.x,
    point.y - component.displayPosition.y
  );
  const hitArea = component.size.hitWidthMm * component.size.hitHeightMm;
  return centerDistance + hitArea * 0.0001;
}

function drawComponentGraphic(
  graphic: Graphics,
  component: ViewerComponent,
  colors: BoardViewerColors,
  highlighted: boolean,
  selected: boolean
): void {
  const fill = selected
    ? colors.selectedFill
    : highlighted
      ? colors.similarFill
      : colors.componentFill;
  const alpha = highlighted || selected ? 0.95 : 0.44;

  graphic.clear();
  drawComponentElements(graphic, component.highlightElements, {
    fill,
    alpha,
  });
}

function componentContainsPoint(
  component: ViewerComponent,
  rotation: number,
  point: {x: number; y: number}
): boolean {
  const deltaX = point.x - component.displayPosition.x;
  const deltaY = point.y - component.displayPosition.y;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const localX = deltaX * cos + deltaY * sin;
  const localY = -deltaX * sin + deltaY * cos;

  const localPoint = {x: localX, y: localY};
  if (component.highlightElements.length > 0) {
    const elementHit = component.highlightElements.some(element => componentElementContainsPoint(
      element,
      localPoint,
      componentHitPaddingMm
    ));
    if (elementHit) return true;
  }

  return Math.abs(localX) <= component.size.hitWidthMm / 2
    && Math.abs(localY) <= component.size.hitHeightMm / 2;
}

function componentElementContainsPoint(
  element: ViewerComponentElement,
  point: {x: number; y: number},
  paddingMm: number
): boolean {
  if (element.kind === "circle") {
    return Math.hypot(point.x - element.center.x, point.y - element.center.y)
      <= element.radiusMm + paddingMm;
  }

  if (element.kind === "polyline") {
    return pointDistanceToPolyline(point, element.points)
      <= element.strokeWidthMm / 2 + paddingMm;
  }

  if (!pointInPolygonBounds(point, element.points, paddingMm)) return false;
  if (pointInPolygon(point, element.points)) return true;
  return pointDistanceToPolyline(point, closedPolyline(element.points)) <= paddingMm;
}

function pointInPolygonBounds(
  point: {x: number; y: number},
  polygon: readonly {x: number; y: number}[],
  paddingMm: number
): boolean {
  if (polygon.length === 0) return false;
  const xs = polygon.map(vertex => vertex.x);
  const ys = polygon.map(vertex => vertex.y);
  return point.x >= Math.min(...xs) - paddingMm
    && point.x <= Math.max(...xs) + paddingMm
    && point.y >= Math.min(...ys) - paddingMm
    && point.y <= Math.max(...ys) + paddingMm;
}

function pointInPolygon(
  point: {x: number; y: number},
  polygon: readonly {x: number; y: number}[]
): boolean {
  let inside = false;
  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    if (!current || !previous) continue;
    const crosses = (current.y > point.y) !== (previous.y > point.y)
      && point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
    if (crosses) inside = !inside;
  }

  return inside;
}

function closedPolyline(
  points: readonly {x: number; y: number}[]
): {x: number; y: number}[] {
  const first = points[0];
  if (!first) return [];
  return [...points, first];
}

function pointDistanceToPolyline(
  point: {x: number; y: number},
  points: readonly {x: number; y: number}[]
): number {
  if (points.length < 2) return Number.POSITIVE_INFINITY;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current) continue;
    distance = Math.min(distance, pointDistanceToSegment(point, previous, current));
  }
  return distance;
}

function pointDistanceToSegment(
  point: {x: number; y: number},
  start: {x: number; y: number},
  end: {x: number; y: number}
): number {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);

  const t = clamp(
    ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared,
    0,
    1
  );
  return Math.hypot(
    point.x - (start.x + t * deltaX),
    point.y - (start.y + t * deltaY)
  );
}

function drawComponentElements(
  graphic: Graphics,
  elements: readonly ViewerComponentElement[],
  style: {
    fill: string;
    alpha: number;
  }
): void {
  const fill = colorToHexNumber(style.fill);

  for (const element of elements) {
    if (element.kind === "circle") {
      graphic
        .circle(element.center.x, element.center.y, element.radiusMm)
        .fill({color: fill, alpha: style.alpha});
      continue;
    }

    if (element.kind === "polyline") {
      if (element.points.length < 2) continue;
      drawPolyline(graphic, element.points)
        .stroke({
          color: fill,
          width: element.strokeWidthMm,
          alpha: style.alpha,
        });
      continue;
    }

    const points = flattenPoints(element.points);
    if (points.length < 6) continue;
    graphic
      .poly(points, true)
      .fill({color: fill, alpha: style.alpha});
  }
}

function drawPolyline(
  graphic: Graphics,
  points: readonly {x: number; y: number}[]
): Graphics {
  const [first, ...rest] = points;
  if (!first) return graphic;

  graphic.moveTo(first.x, first.y);
  for (const point of rest) {
    graphic.lineTo(point.x, point.y);
  }

  return graphic;
}

function flattenPoints(points: readonly {x: number; y: number}[]): number[] {
  return points.flatMap(point => [point.x, point.y]);
}

function fitViewportToViewBox(
  viewBox: ViewBox,
  widthPx: number,
  heightPx: number,
  paddingPx: number
): ViewportTransform {
  const [, , boardWidth, boardHeight] = viewBox;
  const availableWidth = Math.max(widthPx - paddingPx * 2, 1);
  const availableHeight = Math.max(heightPx - paddingPx * 2, 1);
  const scale = Math.min(availableWidth / boardWidth, availableHeight / boardHeight);

  return {
    x: (widthPx - boardWidth * scale) / 2 - viewBox[0] * scale,
    y: (heightPx - boardHeight * scale) / 2 - viewBox[1] * scale,
    scale,
  };
}

function prepareSvgForTexture(svg: string, viewBox: ViewBox): string {
  const [, , widthMm, heightMm] = viewBox;
  const devicePixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
  const maxSideMm = Math.max(widthMm, heightMm, 1);
  const pixelsPerMm = Math.min(
    boardTexturePixelsPerMm * devicePixelRatio,
    maxBoardTextureSidePx / maxSideMm
  );
  const widthPx = Math.max(1, Math.ceil(widthMm * pixelsPerMm));
  const heightPx = Math.max(1, Math.ceil(heightMm * pixelsPerMm));

  return svg.replace(/<svg([^>]*)>/, (_match, attributes: string) => {
    const cleanedAttributes = attributes
      .replace(/\swidth="[^"]*"/, "")
      .replace(/\sheight="[^"]*"/, "");

    return `<svg${cleanedAttributes} width="${widthPx}" height="${heightPx}">`;
  });
}

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function positiveNumber(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
