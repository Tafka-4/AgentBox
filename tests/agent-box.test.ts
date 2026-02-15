import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { AgentBox } from "../src/agent-box.js";
import type { ToolDefinition } from "../src/types.js";

function makeTool(name: string): ToolDefinition {
    return {
        name,
        description: `Tool ${name}`,
        inputSchema: z.object({ q: z.string() }),
        execute: async (input) => input,
    };
}

describe("AgentBox", () => {
    it("auto-creates MasterAgent on construction", () => {
        const box = new AgentBox();
        const master = box.registry.getAgent("MasterAgent");
        expect(master).toBeDefined();
        expect(master!.name).toBe("MasterAgent");
    });

    it("throws when defining an agent named MasterAgent", () => {
        const box = new AgentBox();
        expect(() => box.defineAgent("MasterAgent")).toThrow(
            '"MasterAgent" is a reserved agent name.',
        );
    });

    describe("AgentBuilder DSL", () => {
        it("builds an agent with prompt, tools, and policy", () => {
            const box = new AgentBox();
            const tool = makeTool("search");

            const def = box
                .defineAgent("Researcher")
                .prompt("Find information about X")
                .tools([tool])
                .policy({ maxParallel: 2, maxTokens: 1000 })
                .build();

            expect(def.name).toBe("Researcher");
            expect(def.prompt).toBe("Find information about X");
            expect(def.tools).toEqual(["search"]);
            expect(def.policy.maxParallel).toBe(2);
            expect(def.policy.maxTokens).toBe(1000);

            // Agent should be registered
            expect(box.registry.hasAgent("Researcher")).toBe(true);
            // Tool should be auto-registered
            expect(box.registry.hasTool("search")).toBe(true);
        });

        it("accepts tool names as strings", () => {
            const box = new AgentBox();
            box.defineTool(makeTool("search"));

            const def = box
                .defineAgent("A")
                .prompt("X")
                .tools(["search"])
                .build();

            expect(def.tools).toEqual(["search"]);
        });

        it("mcpServers() sets MCP dependencies", () => {
            const box = new AgentBox();
            const def = box
                .defineAgent("A")
                .prompt("X")
                .mcpServers(["server1", "server2"])
                .build();

            expect(def.mcpServers).toEqual(["server1", "server2"]);
        });

        it("policy merges with defaults", () => {
            const box = new AgentBox();
            const def = box
                .defineAgent("A")
                .prompt("X")
                .policy({ maxParallel: 3 })
                .policy({ maxTokens: 500 })
                .build();

            expect(def.policy.maxParallel).toBe(3);
            expect(def.policy.maxTokens).toBe(500);
        });
    });

    describe("defineTool()", () => {
        it("registers a tool directly", () => {
            const box = new AgentBox();
            const tool = makeTool("calc");
            box.defineTool(tool);
            expect(box.registry.hasTool("calc")).toBe(true);
        });
    });

    describe("defineMCP()", () => {
        it("registers an MCP definition", () => {
            const box = new AgentBox();
            const def = box.defineMCP("server1", {
                transport: "sse",
                url: "http://localhost:8080",
            });

            expect(def.name).toBe("server1");
            expect(def.transport).toBe("sse");
            expect(box.registry.hasMCP("server1")).toBe(true);
        });
    });

    describe("run()", () => {
        it("completes a basic run and returns ExecutionResult", async () => {
            const box = new AgentBox();
            box.defineAgent("Worker")
                .prompt("Do stuff")
                .tools([])
                .build();

            const result = await box.run("Test task");

            expect(result.status).toBe("completed");
            expect(result.claims).toBeDefined();
            expect(result.consensus).toBeDefined();
            expect(result.conflicts).toBeDefined();
            expect(result.jobResults).toBeDefined();
        });

        it("emits agent lifecycle events during run", async () => {
            const box = new AgentBox();
            box.defineAgent("Worker").prompt("Do stuff").build();

            const started = vi.fn();
            const thinking = vi.fn();
            const idle = vi.fn();

            box.on("agent:started", started);
            box.on("agent:thinking", thinking);
            box.on("agent:idle", idle);

            await box.run("Test");

            // MasterAgent + Worker = 2 agents started
            expect(started).toHaveBeenCalled();
            expect(thinking).toHaveBeenCalled();
            expect(idle).toHaveBeenCalled();
        });
    });

    describe("Control API", () => {
        it("pause/resume/cancel are no-ops when no context", () => {
            const box = new AgentBox();
            // Should not throw
            box.pause();
            box.resume();
            box.cancel();
        });

        it("injectMessage throws when no active execution", () => {
            const box = new AgentBox();
            expect(() => box.injectMessage("A", "data")).toThrow(
                "No active execution context.",
            );
        });
    });

    describe("Event API", () => {
        it("on/off subscribe and unsubscribe", () => {
            const box = new AgentBox();
            const handler = vi.fn();

            box.on("agent:started", handler);
            box.eventBus.emit("agent:started", { agentName: "test" });
            expect(handler).toHaveBeenCalledOnce();

            box.off("agent:started", handler);
            box.eventBus.emit("agent:started", { agentName: "test2" });
            expect(handler).toHaveBeenCalledOnce(); // Still 1
        });
    });
});
