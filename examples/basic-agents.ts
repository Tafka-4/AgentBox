/**
 * Basic Agents Example
 *
 * Demonstrates how to set up AgentBox with multiple agents and run a task.
 * Shows the AgentBuilder DSL for defining agents with prompts, tools, and policies.
 *
 * Usage: npx tsx examples/basic-agents.ts
 */
import { AgentBox } from "../src/index.js";
import { z } from "zod";

async function main() {
    // ── 1. Create the AgentBox instance ──────────────────────────────────────
    // A "MasterAgent" is automatically created for orchestration.
    const box = new AgentBox();

    // ── 2. Register a tool that agents can use ──────────────────────────────
    box.defineTool({
        name: "summarize",
        description: "Summarize the given text into key bullet points",
        inputSchema: z.object({
            text: z.string().describe("The text to summarize"),
            maxPoints: z.number().optional().describe("Maximum number of points"),
        }),
        execute: async (input) => {
            const { text, maxPoints = 3 } = input as { text: string; maxPoints?: number };
            const sentences = text.split(". ").slice(0, maxPoints);
            return sentences.map((s) => `• ${s.trim()}`).join("\n");
        },
    });

    // ── 3. Define agents using the builder DSL ──────────────────────────────
    box.defineAgent("Researcher")
        .prompt("You are a research agent. Analyze tasks and produce findings.")
        .tools(["summarize"])
        .policy({
            maxTokens: 10000,
            maxMessagesPerSecond: 5,
        })
        .build();

    box.defineAgent("Reviewer")
        .prompt("You review claims and challenge weak reasoning.")
        .policy({
            maxTokens: 5000,
            toolAllowlist: [], // Reviewer has no tools — deliberation only
        })
        .build();

    box.defineAgent("Writer")
        .prompt("You produce the final written output.")
        .tools(["summarize"])
        .policy({
            maxParallel: 1, // Writer runs sequentially
        })
        .build();

    // ── 4. Subscribe to events for observability ────────────────────────────
    box.on("agent:started", (e) => {
        console.log(`🚀 Agent started: ${e.agentName}`);
    });
    box.on("agent:idle", (e) => {
        console.log(`💤 Agent idle: ${e.agentName}`);
    });
    box.on("job:completed", (e) => {
        console.log(`✅ Job completed: ${e.job.agentName} (${e.job.status})`);
    });

    // ── 5. Run the task ─────────────────────────────────────────────────────
    console.log("▶ Starting AgentBox run...\n");

    const result = await box.run(
        "Analyze the impact of AI on software engineering",
        { maxParallel: 3 },
    );

    // ── 6. Inspect results ──────────────────────────────────────────────────
    console.log("\n─── Results ───");
    console.log(`Status: ${result.status}`);
    console.log(`Claims: ${result.claims.length}`);
    console.log(`Consensus: ${result.consensus || "(none)"}`);
    console.log(`Jobs completed: ${result.jobResults.length}`);
    for (const job of result.jobResults) {
        console.log(`  • ${job.agentName}: ${job.status}`);
    }
}

main().catch(console.error);
