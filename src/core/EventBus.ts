type Handler<T = unknown> = (payload: T) => void;

class EventBus {
  private listeners = new Map<string, Handler[]>();

  on<T>(event: string, handler: Handler<T>): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(handler as Handler);
    return () => this.off(event, handler as Handler);
  }

  off(event: string, handler: Handler): void {
    const arr = this.listeners.get(event);
    if (arr) this.listeners.set(event, arr.filter(h => h !== handler));
  }

  emit<T>(event: string, payload?: T): void {
    this.listeners.get(event)?.forEach(h => h(payload));
  }
}

export const bus = new EventBus();
