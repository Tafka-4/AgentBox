/**
 * Tool Usage Example
 *
 * Demonstrates defining custom tools with Zod schemas,
 * executing them with input validation, and JSON serialization for LLMs.
 *
 * Usage: npx tsx examples/tool-usage.ts
 */
import { AgentTool } from "../src/index.js";
import { z } from "zod";

async function main() {
    // ── 1. Define tools with Zod input schemas ──────────────────────────────

    const searchTool = new AgentTool({
        name: "web-search",
        description: "Search the web for information",
        inputSchema: z.object({
            query: z.string().min(1).describe("Search query"),
            maxResults: z.number().int().min(1).max(20).default(5),
            language: z.enum(["en", "ko", "ja"]).default("en"),
        }),
        execute: async (input) => {
            const { query, maxResults, language } = input as {
                query: string;
                maxResults: number;
                language: string;
            };
            console.log(`  Searching for "${query}" (max ${maxResults}, lang=${language})`);
            return {
                results: [
                    { title: `Result for: ${query}`, url: "https://example.com" },
                ],
            };
        },
    });

    const calculatorTool = new AgentTool({
        name: "calculator",
        description: "Perform mathematical calculations",
        inputSchema: z.object({
            expression: z.string().describe("Mathematical expression to evaluate"),
        }),
        execute: async (input) => {
            const { expression } = input as { expression: string };
            // Simple eval for demo — in production, use a proper math parser
            return { result: expression, computed: true };
        },
    });

    const writeFileTool = new AgentTool({
        name: "write-file",
        description: "Write content to a file",
        inputSchema: z.object({
            path: z.string().min(1),
            content: z.string(),
            encoding: z.enum(["utf-8", "base64"]).default("utf-8"),
        }),
        execute: async (input) => {
            const { path, content } = input as { path: string; content: string };
            console.log(`  Would write ${content.length} chars to ${path}`);
            return { written: true, path };
        },
    });

    // ── 2. Execute with validated input ─────────────────────────────────────
    console.log("▶ Running tools with valid input:\n");

    const searchResult = await searchTool.execute({
        query: "AgentBox framework",
        maxResults: 3,
        language: "en",
    });
    console.log("  Search result:", JSON.stringify(searchResult, null, 2));

    // ── 3. Input validation catches bad input ───────────────────────────────
    console.log("\n▶ Testing input validation:\n");

    try {
        await searchTool.execute({ query: "", maxResults: -1 });
    } catch (err) {
        console.log(`  ✓ Validation error: ${(err as Error).message.slice(0, 80)}...`);
    }

    // ── 4. JSON serialization for LLM function calling ──────────────────────
    console.log("\n▶ Tool descriptions for LLM function calling:\n");

    for (const tool of [searchTool, calculatorTool, writeFileTool]) {
        const json = tool.toJSON();
        console.log(`  📦 ${json.name}:`);
        console.log(`     ${json.description}`);
        console.log(`     Parameters: ${JSON.stringify(json.parameters).slice(0, 80)}...`);
        console.log();
    }

    // ── 5. Set auto-generated descriptions ──────────────────────────────────
    console.log("▶ Auto-description update:\n");

    calculatorTool.setDescription("An improved description from the auto-describer.");
    console.log(`  Updated description: "${calculatorTool.toJSON().description}"`);
}

main().catch(console.error);
