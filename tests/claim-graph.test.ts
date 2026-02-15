import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClaimGraph } from "../src/claim-graph.js";
import { EventBus } from "../src/event-bus.js";

describe("ClaimGraph", () => {
    let bus: EventBus;
    let graph: ClaimGraph;

    beforeEach(() => {
        bus = new EventBus();
        graph = new ClaimGraph(bus);
    });

    it("addClaim stores and returns a claim with all fields", () => {
        const claim = graph.addClaim(
            "The sky is blue",
            "Researcher",
            ["observation"],
            0.8,
        );

        expect(claim.id).toBeTypeOf("string");
        expect(claim.statement).toBe("The sky is blue");
        expect(claim.author).toBe("Researcher");
        expect(claim.evidence).toEqual(["observation"]);
        expect(claim.confidence).toBe(0.8);
        expect(claim.links).toEqual([]);
        expect(claim.createdAt).toBeTypeOf("string");
    });

    it("addClaim emits claim:created event", () => {
        const handler = vi.fn();
        bus.on("claim:created", handler);

        graph.addClaim("X", "A");

        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0][0].claim.statement).toBe("X");
    });

    it("getClaim retrieves by ID", () => {
        const claim = graph.addClaim("X", "A");
        expect(graph.getClaim(claim.id)).toBe(claim);
    });

    it("getClaim returns undefined for unknown ID", () => {
        expect(graph.getClaim("nonexistent")).toBeUndefined();
    });

    it("listClaims returns all claims", () => {
        graph.addClaim("A", "a1");
        graph.addClaim("B", "a2");
        graph.addClaim("C", "a3");
        expect(graph.listClaims()).toHaveLength(3);
    });

    it("challengeClaim lowers target confidence and adds link", () => {
        const target = graph.addClaim("Earth is flat", "BadAgent", [], 0.6);
        const challenger = graph.addClaim(
            "Earth is round",
            "GoodAgent",
            ["science"],
            0.9,
        );

        graph.challengeClaim(target.id, challenger.id);

        // Target confidence should decrease by 0.1
        expect(target.confidence).toBeCloseTo(0.5);
        // Challenger should have a link to target
        expect(challenger.links).toHaveLength(1);
        expect(challenger.links[0].type).toBe("challenges");
        expect(challenger.links[0].targetClaimId).toBe(target.id);
    });

    it("challengeClaim emits claim:challenged event", () => {
        const handler = vi.fn();
        bus.on("claim:challenged", handler);

        const target = graph.addClaim("X", "A");
        const challenger = graph.addClaim("Y", "B");
        graph.challengeClaim(target.id, challenger.id);

        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0][0].claimId).toBe(target.id);
        expect(handler.mock.calls[0][0].challengerId).toBe(challenger.id);
    });

    it("supportClaim raises target confidence and adds link", () => {
        const target = graph.addClaim("Water is wet", "A", [], 0.5);
        const supporter = graph.addClaim("Confirmed", "B", ["experiment"], 0.8);

        graph.supportClaim(target.id, supporter.id);

        expect(target.confidence).toBeCloseTo(0.6);
        expect(supporter.links).toHaveLength(1);
        expect(supporter.links[0].type).toBe("supports");
        expect(supporter.links[0].targetClaimId).toBe(target.id);
    });

    it("supportClaim emits claim:supported event", () => {
        const handler = vi.fn();
        bus.on("claim:supported", handler);

        const target = graph.addClaim("X", "A");
        const supporter = graph.addClaim("Y", "B");
        graph.supportClaim(target.id, supporter.id);

        expect(handler).toHaveBeenCalledOnce();
    });

    it("confidence is clamped between 0 and 1", () => {
        const c1 = graph.addClaim("X", "A", [], 0.05);
        const c2 = graph.addClaim("Challenger", "B");
        graph.challengeClaim(c1.id, c2.id);
        expect(c1.confidence).toBeGreaterThanOrEqual(0);

        const c3 = graph.addClaim("Y", "A", [], 0.95);
        const c4 = graph.addClaim("Supporter", "B");
        graph.supportClaim(c3.id, c4.id);
        expect(c3.confidence).toBeLessThanOrEqual(1);
    });

    it("throws when linking nonexistent claims", () => {
        const c1 = graph.addClaim("X", "A");
        expect(() => graph.challengeClaim(c1.id, "nonexistent")).toThrow(
            "Claim not found",
        );
        expect(() => graph.challengeClaim("nonexistent", c1.id)).toThrow(
            "Claim not found",
        );
    });

    describe("summarize()", () => {
        it("returns consensus for high-confidence unchallenged claims", () => {
            graph.addClaim("Gravity exists", "A", [], 0.9);
            graph.addClaim("Water is wet", "B", [], 0.8);
            graph.addClaim("Uncertain thing", "C", [], 0.3);

            const summary = graph.summarize();
            expect(summary.total).toBe(3);
            expect(summary.consensus).toContain("Gravity exists");
            expect(summary.consensus).toContain("Water is wet");
            expect(summary.consensus).not.toContain("Uncertain thing");
            expect(summary.conflicts).toHaveLength(0);
        });

        it("marks challenged claims as conflicts", () => {
            const target = graph.addClaim("Earth is flat", "A", [], 0.9);
            const challenger = graph.addClaim("Earth is round", "B", [], 0.95);
            graph.challengeClaim(target.id, challenger.id);

            const summary = graph.summarize();
            expect(summary.conflicts).toContain("Earth is flat");
            // The challenged claim should NOT be in consensus
            expect(summary.consensus).not.toContain("Earth is flat");
        });

        it("sorts claims by confidence descending", () => {
            graph.addClaim("Low", "A", [], 0.2);
            graph.addClaim("High", "B", [], 0.9);
            graph.addClaim("Mid", "C", [], 0.5);

            const summary = graph.summarize();
            expect(summary.claims[0].statement).toBe("High");
            expect(summary.claims[1].statement).toBe("Mid");
            expect(summary.claims[2].statement).toBe("Low");
        });
    });

    it("clear() removes all claims", () => {
        graph.addClaim("A", "x");
        graph.addClaim("B", "y");
        graph.clear();
        expect(graph.listClaims()).toHaveLength(0);
    });
});
