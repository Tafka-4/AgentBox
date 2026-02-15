import { randomUUID } from "node:crypto";
import type { EventBus } from "./event-bus.js";
import type { Claim, ClaimLink, ClaimLinkType } from "./types.js";

/** Summary of the claim graph after finalization. */
export interface ClaimSummary {
    /** Total number of claims. */
    total: number;
    /** High-confidence claims with no unresolved challenges. */
    consensus: string[];
    /** Statements that have active challenges. */
    conflicts: string[];
    /** All claims ordered by confidence (descending). */
    claims: Claim[];
}

/**
 * Shared memory structure for the claim/reasoning graph.
 * Agents collaboratively build a knowledge graph of assertions,
 * each backed by evidence and linked by support/challenge relationships.
 */
export class ClaimGraph {
    private claims = new Map<string, Claim>();
    private eventBus: EventBus;

    constructor(eventBus: EventBus) {
        this.eventBus = eventBus;
    }

    /** Add a new claim to the graph. */
    addClaim(
        statement: string,
        author: string,
        evidence: string[] = [],
        confidence = 0.5,
    ): Claim {
        const claim: Claim = {
            id: randomUUID(),
            statement,
            evidence,
            confidence,
            author,
            links: [],
            createdAt: new Date().toISOString(),
        };

        this.claims.set(claim.id, claim);
        this.eventBus.emit("claim:created", { claim });
        return claim;
    }

    /** Retrieve a claim by ID. */
    getClaim(id: string): Claim | undefined {
        return this.claims.get(id);
    }

    /** List all claims. */
    listClaims(): Claim[] {
        return Array.from(this.claims.values());
    }

    /**
     * Add a "challenges" link from `challengerClaimId` to `targetClaimId`.
     * Also lowers the target claim's confidence.
     */
    challengeClaim(
        targetClaimId: string,
        challengerClaimId: string,
    ): void {
        this.addLink(targetClaimId, challengerClaimId, "challenges");
        // Lower the target's confidence when challenged
        const target = this.claims.get(targetClaimId);
        if (target) {
            target.confidence = Math.max(0, target.confidence - 0.1);
        }
        this.eventBus.emit("claim:challenged", {
            claimId: targetClaimId,
            challengerId: challengerClaimId,
        });
    }

    /**
     * Add a "supports" link from `supporterClaimId` to `targetClaimId`.
     * Also raises the target claim's confidence.
     */
    supportClaim(
        targetClaimId: string,
        supporterClaimId: string,
    ): void {
        this.addLink(targetClaimId, supporterClaimId, "supports");
        // Raise the target's confidence when supported
        const target = this.claims.get(targetClaimId);
        if (target) {
            target.confidence = Math.min(1, target.confidence + 0.1);
        }
        this.eventBus.emit("claim:supported", {
            claimId: targetClaimId,
            supporterId: supporterClaimId,
        });
    }

    /** Internal: add a typed link to both claims. */
    private addLink(
        targetId: string,
        sourceId: string,
        type: ClaimLinkType,
    ): void {
        const target = this.claims.get(targetId);
        const source = this.claims.get(sourceId);
        if (!target || !source) {
            throw new Error(
                `Claim not found: ${!target ? targetId : sourceId}`,
            );
        }

        const link: ClaimLink = { targetClaimId: targetId, type };
        source.links.push(link);
    }

    /**
     * Summarize the claim graph.
     * - **consensus**: claims with confidence ≥ 0.7 and no active challenges.
     * - **conflicts**: claims with at least one "challenges" link.
     */
    summarize(): ClaimSummary {
        const all = this.listClaims();
        const challengedIds = new Set<string>();

        for (const claim of all) {
            for (const link of claim.links) {
                if (link.type === "challenges") {
                    challengedIds.add(link.targetClaimId);
                }
            }
        }

        const consensus = all
            .filter((c) => c.confidence >= 0.7 && !challengedIds.has(c.id))
            .map((c) => c.statement);

        const conflicts = all
            .filter((c) => challengedIds.has(c.id))
            .map((c) => c.statement);

        return {
            total: all.length,
            consensus,
            conflicts,
            claims: [...all].sort((a, b) => b.confidence - a.confidence),
        };
    }

    /** Clear all claims. */
    clear(): void {
        this.claims.clear();
    }
}
