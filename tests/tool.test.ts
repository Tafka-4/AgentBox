import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { AgentTool } from "../src/tool.js";
import {
    ToolDescriptionCache,
    generateToolDescription,
    ensureToolDescriptions,
} from "../src/tool-description.js";
import type { ToolDefinition } from "../src/types.js";

function makeToolDef(name: string, desc?: string): ToolDefinition {
    return {
        name,
        description: desc,
        inputSchema: z.object({ query: z.string() }),
        execute: async (input: unknown) => `result: ${(input as { query: string }).query}`,
    };
}

describe("AgentTool", () => {
    it("validates input and executes successfully", async () => {
        const tool = new AgentTool(makeToolDef("search", "Search tool"));
        const result = await tool.execute({ query: "hello" });
        expect(result).toBe("result: hello");
    });

    it("throws ZodError on invalid input", async () => {
        const tool = new AgentTool(makeToolDef("search", "X"));
        await expect(tool.execute({ query: 42 })).rejects.toThrow();
    });

    it("throws ZodError on missing required field", async () => {
        const tool = new AgentTool(makeToolDef("search", "X"));
        await expect(tool.execute({})).rejects.toThrow();
    });

    it("toJSON() serializes name, description, and parameters", () => {
        const tool = new AgentTool(makeToolDef("search", "Find things"));
        const json = tool.toJSON();

        expect(json.name).toBe("search");
        expect(json.description).toBe("Find things");
        expect(json.parameters).toEqual({
            type: "object",
            properties: {
                query: { type: "string" },
            },
            required: ["query"],
        });
    });

    it("toJSON() works without description", () => {
        const tool = new AgentTool(makeToolDef("search"));
        expect(tool.toJSON().description).toBeUndefined();
    });

    it("setDescription() mutates the description", () => {
        const tool = new AgentTool(makeToolDef("search"));
        expect(tool.description).toBeUndefined();
        tool.setDescription("Updated description");
        expect(tool.description).toBe("Updated description");
    });
});

describe("ToolDescriptionCache", () => {
    let cache: ToolDescriptionCache;

    beforeEach(() => {
        cache = new ToolDescriptionCache();
    });

    it("set/get/has work correctly", () => {
        cache.set("key1", "description1");
        expect(cache.has("key1")).toBe(true);
        expect(cache.get("key1")).toBe("description1");
        expect(cache.has("key2")).toBe(false);
        expect(cache.get("key2")).toBeUndefined();
    });

    it("computeHash produces consistent keys", () => {
        const tool = new AgentTool(makeToolDef("search", "S"));
        const h1 = cache.computeHash(tool, "prompt1");
        const h2 = cache.computeHash(tool, "prompt1");
        expect(h1).toBe(h2);
    });

    it("computeHash produces different keys for different prompts", () => {
        const tool = new AgentTool(makeToolDef("search", "S"));
        const h1 = cache.computeHash(tool, "prompt1");
        const h2 = cache.computeHash(tool, "prompt2");
        expect(h1).not.toBe(h2);
    });

    it("clear() empties the cache", () => {
        cache.set("a", "b");
        cache.clear();
        expect(cache.has("a")).toBe(false);
    });
});

describe("generateToolDescription", () => {
    it("generates and caches a description for a tool without one", async () => {
        const cache = new ToolDescriptionCache();
        const tool = new AgentTool(makeToolDef("search"));

        const desc = await generateToolDescription(tool, "agent prompt", cache);
        expect(desc).toContain("search");
        expect(desc.length).toBeGreaterThan(0);

        // Should be cached
        const key = cache.computeHash(tool, "agent prompt");
        expect(cache.get(key)).toBe(desc);
    });

    it("returns cached description on subsequent calls", async () => {
        const cache = new ToolDescriptionCache();
        const tool = new AgentTool(makeToolDef("search"));

        const d1 = await generateToolDescription(tool, "p", cache);
        const d2 = await generateToolDescription(tool, "p", cache);
        expect(d1).toBe(d2);
    });
});

describe("ensureToolDescriptions", () => {
    it("fills in descriptions for tools missing them", async () => {
        const cache = new ToolDescriptionCache();
        const tool1 = new AgentTool(makeToolDef("a"));
        const tool2 = new AgentTool(makeToolDef("b", "already has one"));

        expect(tool1.description).toBeUndefined();
        expect(tool2.description).toBe("already has one");

        await ensureToolDescriptions([tool1, tool2], "prompt", cache);

        expect(tool1.description).toBeDefined();
        expect(tool1.description!.length).toBeGreaterThan(0);
        // tool2 should remain unchanged
        expect(tool2.description).toBe("already has one");
    });
});

describe("AgentTool.executeSource", () => {
    it("returns the stringified execute function body", () => {
        const tool = new AgentTool(makeToolDef("search"));
        const source = tool.executeSource;
        expect(source).toContain("result:");
        expect(source.length).toBeGreaterThan(10);
    });
});

describe("ToolDescriptionCache hash accuracy", () => {
    it("produces different hashes for same-named tools with different execute fns", () => {
        const cache = new ToolDescriptionCache();

        const defA: ToolDefinition = {
            name: "search",
            inputSchema: z.object({ q: z.string() }),
            execute: async (input) => `A: ${(input as { q: string }).q}`,
        };
        const toolA = new AgentTool(defA);

        const defB: ToolDefinition = {
            name: "search",
            inputSchema: z.object({ q: z.string() }),
            execute: async (input) => `B: ${(input as { q: string }).q}`,
        };
        const toolB = new AgentTool(defB);

        const hashA = cache.computeHash(toolA, "prompt");
        const hashB = cache.computeHash(toolB, "prompt");
        expect(hashA).not.toBe(hashB);
    });
});
