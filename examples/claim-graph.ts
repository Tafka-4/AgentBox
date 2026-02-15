/**
 * Claim Graph Example
 *
 * Demonstrates the shared reasoning memory: adding claims,
 * challenging/supporting them, and summarizing into consensus/conflicts.
 *
 * Usage: npx tsx examples/claim-graph.ts
 */
import { ClaimGraph, EventBus } from "../src/index.js";

function main() {
    const bus = new EventBus();
    const graph = new ClaimGraph(bus);

    // ── 1. Listen for claim events ──────────────────────────────────────────
    bus.on("claim:created", (e) => {
        console.log(`  📝 Claim created: "${e.claim.statement}" (conf: ${e.claim.confidence})`);
    });
    bus.on("claim:challenged", (e) => {
        console.log(`  ⚔️  Claim ${e.claimId.slice(0, 8)}... challenged by ${e.challengerId.slice(0, 8)}...`);
    });
    bus.on("claim:supported", (e) => {
        console.log(`  🤝 Claim ${e.claimId.slice(0, 8)}... supported by ${e.supporterId.slice(0, 8)}...`);
    });

    // ── 2. Agents add claims to the shared graph ────────────────────────────
    // addClaim(statement, author, evidence[], confidence)
    console.log("\n▶ Adding initial claims:\n");

    const claim1 = graph.addClaim(
        "TypeScript adoption has increased 40% YoY in enterprise.",
        "Researcher",
        ["Stack Overflow survey 2025"],
        0.85,
    );

    const claim2 = graph.addClaim(
        "Python remains the dominant language for ML/AI workloads.",
        "Researcher",
        ["GitHub Octoverse report"],
        0.92,
    );

    const claim3 = graph.addClaim(
        "TypeScript is replacing Python in ML pipelines.",
        "Analyst",
        [],
        0.55,
    );

    // ── 3. Agents challenge or support claims ───────────────────────────────
    // challengeClaim(targetClaimId, challengerClaimId) — both are claim IDs
    // supportClaim(targetClaimId, supporterClaimId) — both are claim IDs
    console.log("\n▶ Deliberation phase:\n");

    // The researcher's Python claim challenges the analyst's replacement claim
    graph.challengeClaim(claim3.id, claim2.id);
    console.log(`     → Claim3 confidence after challenge: ${graph.getClaim(claim3.id)?.confidence}`);

    // The analyst's claim supports the enterprise adoption claim
    graph.supportClaim(claim1.id, claim3.id);
    console.log(`     → Claim1 confidence after support: ${graph.getClaim(claim1.id)?.confidence}`);

    // ── 4. Summarize the graph into consensus and conflicts ─────────────────
    console.log("\n▶ Summary:\n");

    const summary = graph.summarize();

    console.log("  Consensus (confidence ≥ 0.7, no challenges):");
    if (summary.consensus.length === 0) {
        console.log("    (none)");
    } else {
        for (const c of summary.consensus) {
            console.log(`    ✓ ${c}`);
        }
    }

    console.log("\n  Conflicts (challenged claims):");
    if (summary.conflicts.length === 0) {
        console.log("    (none)");
    } else {
        for (const c of summary.conflicts) {
            console.log(`    ✗ ${c}`);
        }
    }

    console.log(`\n  Total claims: ${summary.claims.length}`);
    for (const c of summary.claims) {
        console.log(`    • [${c.confidence.toFixed(2)}] ${c.statement} (by ${c.author})`);
    }
}

main();
