import { describe, it, expect, beforeEach } from "vitest";
import { PolicyEnforcer } from "../src/policy-enforcer.js";
import { EventBus } from "../src/event-bus.js";

describe("PolicyEnforcer", () => {
    let enforcer: PolicyEnforcer;
    let bus: EventBus;

    beforeEach(() => {
        bus = new EventBus();
        enforcer = new PolicyEnforcer(bus);
    });

    describe("token budget", () => {
        it("allows usage within budget", () => {
            enforcer.registerAgent("A", { maxTokens: 1000 });
            enforcer.addTokenUsage("A", 500);

            // Should not throw
            expect(() => enforcer.checkBudget("A")).not.toThrow();
        });

        it("throws when token budget is exceeded", () => {
            enforcer.registerAgent("A", { maxTokens: 100 });
            enforcer.addTokenUsage("A", 100);

            expect(() => enforcer.checkBudget("A")).toThrow(
                'Agent "A" exceeded token budget: 100/100 tokens used.',
            );
        });

        it("accumulates usage across multiple calls", () => {
            enforcer.registerAgent("A", { maxTokens: 100 });
            enforcer.addTokenUsage("A", 40);
            enforcer.addTokenUsage("A", 40);
            expect(() => enforcer.checkBudget("A")).not.toThrow();

            enforcer.addTokenUsage("A", 30);
            expect(() => enforcer.checkBudget("A")).toThrow("exceeded token budget");
        });
    });

    describe("cost budget", () => {
        it("allows cost within budget", () => {
            enforcer.registerAgent("A", { maxCost: 10 });
            enforcer.addCostUsage("A", 5.0);

            expect(() => enforcer.checkBudget("A")).not.toThrow();
        });

        it("throws when cost budget is exceeded", () => {
            enforcer.registerAgent("A", { maxCost: 1.5 });
            enforcer.addCostUsage("A", 1.5);

            expect(() => enforcer.checkBudget("A")).toThrow(
                'Agent "A" exceeded cost budget',
            );
        });
    });

    describe("agent isolation", () => {
        it("tracks budgets independently per agent", () => {
            enforcer.registerAgent("A", { maxTokens: 100 });
            enforcer.registerAgent("B", { maxTokens: 200 });

            enforcer.addTokenUsage("A", 100);

            // A should fail, B should pass
            expect(() => enforcer.checkBudget("A")).toThrow();
            expect(() => enforcer.checkBudget("B")).not.toThrow();
        });
    });

    describe("no policy", () => {
        it("does not throw when agent has no budget limits", () => {
            enforcer.registerAgent("A", {});
            enforcer.addTokenUsage("A", 999999);
            enforcer.addCostUsage("A", 999999);

            expect(() => enforcer.checkBudget("A")).not.toThrow();
        });

        it("does not throw for unregistered agents", () => {
            expect(() => enforcer.checkBudget("unknown")).not.toThrow();
        });
    });

    describe("getUsage()", () => {
        it("returns usage for registered agent", () => {
            enforcer.registerAgent("A", { maxTokens: 100 });
            enforcer.addTokenUsage("A", 42);
            enforcer.addCostUsage("A", 0.5);

            const usage = enforcer.getUsage("A");
            expect(usage?.tokensUsed).toBe(42);
            expect(usage?.costUsed).toBe(0.5);
        });

        it("returns undefined for unregistered agent", () => {
            expect(enforcer.getUsage("nonexistent")).toBeUndefined();
        });
    });

    describe("clear()", () => {
        it("removes all budget tracking", () => {
            enforcer.registerAgent("A", { maxTokens: 100 });
            enforcer.addTokenUsage("A", 50);
            enforcer.clear();

            expect(enforcer.getUsage("A")).toBeUndefined();
        });
    });
});
