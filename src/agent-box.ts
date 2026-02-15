import type { Handler } from "mitt";
import { EventBus } from "./event-bus.js";
import { Registry } from "./registry.js";
import { ExecutionContext } from "./execution-context.js";
import type { LLMClient } from "./llm-client.js";
import type {
    AgentBoxEvents,
    AgentDefinition,
    AgentExecutor,
    ExecutionResult,
    MCPDefinition,
    MCPTransport,
    Policy,
    TeamConfig,
    ToolDefinition,
} from "./types.js";

// ─── Agent Builder ───────────────────────────────────────────────────────────

/** Fluent builder returned by `AgentBox.defineAgent()`. */
export class AgentBuilder {
    private definition: AgentDefinition;

    constructor(name: string, private registry: Registry) {
        this.definition = {
            name,
            prompt: "",
            tools: [],
            policy: {},
            mcpServers: [],
        };
    }

    /**
     * Set the agent's system prompt.
     * @param p - The prompt text that guides the agent's behavior.
     * @returns The builder for chaining.
     */
    prompt(p: string): this {
        this.definition.prompt = p;
        return this;
    }

    /**
     * Assign tools by name or ToolDefinition objects.
     * ToolDefinition objects are auto-registered in the registry if not already present.
     * @param t - Array of tool names (strings) or ToolDefinition objects.
     * @returns The builder for chaining.
     */
    tools(t: Array<string | ToolDefinition>): this {
        this.definition.tools = t.map((item) =>
            typeof item === "string" ? item : item.name,
        );
        // Auto-register ToolDefinitions that aren't registered yet
        for (const item of t) {
            if (typeof item !== "string" && !this.registry.hasTool(item.name)) {
                this.registry.registerTool(item);
            }
        }
        return this;
    }

    /**
     * Set policy constraints. Multiple calls merge with previous values.
     * @param p - Policy constraints (maxParallel, maxTokens, maxCost, etc.).
     * @returns The builder for chaining.
     */
    policy(p: Policy): this {
        this.definition.policy = { ...this.definition.policy, ...p };
        return this;
    }

    /** Declare MCP server dependencies. */
    mcpServers(names: string[]): this {
        this.definition.mcpServers = names;
        return this;
    }

    /**
     * Set a custom executor for this agent.
     * The executor receives an `AgentRuntimeAPI` and the task string,
     * providing access to claims, messaging, tools, and dynamic agent spawning.
     * @param fn - The executor function.
     * @returns The builder for chaining.
     */
    executor(fn: AgentExecutor): this {
        this.definition.executor = fn;
        return this;
    }

    /**
     * Finalize and register the agent in the registry.
     * @returns The completed agent definition.
     * @throws If an agent with the same name is already registered.
     */
    build(): AgentDefinition {
        this.registry.registerAgent(this.definition);
        return this.definition;
    }
}

// ─── AgentBox ────────────────────────────────────────────────────────────────

/** Reserved name for the master agent. */
const MASTER_AGENT_NAME = "MasterAgent";

/**
 * AgentBox is the primary entry point for the orchestration framework.
 *
 * @example
 * ```typescript
 * const box = new AgentBox();
 *
 * box.defineAgent("Researcher")
 *   .prompt("Search for X...")
 *   .tools([searchTool])
 *   .policy({ maxParallel: 2 })
 *   .build();
 *
 * const result = await box.run("Validate the hypothesis that...");
 * ```
 */
export class AgentBox {
    readonly registry: Registry;
    readonly eventBus: EventBus;
    private currentContext: ExecutionContext | null = null;
    private _llmClient?: LLMClient;
    private _llmModel?: string;

    constructor() {
        this.registry = new Registry();
        this.eventBus = new EventBus();

        // Auto-create MasterAgent
        this.registry.registerAgent({
            name: MASTER_AGENT_NAME,
            prompt:
                "You are the MasterAgent responsible for task decomposition, " +
                "dynamic agent scaling, and policy enforcement.",
            tools: [],
            policy: {},
            mcpServers: [],
        });
    }

    // ── DSL ──────────────────────────────────────────────────────────────

    /**
     * Set the LLM client used for tool auto-description.
     * When set, tools without descriptions will have descriptions
     * auto-generated via the specified model.
     * @param client - The LLM client instance.
     * @param model - Model string in `provider/model-name` format.
     */
    setLLMClient(client: LLMClient, model: string): void {
        this._llmClient = client;
        this._llmModel = model;
    }

    /**
     * Begin defining an agent using the builder pattern.
     * Call `.build()` on the returned builder to finalize registration.
     * @param name - Unique agent name. "MasterAgent" is reserved.
     * @returns An `AgentBuilder` for fluent configuration.
     * @throws If name is "MasterAgent" (reserved).
     */
    defineAgent(name: string): AgentBuilder {
        if (name === MASTER_AGENT_NAME) {
            throw new Error(
                `"${MASTER_AGENT_NAME}" is a reserved agent name.`,
            );
        }
        return new AgentBuilder(name, this.registry);
    }

    /**
     * Register an MCP server definition.
     */
    defineMCP(
        name: string,
        config: {
            transport: MCPTransport;
            url?: string;
            command?: string;
            args?: string[];
        },
    ): MCPDefinition {
        const def: MCPDefinition = { name, ...config };
        this.registry.registerMCP(def);
        return def;
    }

    /**
     * Register a tool definition directly.
     */
    defineTool(def: ToolDefinition): void {
        this.registry.registerTool(def);
    }

    // ── Execution ────────────────────────────────────────────────────────

    /**
     * Execute a task with all registered agents.
     * @param task - The user's task description.
     * @param options - Optional run configuration.
     * @returns The execution result with claims, consensus, conflicts, and job results.
     */
    async run(
        task: string,
        options?: { maxParallel?: number },
    ): Promise<ExecutionResult> {
        const ctx = new ExecutionContext(
            this.eventBus,
            this.registry,
            options?.maxParallel ?? 5,
        );

        // Pass LLM client for tool auto-description
        if (this._llmClient && this._llmModel) {
            ctx.setLLMClient(this._llmClient, this._llmModel);
        }

        this.currentContext = ctx;

        try {
            return await ctx.run(task);
        } finally {
            this.currentContext = null;
        }
    }

    // ── Control API ──────────────────────────────────────────────────────

    /** Pause the current execution. */
    pause(): void {
        this.currentContext?.pause();
    }

    /** Resume the current execution. */
    resume(): void {
        this.currentContext?.resume();
    }

    /** Cancel the current execution. */
    cancel(): void {
        this.currentContext?.cancel();
    }

    /** Inject a message into a running agent. */
    injectMessage(to: string, payload: unknown, from?: string): void {
        if (!this.currentContext) {
            throw new Error("No active execution context.");
        }
        this.currentContext.injectMessage(to, payload, from);
    }

    /**
     * Spawn a new agent dynamically during a running execution.
     * @throws If no execution is active.
     */
    async spawnAgent(
        definition: AgentDefinition,
        task: string,
    ): Promise<unknown> {
        if (!this.currentContext) {
            throw new Error("No active execution context.");
        }
        return this.currentContext.spawnAgent(definition, task);
    }

    /**
     * Create a team with a manager and member agents during a running execution.
     * @throws If no execution is active.
     */
    async createTeam(
        config: TeamConfig,
        task: string,
    ): Promise<unknown[]> {
        if (!this.currentContext) {
            throw new Error("No active execution context.");
        }
        return this.currentContext.createTeam(config, task);
    }

    // ── Events ───────────────────────────────────────────────────────────

    /** Subscribe to an event. */
    on<K extends keyof AgentBoxEvents>(
        type: K,
        handler: Handler<AgentBoxEvents[K]>,
    ): void {
        this.eventBus.on(type, handler);
    }

    /** Unsubscribe from an event. */
    off<K extends keyof AgentBoxEvents>(
        type: K,
        handler: Handler<AgentBoxEvents[K]>,
    ): void {
        this.eventBus.off(type, handler);
    }
}
