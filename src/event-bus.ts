import mitt, { type Handler } from "mitt";
import { randomUUID } from "node:crypto";
import type { AgentBoxEvents, EventMeta } from "./types.js";

/**
 * Typed EventBus wrapping mitt.
 * Every emission automatically includes `correlationId` and `timestamp`.
 */
export class EventBus {
    private emitter = mitt<AgentBoxEvents>();

    /** Generate standard event metadata. */
    private meta(correlationId?: string): EventMeta {
        return {
            correlationId: correlationId ?? randomUUID(),
            timestamp: new Date().toISOString(),
        };
    }

    /**
     * Emit a typed event.
     * A `correlationId` is auto-generated if not present in the payload.
     */
    emit<K extends keyof AgentBoxEvents>(
        type: K,
        payload: Omit<AgentBoxEvents[K], keyof EventMeta>,
        correlationId?: string,
    ): void {
        const meta = this.meta(correlationId);
        const full = { ...meta, ...payload } as AgentBoxEvents[K];
        this.emitter.emit(type, full);
    }

    /** Subscribe to a specific event type. */
    on<K extends keyof AgentBoxEvents>(
        type: K,
        handler: Handler<AgentBoxEvents[K]>,
    ): void {
        this.emitter.on(type, handler);
    }

    /** Unsubscribe from a specific event type. */
    off<K extends keyof AgentBoxEvents>(
        type: K,
        handler: Handler<AgentBoxEvents[K]>,
    ): void {
        this.emitter.off(type, handler);
    }

    /** Subscribe to all events (wildcard). */
    onAny(
        handler: <K extends keyof AgentBoxEvents>(
            type: K,
            event: AgentBoxEvents[K],
        ) => void,
    ): void {
        this.emitter.on("*", handler as Handler);
    }

    /** Unsubscribe from wildcard. */
    offAny(
        handler: <K extends keyof AgentBoxEvents>(
            type: K,
            event: AgentBoxEvents[K],
        ) => void,
    ): void {
        this.emitter.off("*", handler as Handler);
    }

    /** Remove all listeners. */
    clear(): void {
        this.emitter.all.clear();
    }
}
