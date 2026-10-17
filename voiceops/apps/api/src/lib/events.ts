import { EventEmitter } from "node:events";

export type LiveEventType =
  | "call.started"
  | "call.turn"
  | "call.ended"
  | "appointment.changed"
  | "callback.changed"
  | "handoff.changed"
  | "waitlist.changed"
  | "message.created"
  | "knowledge.changed";

export interface LiveEvent {
  type: LiveEventType;
  businessId: string;
  data?: Record<string, unknown>;
}

/** In-process pub/sub that feeds the dashboard's Server-Sent Events stream. */
export class EventBus {
  private emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(200);
  }
  publish(event: LiveEvent) {
    this.emitter.emit(event.businessId, event);
  }
  subscribe(businessId: string, fn: (e: LiveEvent) => void): () => void {
    this.emitter.on(businessId, fn);
    return () => this.emitter.off(businessId, fn);
  }
}
