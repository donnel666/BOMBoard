import type {
  BoardViewerEventListener,
  BoardViewerEventMap,
  BoardViewerEventName,
} from "./types.js";

export class ViewerEventEmitter {
  private readonly listeners = new Map<
    BoardViewerEventName,
    Set<BoardViewerEventListener<BoardViewerEventName>>
  >();

  on<TEventName extends BoardViewerEventName>(
    eventName: TEventName,
    listener: BoardViewerEventListener<TEventName>
  ): () => void {
    const listeners = this.listeners.get(eventName) ?? new Set();
    listeners.add(listener as BoardViewerEventListener<BoardViewerEventName>);
    this.listeners.set(eventName, listeners);

    return () => this.off(eventName, listener);
  }

  off<TEventName extends BoardViewerEventName>(
    eventName: TEventName,
    listener: BoardViewerEventListener<TEventName>
  ): void {
    this.listeners
      .get(eventName)
      ?.delete(listener as BoardViewerEventListener<BoardViewerEventName>);
  }

  emit<TEventName extends BoardViewerEventName>(
    eventName: TEventName,
    event: BoardViewerEventMap[TEventName]
  ): void {
    for (const listener of this.listeners.get(eventName) ?? []) {
      listener(event as BoardViewerEventMap[BoardViewerEventName]);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
