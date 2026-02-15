import type { EventBus } from "./event-bus.js";
import type { ClaimGraph } from "./claim-graph.js";
import type { MessageRouter } from "./message-router.js";
import type { Scheduler } from "./scheduler.js";
import type { Registry } from "./registry.js";
import type { PolicyEnforcer } from "./policy-enforcer.js";
import { AgentTool } from "./tool.js";
import type { LLMClient } from "./llm-client.js";
import { AgentMemory } from "./agent-memory.js";
import type { SharedMemory } from "./shared-memory.js";
import { ConversationHistory } from "./conversation-history.js";
import type {
    AgentDefinition,
    AgentMessage,
    AgentRuntimeAPI,
    ChatMessage,
    ChatRequest,
    ChatResponse,
    Claim,
    ConversationSummary,
    MemoryEntry,
    MemoryQueryOptions,
    TeamConfig,
} from "./types.js";

/**
 * Concrete implementation of `AgentRuntimeAPI`.
 * Each agent receives its own `AgentRuntime` during execution, providing
 * scoped access to the shared infrastructure (claims, messaging, tools,
 * memory) and the ability to dynamically spawn sub-agents and create teams.
 */
export class AgentRuntime implements AgentRuntimeAPI {
    readonly agentName: string;
    readonly definition: AgentDefinition;

    private eventBus: EventBus;
    private claimGraph: ClaimGraph;
    private messageRouter: MessageRouter;
    private scheduler: Scheduler;
    private registry: Registry;
    private policyEnforcer: PolicyEnforcer;
    private tools: AgentTool[];
    private correlationId: string;
    private _llmClient?: LLMClient;
    private _llmModel?: string;

    /** Per-agent working memory. */
    private memory: AgentMemory;
    /** Shared cross-agent memory. */
    private sharedMemory: SharedMemory;
    /** Per-agent conversation history. */
    private history: ConversationHistory;

    constructor(opts: {
        definition: AgentDefinition;
        eventBus: EventBus;
        claimGraph: ClaimGraph;
        messageRouter: MessageRouter;
        scheduler: Scheduler;
        registry: Registry;
        policyEnforcer: PolicyEnforcer;
        tools: AgentTool[];
        correlationId: string;
        sharedMemory: SharedMemory;
        llmClient?: LLMClient;
        llmModel?: string;
    }) {
        this.agentName = opts.definition.name;
        this.definition = opts.definition;
        this.eventBus = opts.eventBus;
        this.claimGraph = opts.claimGraph;
        this.messageRouter = opts.messageRouter;
        this.scheduler = opts.scheduler;
        this.registry = opts.registry;
        this.policyEnforcer = opts.policyEnforcer;
        this.tools = opts.tools;
        this.correlationId = opts.correlationId;
        this._llmClient = opts.llmClient;
        this._llmModel = opts.llmModel;
        this.sharedMemory = opts.sharedMemory;

        // Create per-agent memory and conversation history
        this.memory = new AgentMemory(
            this.agentName,
            this.eventBus,
            this.correlationId,
        );
        this.history = new ConversationHistory(
            this.agentName,
            this.eventBus,
            this.correlationId,
        );
    }

    // ── Claim Graph ──────────────────────────────────────────────────────

    addClaim(
        statement: string,
        evidence: string[] = [],
        confidence = 0.5,
    ): Claim {
        return this.claimGraph.addClaim(
            statement,
            this.agentName,
            evidence,
            confidence,
        );
    }

    challengeClaim(targetClaimId: string, challengerClaimId: string): void {
        this.claimGraph.challengeClaim(targetClaimId, challengerClaimId);
    }

    supportClaim(targetClaimId: string, supporterClaimId: string): void {
        this.claimGraph.supportClaim(targetClaimId, supporterClaimId);
    }

    listClaims(): Claim[] {
        return this.claimGraph.listClaims();
    }

    // ── Messaging ────────────────────────────────────────────────────────

    sendMessage(to: string, payload: unknown): AgentMessage {
        return this.messageRouter.sendMessage(this.agentName, to, payload);
    }

    // ── Tools ────────────────────────────────────────────────────────────

    async executeTool(toolName: string, input: unknown): Promise<unknown> {
        const tool = this.tools.find((t) => t.name === toolName);
        if (!tool) {
            throw new Error(
                `Agent "${this.agentName}": tool "${toolName}" not found.`,
            );
        }

        // Check tool allowlist
        const allowlist = this.definition.policy.toolAllowlist;
        if (allowlist && !allowlist.includes(toolName)) {
            throw new Error(
                `Agent "${this.agentName}": tool "${toolName}" is not on the allowlist.`,
            );
        }

        return tool.execute(input);
    }

    listTools(): string[] {
        return this.tools.map((t) => t.name);
    }

    // ── Working Memory ───────────────────────────────────────────────────

    getMemory(key: string): unknown | undefined {
        return this.memory.get(key);
    }

    setMemory(
        key: string,
        value: unknown,
        opts?: { namespace?: string; ttl?: number },
    ): void {
        this.memory.set(key, value, opts);
    }

    deleteMemory(key: string): boolean {
        return this.memory.delete(key);
    }

    listMemory(opts?: MemoryQueryOptions): MemoryEntry[] {
        return this.memory.list(opts);
    }

    // ── Shared Memory ────────────────────────────────────────────────────

    getShared(key: string): unknown | undefined {
        return this.sharedMemory.get(key);
    }

    setShared(
        key: string,
        value: unknown,
        opts?: { namespace?: string; ttl?: number },
    ): void {
        this.sharedMemory.set(this.agentName, key, value, opts);
    }

    listShared(opts?: MemoryQueryOptions): MemoryEntry[] {
        return this.sharedMemory.list(opts);
    }

    // ── Conversation History ─────────────────────────────────────────────

    getHistory(): ChatMessage[] {
        return this.history.getMessages();
    }

    getHistorySummary(): ConversationSummary | null {
        return this.history.getLatestSummary();
    }

    appendHistory(message: ChatMessage): void {
        this.history.append(message);
    }

    async summarizeHistory(model?: string): Promise<ConversationSummary> {
        return this.history.summarize(
            this._llmClient,
            model ?? this._llmModel,
        );
    }

    // ── Dynamic Scaling ──────────────────────────────────────────────────

    async spawnAgent(
        definition: AgentDefinition,
        task: string,
    ): Promise<unknown> {
        // Register the agent if not already registered
        if (!this.registry.hasAgent(definition.name)) {
            this.registry.registerAgent(definition);
        }

        // Register budget
        this.policyEnforcer.registerAgent(definition.name, definition.policy);

        // Set up message handler
        this.messageRouter.registerHandler(definition.name, () => {});
        if (definition.policy) {
            this.messageRouter.setPolicy(definition.name, definition.policy);
        }

        // Emit spawned event
        this.eventBus.emit(
            "agent:spawned",
            { agentName: definition.name, parentAgent: this.agentName },
            this.correlationId,
        );

        // Resolve tools for the spawned agent
        const agentTools = definition.tools
            .map((name) => this.registry.getTool(name))
            .filter(Boolean)
            .map((t) => new AgentTool(t!));

        // Enqueue the job
        const handle = this.scheduler.enqueue(
            definition.name,
            task,
            async () => {
                this.policyEnforcer.checkBudget(definition.name);

                this.eventBus.emit(
                    "agent:started",
                    { agentName: definition.name },
                    this.correlationId,
                );

                // Create a runtime for the spawned agent
                const childRuntime = new AgentRuntime({
                    definition,
                    eventBus: this.eventBus,
                    claimGraph: this.claimGraph,
                    messageRouter: this.messageRouter,
                    scheduler: this.scheduler,
                    registry: this.registry,
                    policyEnforcer: this.policyEnforcer,
                    tools: agentTools,
                    correlationId: this.correlationId,
                    sharedMemory: this.sharedMemory,
                    llmClient: this._llmClient,
                    llmModel: this._llmModel,
                });

                let result: unknown;
                if (definition.executor) {
                    // Run custom executor
                    this.eventBus.emit(
                        "agent:thinking",
                        { agentName: definition.name },
                        this.correlationId,
                    );
                    result = await definition.executor(childRuntime, task);
                } else {
                    // Default stub
                    this.eventBus.emit(
                        "agent:thinking",
                        { agentName: definition.name },
                        this.correlationId,
                    );
                    result = {
                        agentName: definition.name,
                        task,
                        toolCount: agentTools.length,
                    };
                }

                this.eventBus.emit(
                    "agent:idle",
                    { agentName: definition.name },
                    this.correlationId,
                );

                return result;
            },
            this.correlationId,
        );

        return handle.promise;
    }

    async createTeam(
        config: TeamConfig,
        task: string,
    ): Promise<unknown[]> {
        // Emit team creation event
        this.eventBus.emit(
            "team:created",
            {
                teamName: config.name,
                manager: config.manager.name,
                memberCount: config.members.length,
            },
            this.correlationId,
        );

        // Apply shared team policy to members that don't have their own
        const membersWithPolicy = config.members.map((member) => ({
            ...member,
            policy: {
                ...config.policy,
                ...member.policy,
            },
        }));

        // Create the manager with a wrapped executor that has access to members
        const managerDef: AgentDefinition = {
            ...config.manager,
            policy: {
                ...config.policy,
                ...config.manager.policy,
            },
            executor: config.manager.executor ?? (async (runtime, teamTask) => {
                // Default manager behavior: spawn all members in parallel
                const results = await Promise.allSettled(
                    membersWithPolicy.map((member) =>
                        runtime.spawnAgent(member, teamTask),
                    ),
                );
                return results.map((r) =>
                    r.status === "fulfilled" ? r.value : { error: (r.reason as Error).message },
                );
            }),
        };

        // Spawn the manager agent — it will coordinate the team
        const managerResult = await this.spawnAgent(managerDef, task);

        // Return the result(s) as an array
        return Array.isArray(managerResult) ? managerResult : [managerResult];
    }

    // ── LLM ──────────────────────────────────────────────────────────────

    async chat(model: string, request: ChatRequest): Promise<ChatResponse> {
        if (!this._llmClient) {
            throw new Error(
                `Agent "${this.agentName}": no LLM client configured.`,
            );
        }
        return this._llmClient.chat(model || this._llmModel || "", request);
    }
}
