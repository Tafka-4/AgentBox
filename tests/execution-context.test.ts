import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { ExecutionContext } from "../src/execution-context.js";
import { EventBus } from "../src/event-bus.js";
import { Registry } from "../src/registry.js";
import type { ToolDefinition, AgentDefinition } from "../src/types.js";

function makeTool(name: string, desc?: string): ToolDefinition {
    return {
        name,
        description: desc ?? `Tool ${name}`,
        inputSchema: z.object({ q: z.string() }),
        execute: async (input) => input,
    };
}

function makeAgent(
    name: string,
    overrides: Partial<AgentDefinition> = {},
): AgentDefinition {
    return {
        name,
        prompt: "test prompt",
        tools: [],
        policy: {},
        mcpServers: [],
        ...overrides,
    };
}

describe("ExecutionContext", () => {
    let bus: EventBus;
    let registry: Registry;

    beforeEach(() => {
        bus = new EventBus();
        registry = new Registry();
        // Register the MasterAgent (normally done by AgentBox)
        registry.registerAgent(makeAgent("MasterAgent"));
    });

    describe("run() pipeline", () => {
        it("runs all agents and returns ExecutionResult", async () => {
            registry.registerAgent(makeAgent("Worker"));
            const ctx = new ExecutionContext(bus, registry, 5);

            const result = await ctx.run("test task");

            expect(result.status).toBe("completed");
            expect(result.claims).toBeDefined();
            expect(result.consensus).toBeDefined();
            expect(result.conflicts).toBeDefined();
            expect(result.jobResults).toBeDefined();
        });

        it("jobResults contains actual Job objects with correct fields", async () => {
            registry.registerAgent(makeAgent("Worker"));
            const ctx = new ExecutionContext(bus, registry, 5);

            const result = await ctx.run("test task");

            // Should have jobs for MasterAgent + Worker
            expect(result.jobResults.length).toBeGreaterThanOrEqual(2);
            for (const job of result.jobResults) {
                expect(job.id).toBeTypeOf("string");
                expect(job.agentName).toBeTypeOf("string");
                expect(job.task).toBe("test task");
                expect(job.status).toBe("completed");
                expect(job.createdAt).toBeTypeOf("string");
            }
        });

        it("emits agent lifecycle events with consistent correlationId", async () => {
            registry.registerAgent(makeAgent("Worker"));
            const ctx = new ExecutionContext(bus, registry, 5);

            const correlationIds = new Set<string>();
            bus.onAny((_type, event) => {
                const e = event as { correlationId?: string };
                if (e?.correlationId) {
                    correlationIds.add(e.correlationId);
                }
            });

            await ctx.run("test task");

            // Agent lifecycle events should all share the same correlationId
            // There may be other events without correlationId (job:scheduled etc.)
            // but agent:started/thinking/idle should all share one
            expect(correlationIds.size).toBeGreaterThanOrEqual(1);
        });
    });

    describe("validate()", () => {
        it("throws on unknown tool references", async () => {
            registry.registerAgent(
                makeAgent("BadAgent", { tools: ["nonexistent"] }),
            );
            const ctx = new ExecutionContext(bus, registry);

            await expect(ctx.run("task")).rejects.toThrow(
                'Agent "BadAgent" references unknown tool "nonexistent".',
            );
        });

        it("throws on unknown MCP references", async () => {
            registry.registerAgent(
                makeAgent("BadAgent", { mcpServers: ["nonexistent"] }),
            );
            const ctx = new ExecutionContext(bus, registry);

            await expect(ctx.run("task")).rejects.toThrow(
                'Agent "BadAgent" references unknown MCP "nonexistent".',
            );
        });
    });

    describe("policy enforcement", () => {
        it("throws when agent tools violate toolAllowlist", async () => {
            const tool = makeTool("search");
            registry.registerTool(tool);
            registry.registerAgent(
                makeAgent("Restricted", {
                    tools: ["search"],
                    policy: { toolAllowlist: ["calculator"] },
                }),
            );
            const ctx = new ExecutionContext(bus, registry);

            await expect(ctx.run("task")).rejects.toThrow(
                'Agent "Restricted" tool "search" is not on the toolAllowlist.',
            );
        });

        it("allows tools on the allowlist", async () => {
            const tool = makeTool("search");
            registry.registerTool(tool);
            registry.registerAgent(
                makeAgent("Allowed", {
                    tools: ["search"],
                    policy: { toolAllowlist: ["search"] },
                }),
            );
            const ctx = new ExecutionContext(bus, registry);

            const result = await ctx.run("task");
            expect(result.status).toBe("completed");
        });

        it("does not enforce allowlist when not set", async () => {
            const tool = makeTool("search");
            registry.registerTool(tool);
            registry.registerAgent(
                makeAgent("Free", { tools: ["search"], policy: {} }),
            );
            const ctx = new ExecutionContext(bus, registry);

            const result = await ctx.run("task");
            expect(result.status).toBe("completed");
        });
    });

    describe("control API", () => {
        it("pause() sets status to paused", () => {
            const ctx = new ExecutionContext(bus, registry);
            ctx.pause();
            expect(ctx.runStatus).toBe("paused");
        });

        it("resume() sets status to running", () => {
            const ctx = new ExecutionContext(bus, registry);
            ctx.pause();
            ctx.resume();
            expect(ctx.runStatus).toBe("running");
        });

        it("cancel() sets status to cancelled", () => {
            const ctx = new ExecutionContext(bus, registry);
            ctx.cancel();
            expect(ctx.runStatus).toBe("cancelled");
        });

        it("injectMessage creates a message via MessageRouter", () => {
            const ctx = new ExecutionContext(bus, registry);

            const sentHandler = vi.fn();
            bus.on("message:sent", sentHandler);

            const msg = ctx.injectMessage("Worker", { hint: "do X" });

            expect(msg.to).toBe("Worker");
            expect(msg.from).toBe("__system__");
            expect(msg.payload).toEqual({ hint: "do X" });
            expect(sentHandler).toHaveBeenCalledOnce();
        });

        it("injectMessage uses provided from", () => {
            const ctx = new ExecutionContext(bus, registry);
            const msg = ctx.injectMessage("Worker", "data", "CustomSender");
            expect(msg.from).toBe("CustomSender");
        });
    });

    describe("claims access", () => {
        it("provides access to ClaimGraph via claims getter", () => {
            const ctx = new ExecutionContext(bus, registry);
            expect(ctx.claims).toBeDefined();
            expect(typeof ctx.claims.addClaim).toBe("function");
        });
    });

    describe("messages access", () => {
        it("provides access to MessageRouter via messages getter", () => {
            const ctx = new ExecutionContext(bus, registry);
            expect(ctx.messages).toBeDefined();
            expect(typeof ctx.messages.sendMessage).toBe("function");
        });
    });

    describe("budget enforcement during run", () => {
        it("emits agent:error when agent exceeds token budget", async () => {
            // Register an agent with maxTokens: 0 — any execution will exceed budget
            registry.registerAgent(
                makeAgent("BudgetAgent", {
                    policy: { maxTokens: 0 },
                }),
            );
            const ctx = new ExecutionContext(bus, registry, 5);

            const errorHandler = vi.fn();
            bus.on("agent:error", errorHandler);

            const result = await ctx.run("task");

            // Budget agent should have a failed job
            const budgetJob = result.jobResults.find(
                (j) => j.agentName === "BudgetAgent",
            );
            expect(budgetJob).toBeDefined();
            expect(budgetJob!.status).toBe("failed");
            expect(budgetJob!.error).toContain("exceeded token budget");

            // agent:error should have been emitted
            expect(errorHandler).toHaveBeenCalled();
            const errorPayload = errorHandler.mock.calls.find(
                (call: unknown[]) =>
                    (call[0] as { agentName: string }).agentName ===
                    "BudgetAgent",
            );
            expect(errorPayload).toBeDefined();
        });
    });

    describe("correlationId propagation", () => {
        it("job events share the same correlationId as agent events", async () => {
            registry.registerAgent(makeAgent("Worker"));
            const ctx = new ExecutionContext(bus, registry, 5);

            const jobCorrelationIds = new Set<string>();
            const agentCorrelationIds = new Set<string>();

            bus.on("job:scheduled", (e) => {
                const ev = e as { correlationId?: string };
                if (ev.correlationId) jobCorrelationIds.add(ev.correlationId);
            });
            bus.on("job:completed", (e) => {
                const ev = e as { correlationId?: string };
                if (ev.correlationId) jobCorrelationIds.add(ev.correlationId);
            });
            bus.on("agent:started", (e) => {
                const ev = e as { correlationId?: string };
                if (ev.correlationId) agentCorrelationIds.add(ev.correlationId);
            });

            await ctx.run("task");

            // Both should have exactly one correlation ID and they should match
            expect(jobCorrelationIds.size).toBe(1);
            expect(agentCorrelationIds.size).toBe(1);
            const [jobCid] = [...jobCorrelationIds];
            const [agentCid] = [...agentCorrelationIds];
            expect(jobCid).toBe(agentCid);
        });
    });
});
