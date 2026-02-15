import { describe, it, expect, vi } from "vitest";
import { EventBus } from "../src/event-bus.js";

describe("EventBus", () => {
    it("emits typed events and delivers them to subscribers", () => {
        const bus = new EventBus();
        const handler = vi.fn();

        bus.on("agent:started", handler);
        bus.emit("agent:started", { agentName: "TestAgent" });

        expect(handler).toHaveBeenCalledOnce();
        const payload = handler.mock.calls[0][0];
        expect(payload.agentName).toBe("TestAgent");
    });

    it("auto-injects correlationId and timestamp", () => {
        const bus = new EventBus();
        const handler = vi.fn();

        bus.on("agent:idle", handler);
        bus.emit("agent:idle", { agentName: "A" });

        const payload = handler.mock.calls[0][0];
        expect(payload.correlationId).toBeTypeOf("string");
        expect(payload.correlationId.length).toBeGreaterThan(10);
        expect(payload.timestamp).toBeTypeOf("string");
        expect(() => new Date(payload.timestamp)).not.toThrow();
    });

    it("uses a provided correlationId when given", () => {
        const bus = new EventBus();
        const handler = vi.fn();

        bus.on("agent:started", handler);
        bus.emit("agent:started", { agentName: "A" }, "custom-id-123");

        expect(handler.mock.calls[0][0].correlationId).toBe("custom-id-123");
    });

    it("off() unsubscribes a handler", () => {
        const bus = new EventBus();
        const handler = vi.fn();

        bus.on("agent:error", handler);
        bus.off("agent:error", handler);
        bus.emit("agent:error", { agentName: "A", error: "boom" });

        expect(handler).not.toHaveBeenCalled();
    });

    it("onAny() receives all events with type", () => {
        const bus = new EventBus();
        const handler = vi.fn();

        bus.onAny(handler);
        bus.emit("agent:started", { agentName: "A" });
        bus.emit("job:cancelled", { jobId: "j1" });

        expect(handler).toHaveBeenCalledTimes(2);
        expect(handler.mock.calls[0][0]).toBe("agent:started");
        expect(handler.mock.calls[1][0]).toBe("job:cancelled");
    });

    it("offAny() unsubscribes wildcard handler", () => {
        const bus = new EventBus();
        const handler = vi.fn();

        bus.onAny(handler);
        bus.offAny(handler);
        bus.emit("agent:started", { agentName: "A" });

        expect(handler).not.toHaveBeenCalled();
    });

    it("clear() removes all handlers", () => {
        const bus = new EventBus();
        const h1 = vi.fn();
        const h2 = vi.fn();

        bus.on("agent:started", h1);
        bus.onAny(h2);
        bus.clear();
        bus.emit("agent:started", { agentName: "A" });

        expect(h1).not.toHaveBeenCalled();
        expect(h2).not.toHaveBeenCalled();
    });

    it("supports multiple handlers on the same event", () => {
        const bus = new EventBus();
        const h1 = vi.fn();
        const h2 = vi.fn();

        bus.on("agent:thinking", h1);
        bus.on("agent:thinking", h2);
        bus.emit("agent:thinking", { agentName: "A" });

        expect(h1).toHaveBeenCalledOnce();
        expect(h2).toHaveBeenCalledOnce();
    });
});
