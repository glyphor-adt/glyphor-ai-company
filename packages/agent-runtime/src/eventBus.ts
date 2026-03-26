/**
 * Event Bus — Typed event emitter for agent lifecycle
 *
 * Simplified from the prior internal event bus. Removed SSE mapping
 * (company agents log to console/database instead of streaming to frontend).
 */

import type { AgentEvent } from './types.js';

type EventListener = (event: AgentEvent) => void;

export class EventBus {
  private listeners = new Map<string, Set<EventListener>>();

  emit(event: AgentEvent): void {
    this.listeners.get(event.type)?.forEach((fn) => fn(event));
    this.listeners.get('*')?.forEach((fn) => fn(event));
  }

  on(type: string, fn: EventListener): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(fn);
    return () => this.listeners.get(type)?.delete(fn);
  }

  reset(): void {
    this.listeners.clear();
  }
}
