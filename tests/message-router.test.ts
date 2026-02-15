import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageRouter } from "../src/message-router.js";
import { EventBus } from "../src/event-bus.js";

describe("MessageRouter", () => {
    let bus: EventBus;
    let router: MessageRouter;

    beforeEach(() => {
        bus = new EventBus();
        router = new MessageRouter(bus);
    });

    it("delivers a message to a registered handler", () => {
        const handler = vi.fn();
        router.registerHandler("AgentA", handler);

        router.sendMessage("AgentB", "AgentA", { text: "hello" });

        expect(handler).toHaveBeenCalledOnce();
        const msg = handler.mock.calls[0][0];
        expect(msg.from).toBe("AgentB");
        expect(msg.to).toBe("AgentA");
        expect(msg.payload).toEqual({ text: "hello" });
        expect(msg.id).toBeTypeOf("string");
        expect(msg.timestamp).toBeTypeOf("string");
    });

    it("emits message:sent and message:received events", () => {
        const sentHandler = vi.fn();
        const receivedHandler = vi.fn();
        bus.on("message:sent", sentHandler);
        bus.on("message:received", receivedHandler);

        router.registerHandler("A", () => {});
        router.sendMessage("B", "A", "payload");

        expect(sentHandler).toHaveBeenCalledOnce();
        expect(receivedHandler).toHaveBeenCalledOnce();
    });

    it("emits message:sent but not message:received when no handler", () => {
        const sentHandler = vi.fn();
        const receivedHandler = vi.fn();
        bus.on("message:sent", sentHandler);
        bus.on("message:received", receivedHandler);

        router.sendMessage("B", "unknown_agent", "payload");

        expect(sentHandler).toHaveBeenCalledOnce();
        expect(receivedHandler).not.toHaveBeenCalled();
    });

    it("returns the created message object", () => {
        router.registerHandler("A", () => {});
        const msg = router.sendMessage("B", "A", "hi");

        expect(msg.from).toBe("B");
        expect(msg.to).toBe("A");
        expect(msg.payload).toBe("hi");
    });

    describe("rate limiting", () => {
        it("allows messages within rate limit", () => {
            router.registerHandler("A", () => {});
            router.setPolicy("sender", { maxMessagesPerSecond: 5 });

            // Should not throw for first 5 messages
            for (let i = 0; i < 5; i++) {
                expect(() =>
                    router.sendMessage("sender", "A", `msg-${i}`),
                ).not.toThrow();
            }
        });

        it("throws when rate limit is exceeded", () => {
            router.registerHandler("A", () => {});
            router.setPolicy("sender", { maxMessagesPerSecond: 2 });

            router.sendMessage("sender", "A", "1");
            router.sendMessage("sender", "A", "2");

            expect(() => router.sendMessage("sender", "A", "3")).toThrow(
                "Rate limit exceeded",
            );
        });

        it("does not rate limit when no policy is set", () => {
            router.registerHandler("A", () => {});

            // Send many messages — should not throw
            for (let i = 0; i < 50; i++) {
                expect(() =>
                    router.sendMessage("sender", "A", `msg-${i}`),
                ).not.toThrow();
            }
        });
    });

    it("clear() removes all handlers and state", () => {
        const handler = vi.fn();
        router.registerHandler("A", handler);
        router.setPolicy("sender", { maxMessagesPerSecond: 1 });

        router.clear();

        // Handler should no longer receive messages
        const sentHandler = vi.fn();
        const receivedHandler = vi.fn();
        bus.on("message:sent", sentHandler);
        bus.on("message:received", receivedHandler);

        router.sendMessage("sender", "A", "after-clear");
        expect(handler).not.toHaveBeenCalled();
        expect(sentHandler).toHaveBeenCalled();
        expect(receivedHandler).not.toHaveBeenCalled();
    });
});
