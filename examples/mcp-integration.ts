/**
 * MCP Integration Example
 *
 * Demonstrates connecting to Model Context Protocol servers,
 * registering their tools, and using them alongside local tools.
 *
 * Usage: npx tsx examples/mcp-integration.ts
 *
 * Note: This example shows the API but won't connect to real servers
 * unless you have MCP servers running locally.
 */
import { AgentBox } from "../src/index.js";
import { z } from "zod";

async function main() {
    const box = new AgentBox();

    // ── 1. Register a local tool ────────────────────────────────────────────
    console.log("▶ Registering local tools:\n");

    box.defineTool({
        name: "local-search",
        description: "Search local documents",
        inputSchema: z.object({
            query: z.string(),
            directory: z.string().default("/docs"),
        }),
        execute: async (input) => {
            const { query, directory } = input as { query: string; directory: string };
            return { results: [`Found "${query}" in ${directory}`] };
        },
    });
    console.log("  ✓ Registered: local-search");

    // ── 2. Register MCP server definitions ──────────────────────────────────
    console.log("\n▶ Registering MCP server definitions:\n");

    // SSE transport — connects to a remote MCP server over HTTP
    box.defineMCP("code-analysis", {
        transport: "sse",
        url: "http://localhost:3001/mcp",
    });
    console.log("  ✓ Registered MCP (SSE): code-analysis → http://localhost:3001/mcp");

    // Stdio transport — launches a local process
    box.defineMCP("file-system", {
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/sandbox"],
    });
    console.log("  ✓ Registered MCP (stdio): file-system → npx @mcp/server-filesystem");

    // ── 3. Define agents that use MCP tools ─────────────────────────────────
    console.log("\n▶ Defining agents with MCP dependencies:\n");

    box.defineAgent("CodeReviewer")
        .prompt("You review code using analysis tools and file system access.")
        .tools(["local-search"])        // local tools
        .mcpServers(["code-analysis"])  // MCP-provided tools added at runtime
        .policy({
            maxTokens: 20000,
            toolAllowlist: ["local-search", "code-analysis/analyze", "code-analysis/lint"],
        })
        .build();
    console.log("  ✓ Agent: CodeReviewer (local-search + code-analysis MCP)");

    box.defineAgent("FileManager")
        .prompt("You manage files in the sandbox directory.")
        .mcpServers(["file-system"])    // all tools come from MCP
        .build();
    console.log("  ✓ Agent: FileManager (file-system MCP)");

    // ── 4. Event observation for MCP lifecycle ──────────────────────────────
    console.log("\n▶ MCP lifecycle events:\n");

    box.on("mcp:connected", (e) => {
        console.log(`  🔗 MCP connected: ${e.name}`);
    });
    box.on("mcp:error", (e) => {
        console.log(`  ❌ MCP error (${e.name}): ${e.error}`);
    });

    // ── 5. Run (will fail if MCP servers aren't running) ────────────────────
    console.log("▶ Attempting run (expected to fail without MCP servers):\n");

    try {
        const result = await box.run("Review the project codebase", {
            maxParallel: 2,
        });
        console.log(`  Status: ${result.status}`);
        console.log(`  Jobs: ${result.jobResults.length}`);
    } catch (err) {
        console.log(`  ⚠ Expected error: ${(err as Error).message.slice(0, 100)}`);
        console.log("  (This is expected — MCP servers are not running in this demo)");
    }

    // ── 6. Show how MCP tools get namespaced ────────────────────────────────
    console.log("\n▶ MCP tool naming convention:\n");
    console.log("  When an MCP server named 'code-analysis' exposes a tool 'analyze',");
    console.log("  it becomes 'code-analysis/analyze' in the AgentBox registry.");
    console.log("  This prevents name collisions between different MCP servers.");
}

main().catch(console.error);
