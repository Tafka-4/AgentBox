import { randomUUID } from "node:crypto";
import type { EventBus } from "./event-bus.js";
import type { AgentMessage, Policy } from "./types.js";

/**
 * Direct agent-to-agent message router with per-agent rate limiting.
 */
export class MessageRouter {
    private eventBus: EventBus;
    /** Per-agent rate limit tracking: agentName → timestamps of recent sends. */
    private sendTimestamps = new Map<string, number[]>();
    /** Per-agent policies for rate limits. */
    private policies = new Map<string, Policy>();
    /** Registered message handlers: agentName → handler. */
    private handlers = new Map<
        string,
        (message: AgentMessage) => void
    >();

    constructor(eventBus: EventBus) {
        this.eventBus = eventBus;
    }

    /** Register a handler for messages to a specific agent. */
    registerHandler(
        agentName: string,
        handler: (message: AgentMessage) => void,
    ): void {
        this.handlers.set(agentName, handler);
    }

    /** Set the policy for a specific agent (used for rate limiting). */
    setPolicy(agentName: string, policy: Policy): void {
        this.policies.set(agentName, policy);
    }

    /**
     * Send a message from one agent to another.
     * @throws if rate limit is exceeded or recipient has no handler.
     */
    sendMessage(from: string, to: string, payload: unknown): AgentMessage {
        // Rate limit check
        this.checkRateLimit(from);

        const message: AgentMessage = {
            id: randomUUID(),
            from,
            to,
            payload,
            timestamp: new Date().toISOString(),
        };

        // Record timestamp for rate limiting
        this.recordSend(from);

        // Emit sent event
        this.eventBus.emit("message:sent", { message });

        // Deliver to recipient
        const handler = this.handlers.get(to);
        if (handler) {
            handler(message);
            this.eventBus.emit("message:received", { message });
        }

        return message;
    }

    /** Check if an agent has exceeded its message rate limit. */
    private checkRateLimit(agentName: string): void {
        const policy = this.policies.get(agentName);
        const maxPerSecond = policy?.maxMessagesPerSecond;
        if (maxPerSecond === undefined) return;

        const now = Date.now();
        const timestamps = this.sendTimestamps.get(agentName) ?? [];
        const recentCount = timestamps.filter(
            (t) => now - t < 1000,
        ).length;

        if (recentCount >= maxPerSecond) {
            throw new Error(
                `Rate limit exceeded for agent "${agentName}": ` +
                `${maxPerSecond} messages/second.`,
            );
        }
    }

    /** Record a send timestamp for rate limiting. */
    private recordSend(agentName: string): void {
        const now = Date.now();
        const timestamps = this.sendTimestamps.get(agentName) ?? [];
        // Keep only timestamps from the last 2 seconds
        const recent = timestamps.filter((t) => now - t < 2000);
        recent.push(now);
        this.sendTimestamps.set(agentName, recent);
    }

    /** Remove all handlers. */
    clear(): void {
        this.handlers.clear();
        this.sendTimestamps.clear();
        this.policies.clear();
    }
}
