/**
 * Event Streaming Example
 *
 * Demonstrates the EventBus for real-time observability:
 * typed events, wildcard subscriptions, correlation IDs,
 * and unsubscription for cleanup.
 *
 * Usage: npx tsx examples/event-streaming.ts
 */
import { AgentBox, EventBus, ClaimGraph } from "../src/index.js";

async function main() {
    const bus = new EventBus();

    // ── 1. Subscribe to specific event types ────────────────────────────────
    console.log("▶ Typed event subscriptions:\n");

    bus.on("claim:created", (e) => {
        console.log(`  📝 [claim:created] "${e.claim.statement}" (id: ${e.claim.id.slice(0, 8)})`);
    });

    bus.on("job:scheduled", (e) => {
        console.log(`  📋 [job:scheduled] ${e.job.agentName} — "${e.job.task}"`);
    });

    bus.on("job:completed", (e) => {
        console.log(`  ✅ [job:completed] ${e.job.agentName} — ${e.job.status}`);
    });

    // ── 2. Wildcard subscription (see all events) ───────────────────────────
    console.log("▶ Setting up wildcard listener:\n");

    const wildcardLog: string[] = [];
    const wildcardHandler = (type: string, _event: unknown) => {
        wildcardLog.push(type);
    };
    bus.onAny(wildcardHandler);

    // ── 3. Fire some events by using components ─────────────────────────────
    console.log("▶ Firing events via ClaimGraph:\n");

    const graph = new ClaimGraph(bus);

    // ClaimGraph emits claim:created
    graph.addClaim("Concurrency improves throughput.", "Researcher", [], 0.8);
    graph.addClaim("Lock contention can negate concurrency gains.", "Analyst", [], 0.65);

    // ── 4. CorrelationId and timestamp are auto-injected ────────────────────
    console.log("\n▶ Event metadata (auto-injected):\n");

    bus.on("claim:created", (e) => {
        console.log(`  correlationId: ${e.correlationId}`);
        console.log(`  timestamp:     ${e.timestamp}`);
    });
    graph.addClaim("Test claim for metadata.", "Verifier", [], 0.5);

    // ── 5. Unsubscribe to stop receiving events ─────────────────────────────
    console.log("\n▶ Unsubscribing wildcard listener:\n");
    bus.offAny(wildcardHandler);

    // This event won't appear in wildcardLog
    graph.addClaim("This won't appear in wildcard.", "Silent", [], 0.3);

    console.log(`  Wildcard captured ${wildcardLog.length} events: [${wildcardLog.join(", ")}]`);
    console.log(`  (Last claim not captured after unsubscribe)`);

    // ── 6. Full AgentBox integration ────────────────────────────────────────
    console.log("\n▶ Full AgentBox event streaming:\n");

    const box = new AgentBox();
    box.defineAgent("Worker").prompt("I work.").build();

    // Stream all events via the EventBus
    const allEvents: string[] = [];
    box.eventBus.onAny((type: string) => {
        allEvents.push(type);
    });

    const result = await box.run("Demonstrate event streaming");
    console.log(`  Run complete: ${result.status}`);
    console.log(`  Events captured: ${allEvents.length}`);
    console.log(`  Event types: ${[...new Set(allEvents)].join(", ")}`);
}

main().catch(console.error);
