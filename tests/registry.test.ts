import { describe, it, expect } from "vitest";
import { z } from "zod";
import { Registry } from "../src/registry.js";
import type { AgentDefinition, ToolDefinition, MCPDefinition } from "../src/types.js";

function makeAgent(name: string): AgentDefinition {
    return { name, prompt: "test", tools: [], policy: {}, mcpServers: [] };
}

function makeTool(name: string): ToolDefinition {
    return {
        name,
        description: "test tool",
        inputSchema: z.object({ query: z.string() }),
        execute: async (input) => input,
    };
}

function makeMCP(name: string): MCPDefinition {
    return { name, transport: "sse", url: "http://localhost:3000" };
}

describe("Registry", () => {
    // ── Agents ────────────────────────────────────────────────────────
    describe("agents", () => {
        it("registers and retrieves an agent", () => {
            const r = new Registry();
            const def = makeAgent("A");
            r.registerAgent(def);
            expect(r.getAgent("A")).toBe(def);
        });

        it("hasAgent returns true for registered and false for unknown", () => {
            const r = new Registry();
            r.registerAgent(makeAgent("A"));
            expect(r.hasAgent("A")).toBe(true);
            expect(r.hasAgent("B")).toBe(false);
        });

        it("listAgents returns all registered", () => {
            const r = new Registry();
            r.registerAgent(makeAgent("A"));
            r.registerAgent(makeAgent("B"));
            expect(r.listAgents()).toHaveLength(2);
        });

        it("throws on duplicate agent registration", () => {
            const r = new Registry();
            r.registerAgent(makeAgent("A"));
            expect(() => r.registerAgent(makeAgent("A"))).toThrow(
                'Agent "A" is already registered.',
            );
        });

        it("getAgent returns undefined for unregistered name", () => {
            const r = new Registry();
            expect(r.getAgent("nonexistent")).toBeUndefined();
        });
    });

    // ── Tools ─────────────────────────────────────────────────────────
    describe("tools", () => {
        it("registers and retrieves a tool", () => {
            const r = new Registry();
            const def = makeTool("search");
            r.registerTool(def);
            expect(r.getTool("search")).toBe(def);
        });

        it("hasTool returns correct values", () => {
            const r = new Registry();
            r.registerTool(makeTool("search"));
            expect(r.hasTool("search")).toBe(true);
            expect(r.hasTool("nope")).toBe(false);
        });

        it("listTools returns all registered", () => {
            const r = new Registry();
            r.registerTool(makeTool("a"));
            r.registerTool(makeTool("b"));
            expect(r.listTools()).toHaveLength(2);
        });

        it("throws on duplicate tool registration", () => {
            const r = new Registry();
            r.registerTool(makeTool("a"));
            expect(() => r.registerTool(makeTool("a"))).toThrow(
                'Tool "a" is already registered.',
            );
        });
    });

    // ── MCP ───────────────────────────────────────────────────────────
    describe("MCPs", () => {
        it("registers and retrieves an MCP", () => {
            const r = new Registry();
            const def = makeMCP("server1");
            r.registerMCP(def);
            expect(r.getMCP("server1")).toBe(def);
        });

        it("hasMCP returns correct values", () => {
            const r = new Registry();
            r.registerMCP(makeMCP("s1"));
            expect(r.hasMCP("s1")).toBe(true);
            expect(r.hasMCP("s2")).toBe(false);
        });

        it("listMCPs returns all registered", () => {
            const r = new Registry();
            r.registerMCP(makeMCP("a"));
            r.registerMCP(makeMCP("b"));
            expect(r.listMCPs()).toHaveLength(2);
        });

        it("throws on duplicate MCP registration", () => {
            const r = new Registry();
            r.registerMCP(makeMCP("a"));
            expect(() => r.registerMCP(makeMCP("a"))).toThrow(
                'MCP "a" is already registered.',
            );
        });
    });
});
