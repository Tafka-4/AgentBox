import type { EventBus } from "./event-bus.js";
import type { Policy } from "./types.js";

/** Per-agent budget tracking state. */
interface AgentBudget {
    policy: Policy;
    tokensUsed: number;
    costUsed: number;
}

/**
 * Enforces budget constraints (maxTokens / maxCost) at the framework level.
 *
 * The enforcer tracks per-agent usage and throws before execution
 * if the budget would be exceeded. It also listens for `llm:response`
 * events to automatically accumulate token usage.
 */
export class PolicyEnforcer {
    private budgets = new Map<string, AgentBudget>();
    private eventBus: EventBus;
    /** Cleanup handle for the event listener. */
    private boundHandler: ((event: unknown) => void) | null = null;

    constructor(eventBus: EventBus) {
        this.eventBus = eventBus;
    }

    /** Register an agent's policy for budget tracking. */
    registerAgent(agentName: string, policy: Policy): void {
        this.budgets.set(agentName, {
            policy,
            tokensUsed: 0,
            costUsed: 0,
        });
    }

    /**
     * Check whether an agent is within its budget.
     * @throws if the agent has exceeded its `maxTokens` or `maxCost` policy.
     */
    checkBudget(agentName: string): void {
        const budget = this.budgets.get(agentName);
        if (!budget) return;

        const { policy, tokensUsed, costUsed } = budget;

        if (policy.maxTokens !== undefined && tokensUsed >= policy.maxTokens) {
            throw new Error(
                `Agent "${agentName}" exceeded token budget: ` +
                `${tokensUsed}/${policy.maxTokens} tokens used.`,
            );
        }

        if (policy.maxCost !== undefined && costUsed >= policy.maxCost) {
            throw new Error(
                `Agent "${agentName}" exceeded cost budget: ` +
                `$${costUsed.toFixed(4)}/$${policy.maxCost.toFixed(4)} used.`,
            );
        }
    }

    /** Record token usage for an agent. */
    addTokenUsage(agentName: string, tokens: number): void {
        const budget = this.budgets.get(agentName);
        if (budget) {
            budget.tokensUsed += tokens;
        }
    }

    /** Record cost for an agent. */
    addCostUsage(agentName: string, cost: number): void {
        const budget = this.budgets.get(agentName);
        if (budget) {
            budget.costUsed += cost;
        }
    }

    /** Get current usage snapshot for an agent. */
    getUsage(agentName: string): { tokensUsed: number; costUsed: number } | undefined {
        const budget = this.budgets.get(agentName);
        if (!budget) return undefined;
        return { tokensUsed: budget.tokensUsed, costUsed: budget.costUsed };
    }

    /** Start listening for llm:response events to auto-accumulate usage. */
    startListening(resolveAgent: (correlationId: string) => string | undefined): void {
        this.boundHandler = (event: unknown) => {
            const e = event as {
                correlationId?: string;
                usage?: { totalTokens?: number };
            };
            if (e?.correlationId && e?.usage?.totalTokens) {
                const agentName = resolveAgent(e.correlationId);
                if (agentName) {
                    this.addTokenUsage(agentName, e.usage.totalTokens);
                }
            }
        };
        this.eventBus.on("llm:response", this.boundHandler);
    }

    /** Stop listening and clear state. */
    clear(): void {
        if (this.boundHandler) {
            this.eventBus.off("llm:response", this.boundHandler);
            this.boundHandler = null;
        }
        this.budgets.clear();
    }
}
