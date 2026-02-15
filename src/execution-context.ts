import { randomUUID } from "node:crypto";
import type { EventBus } from "./event-bus.js";
import type { Registry } from "./registry.js";
import { Scheduler } from "./scheduler.js";
import { ClaimGraph } from "./claim-graph.js";
import { MessageRouter } from "./message-router.js";
import { PolicyEnforcer } from "./policy-enforcer.js";
import { MCPClient } from "./mcp-client.js";
import { AgentTool } from "./tool.js";
import { AgentRuntime } from "./agent-runtime.js";
import { SharedMemory } from "./shared-memory.js";
import { ToolDescriptionCache, ensureToolDescriptions } from "./tool-description.js";
import type { LLMClient } from "./llm-client.js";
import type {
    AgentDefinition,
    AgentMessage,
    ExecutionResult,
    RunStatus,
    TeamConfig,
} from "./types.js";

/**
 * ExecutionContext manages the lifecycle of a single `run()`.
 * It owns a Scheduler, ClaimGraph, MessageRouter, and MCP connections
 * for the duration of the execution pipeline.
 *
 * Pipeline: Validate → Connect MCP → Materialize agents → Execute → Finalize
 */
export class ExecutionContext {
    private scheduler: Scheduler;
    private claimGraph: ClaimGraph;
    private messageRouter: MessageRouter;
    private policyEnforcer: PolicyEnforcer;
    private mcpClients: MCPClient[] = [];
    private descriptionCache = new ToolDescriptionCache();
    private sharedMemory!: SharedMemory;
    private status: RunStatus = "idle";
    /** Correlation ID shared across all events emitted in this run. */
    private correlationId: string = "";
    /** Optional LLM client for tool auto-description. */
    private _llmClient?: LLMClient;
    /** Model string to use for auto-description LLM calls. */
    private _llmModel?: string;

    readonly eventBus: EventBus;
    readonly registry: Registry;

    constructor(
        eventBus: EventBus,
        registry: Registry,
        maxParallel = 5,
    ) {
        this.eventBus = eventBus;
        this.registry = registry;
        this.scheduler = new Scheduler(eventBus, maxParallel);
        this.claimGraph = new ClaimGraph(eventBus);
        this.messageRouter = new MessageRouter(eventBus);
        this.policyEnforcer = new PolicyEnforcer(eventBus);
        this.sharedMemory = new SharedMemory(eventBus, "");
    }

    /** Set an LLM client for tool auto-description. */
    setLLMClient(client: LLMClient, model: string): void {
        this._llmClient = client;
        this._llmModel = model;
    }

    /** Access the claim graph for this execution. */
    get claims(): ClaimGraph {
        return this.claimGraph;
    }

    /** Access the message router for this execution. */
    get messages(): MessageRouter {
        return this.messageRouter;
    }

    /** Current run status. */
    get runStatus(): RunStatus {
        return this.status;
    }

    // ── Pipeline ─────────────────────────────────────────────────────────

    /**
     * Execute the full run pipeline.
     * @param task - The user's task description.
     */
    async run(task: string): Promise<ExecutionResult> {
        try {
            this.status = "running";
            this.correlationId = randomUUID();
            this.sharedMemory.setCorrelationId(this.correlationId);

            // Emit run:started
            this.eventBus.emit("run:started", { task }, this.correlationId);

            // 1. Validate
            this.validate();

            // 2. Connect MCP servers
            await this.connectMCPServers();

            // 3. Materialize agents (resolve tools, set up message handlers)
            const agents = this.materializeAgents();

            // 4. Auto-describe tools that lack descriptions
            await this.autoDescribeTools(agents);

            // 5. Execute — enqueue jobs for all agents
            await this.executeAgents(agents, task);

            // 6. Finalize — summarize claim graph
            const summary = this.claimGraph.summarize();

            // Collect all jobs from the scheduler
            const allJobs = this.scheduler.getAllJobs();

            this.status = "completed";

            // Emit run:completed
            this.eventBus.emit("run:completed", { status: this.status }, this.correlationId);

            return {
                status: "completed",
                claims: summary.claims,
                consensus: summary.consensus.join("; "),
                conflicts: summary.conflicts,
                jobResults: allJobs,
            };
        } catch (err) {
            this.status = "failed";
            this.eventBus.emit("run:completed", { status: this.status }, this.correlationId);
            throw err;
        } finally {
            await this.cleanup();
        }
    }

    /** Validate that all agent references are resolvable and policies are satisfied. */
    private validate(): void {
        for (const agent of this.registry.listAgents()) {
            // Validate tool references
            for (const toolName of agent.tools) {
                if (!this.registry.hasTool(toolName)) {
                    throw new Error(
                        `Agent "${agent.name}" references unknown tool "${toolName}".`,
                    );
                }
            }
            // Validate MCP references
            for (const mcpName of agent.mcpServers) {
                if (!this.registry.hasMCP(mcpName)) {
                    throw new Error(
                        `Agent "${agent.name}" references unknown MCP "${mcpName}".`,
                    );
                }
            }
            // Validate tool allowlist policy
            this.validateToolAllowlist(agent);
        }
    }

    /**
     * If the agent has a `toolAllowlist` policy, verify that all its
     * assigned tools are on the allowlist.
     */
    private validateToolAllowlist(agent: AgentDefinition): void {
        const allowlist = agent.policy.toolAllowlist;
        if (!allowlist || allowlist.length === 0) return;

        const allowSet = new Set(allowlist);
        for (const toolName of agent.tools) {
            if (!allowSet.has(toolName)) {
                throw new Error(
                    `Agent "${agent.name}" tool "${toolName}" is not on the toolAllowlist.`,
                );
            }
        }
    }

    /** Connect all registered MCP servers. */
    private async connectMCPServers(): Promise<void> {
        const mcps = this.registry.listMCPs();
        for (const def of mcps) {
            const client = new MCPClient(def, this.eventBus);
            await client.connect();
            this.mcpClients.push(client);

            // Register MCP tools into the tool registry
            const tools = await client.listTools();
            for (const tool of tools) {
                if (!this.registry.hasTool(tool.name)) {
                    this.registry.registerTool(tool);
                }
            }
        }
    }

    /** Resolve agent definitions into materialized agent instances with tools. */
    private materializeAgents(): Array<{
        definition: AgentDefinition;
        tools: AgentTool[];
    }> {
        const agents = this.registry.listAgents();
        return agents.map((def) => {
            const tools = def.tools
                .map((name) => this.registry.getTool(name))
                .filter(Boolean)
                .map((t) => new AgentTool(t!));

            // Set up message handler
            this.messageRouter.registerHandler(def.name, (_msg: AgentMessage) => {
                // In a real implementation, this would feed the message
                // into the agent's execution loop.
            });

            // Set rate limit policy
            if (def.policy) {
                this.messageRouter.setPolicy(def.name, def.policy);
            }

            return { definition: def, tools };
        });
    }

    /** Auto-describe tools that lack descriptions. */
    private async autoDescribeTools(
        agents: Array<{ definition: AgentDefinition; tools: AgentTool[] }>,
    ): Promise<void> {
        for (const agent of agents) {
            await ensureToolDescriptions(
                agent.tools,
                agent.definition.prompt,
                this.descriptionCache,
                this._llmClient,
                this._llmModel,
            );
        }
    }

    /** Execute all agents by enqueueing jobs in the scheduler. */
    private async executeAgents(
        agents: Array<{ definition: AgentDefinition; tools: AgentTool[] }>,
        task: string,
    ): Promise<void> {
        // Register budgets for policy enforcement
        for (const agent of agents) {
            this.policyEnforcer.registerAgent(
                agent.definition.name,
                agent.definition.policy,
            );
        }

        const handles = agents.map((agent) => ({
            agentName: agent.definition.name,
            handle: this.scheduler.enqueue(
                agent.definition.name,
                task,
                async () => {
                    // Check budget before starting
                    this.policyEnforcer.checkBudget(agent.definition.name);

                    this.eventBus.emit("agent:started", {
                        agentName: agent.definition.name,
                    }, this.correlationId);

                    // Create a runtime for this agent
                    const runtime = new AgentRuntime({
                        definition: agent.definition,
                        eventBus: this.eventBus,
                        claimGraph: this.claimGraph,
                        messageRouter: this.messageRouter,
                        scheduler: this.scheduler,
                        registry: this.registry,
                        policyEnforcer: this.policyEnforcer,
                        tools: agent.tools,
                        correlationId: this.correlationId,
                        sharedMemory: this.sharedMemory,
                        llmClient: this._llmClient,
                        llmModel: this._llmModel,
                    });

                    let result: unknown;

                    if (agent.definition.executor) {
                        // Run the custom executor
                        this.eventBus.emit("agent:thinking", {
                            agentName: agent.definition.name,
                        }, this.correlationId);
                        result = await agent.definition.executor(runtime, task);
                    } else {
                        // Default stub executor
                        this.eventBus.emit("agent:thinking", {
                            agentName: agent.definition.name,
                        }, this.correlationId);
                        result = {
                            agentName: agent.definition.name,
                            task,
                            toolCount: agent.tools.length,
                            prompt: agent.definition.prompt,
                        };
                    }

                    this.eventBus.emit("agent:idle", {
                        agentName: agent.definition.name,
                    }, this.correlationId);

                    return result;
                },
                this.correlationId,
            ),
        }));

        const results = await Promise.allSettled(
            handles.map((h) => h.handle.promise),
        );
        // Log errors for failed agents with their actual name
        for (let i = 0; i < results.length; i++) {
            const r = results[i];
            if (r.status === "rejected") {
                const err = r.reason instanceof Error ? r.reason.message : String(r.reason);
                this.eventBus.emit("agent:error", {
                    agentName: handles[i].agentName,
                    error: err,
                }, this.correlationId);
            }
        }
    }

    // ── Dynamic Scaling ──────────────────────────────────────────────────

    /**
     * Spawn a new agent at runtime and execute it with the given task.
     * Can be called from outside or from within an agent's executor.
     */
    async spawnAgent(
        definition: AgentDefinition,
        task: string,
        parentAgent = "__system__",
    ): Promise<unknown> {
        // Register if new
        if (!this.registry.hasAgent(definition.name)) {
            this.registry.registerAgent(definition);
        }

        this.policyEnforcer.registerAgent(definition.name, definition.policy);

        this.messageRouter.registerHandler(definition.name, () => {});
        if (definition.policy) {
            this.messageRouter.setPolicy(definition.name, definition.policy);
        }

        this.eventBus.emit(
            "agent:spawned",
            { agentName: definition.name, parentAgent },
            this.correlationId,
        );

        const agentTools = definition.tools
            .map((name) => this.registry.getTool(name))
            .filter(Boolean)
            .map((t) => new AgentTool(t!));

        const handle = this.scheduler.enqueue(
            definition.name,
            task,
            async () => {
                this.policyEnforcer.checkBudget(definition.name);
                this.eventBus.emit("agent:started", { agentName: definition.name }, this.correlationId);

                const runtime = new AgentRuntime({
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
                this.eventBus.emit("agent:thinking", { agentName: definition.name }, this.correlationId);

                if (definition.executor) {
                    result = await definition.executor(runtime, task);
                } else {
                    result = {
                        agentName: definition.name,
                        task,
                        toolCount: agentTools.length,
                    };
                }

                this.eventBus.emit("agent:idle", { agentName: definition.name }, this.correlationId);
                return result;
            },
            this.correlationId,
        );

        return handle.promise;
    }

    /**
     * Create a team with a manager and members at runtime.
     */
    async createTeam(
        config: TeamConfig,
        task: string,
        parentAgent = "__system__",
    ): Promise<unknown[]> {
        this.eventBus.emit(
            "team:created",
            {
                teamName: config.name,
                manager: config.manager.name,
                memberCount: config.members.length,
            },
            this.correlationId,
        );

        const membersWithPolicy = config.members.map((m) => ({
            ...m,
            policy: { ...config.policy, ...m.policy },
        }));

        const managerDef: AgentDefinition = {
            ...config.manager,
            policy: { ...config.policy, ...config.manager.policy },
            executor: config.manager.executor ?? (async (runtime, teamTask) => {
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

        const managerResult = await this.spawnAgent(managerDef, task, parentAgent);
        return Array.isArray(managerResult) ? managerResult : [managerResult];
    }

    // ── Control API ──────────────────────────────────────────────────────

    /** Pause execution — running jobs continue, new ones are held. */
    pause(): void {
        this.scheduler.pause();
        this.status = "paused";
    }

    /** Resume execution. */
    resume(): void {
        this.scheduler.resume();
        this.status = "running";
    }

    /** Cancel the entire execution. */
    cancel(): void {
        this.scheduler.cancelAll();
        this.status = "cancelled";
    }

    /** Inject a message into a running agent's inbox. */
    injectMessage(
        to: string,
        payload: unknown,
        from = "__system__",
    ): AgentMessage {
        return this.messageRouter.sendMessage(from, to, payload);
    }

    // ── Cleanup ──────────────────────────────────────────────────────────

    /** Disconnect all MCP clients and clean up resources. */
    private async cleanup(): Promise<void> {
        this.policyEnforcer.clear();
        for (const client of this.mcpClients) {
            try {
                await client.disconnect();
            } catch {
                // Best-effort cleanup
            }
        }
        this.mcpClients = [];
    }
}
