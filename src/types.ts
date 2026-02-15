import { z } from "zod";

// ─── Policies ────────────────────────────────────────────────────────────────

/** Policy constraints applied to an agent or the entire run. */
export interface Policy {
    /** Max number of parallel jobs this agent may run. */
    maxParallel?: number;
    /** Maximum token budget for this agent (undefined = unlimited). */
    maxTokens?: number;
    /** Maximum cost budget in USD (undefined = unlimited). */
    maxCost?: number;
    /** Allowlist of tool names this agent may invoke (undefined = all). */
    toolAllowlist?: string[];
    /** Max messages per second an agent may send (rate limit). */
    maxMessagesPerSecond?: number;
}

// ─── Tool Definitions ────────────────────────────────────────────────────────

/** A tool's core definition that can be provided to agents. */
export interface ToolDefinition<
    TInput = unknown,
    TOutput = unknown,
> {
    /** Unique tool name. */
    name: string;
    /** Human-readable description (auto-generated if omitted). */
    description?: string;
    /** Zod schema for input validation. */
    inputSchema: z.ZodType<TInput>;
    /** The function that executes the tool. */
    execute: (input: TInput) => Promise<TOutput>;
}

// ─── Agent Runtime API ───────────────────────────────────────────────────────

/**
 * Runtime API given to each agent's executor during execution.
 * Provides access to claims, messaging, tools, dynamic agent spawning,
 * and team management.
 */
export interface AgentRuntimeAPI {
    /** This agent's name. */
    readonly agentName: string;
    /** This agent's full definition. */
    readonly definition: AgentDefinition;

    // ── Claim Graph ──────────────────────────────────────────────────────

    /** Add a new claim to the shared reasoning graph. */
    addClaim(statement: string, evidence?: string[], confidence?: number): Claim;
    /** Challenge an existing claim. */
    challengeClaim(targetClaimId: string, challengerClaimId: string): void;
    /** Support an existing claim. */
    supportClaim(targetClaimId: string, supporterClaimId: string): void;
    /** List all claims in the graph. */
    listClaims(): Claim[];

    // ── Messaging ────────────────────────────────────────────────────────

    /** Send a message to another agent. */
    sendMessage(to: string, payload: unknown): AgentMessage;

    // ── Tools ────────────────────────────────────────────────────────────

    /** Execute a tool by name with validated input. */
    executeTool(toolName: string, input: unknown): Promise<unknown>;
    /** List available tool names. */
    listTools(): string[];

    // ── Dynamic Scaling ──────────────────────────────────────────────────

    /**
     * Spawn a new agent at runtime and execute it with the given task.
     * Returns the spawned agent's job result.
     */
    spawnAgent(definition: AgentDefinition, task: string): Promise<unknown>;

    /**
     * Create a team with a manager agent and worker agents.
     * The manager's executor receives its own AgentRuntimeAPI and can
     * coordinate the workers. Returns results from all team members.
     */
    createTeam(config: TeamConfig, task: string): Promise<unknown[]>;

    // ── Memory ────────────────────────────────────────────────────────────

    /** Get a value from this agent's working memory. */
    getMemory(key: string): unknown | undefined;
    /** Store a value in this agent's working memory. */
    setMemory(key: string, value: unknown, opts?: { namespace?: string; ttl?: number }): void;
    /** Delete a key from this agent's working memory. */
    deleteMemory(key: string): boolean;
    /** List entries in this agent's working memory. */
    listMemory(opts?: MemoryQueryOptions): MemoryEntry[];

    // ── Shared Memory ────────────────────────────────────────────────────

    /** Get a value from the shared cross-agent memory. */
    getShared(key: string): unknown | undefined;
    /** Store a value in the shared cross-agent memory. */
    setShared(key: string, value: unknown, opts?: { namespace?: string; ttl?: number }): void;
    /** List entries in the shared cross-agent memory. */
    listShared(opts?: MemoryQueryOptions): MemoryEntry[];

    // ── Conversation History ─────────────────────────────────────────────

    /** Get the full conversation history for this agent. */
    getHistory(): ChatMessage[];
    /** Get the latest summary of the conversation history, if any. */
    getHistorySummary(): ConversationSummary | null;
    /** Append a message to this agent's conversation history. */
    appendHistory(message: ChatMessage): void;
    /** Summarize the conversation history using an LLM. */
    summarizeHistory(model?: string): Promise<ConversationSummary>;

    // ── LLM ──────────────────────────────────────────────────────────────

    /** Send a chat request via the configured LLM client. */
    chat(model: string, request: ChatRequest): Promise<ChatResponse>;
}

// ─── Agent Definitions ───────────────────────────────────────────────────────

/**
 * Callback that defines an agent's execution logic.
 * Receives a runtime context giving access to claims, messaging, tools, and
 * dynamic agent spawning. Return value is stored as the job result.
 */
export type AgentExecutor = (
    runtime: AgentRuntimeAPI,
    task: string,
) => Promise<unknown>;

/** Full definition of an agent, produced by the DSL builder. */
export interface AgentDefinition {
    /** Unique name. "MasterAgent" is reserved. */
    name: string;
    /** System prompt that guides the agent. */
    prompt: string;
    /** Tool names available to this agent. */
    tools: string[];
    /** Policy constraints. */
    policy: Policy;
    /** MCP server names this agent may access. */
    mcpServers: string[];
    /**
     * Custom executor that runs when this agent is scheduled.
     * If omitted, the default stub executor is used.
     */
    executor?: AgentExecutor;
}

// ─── MCP Definitions ─────────────────────────────────────────────────────────

export type MCPTransport = "sse" | "stdio";

export interface MCPDefinition {
    /** Unique name for this MCP connection. */
    name: string;
    /** Transport type. */
    transport: MCPTransport;
    /** URL for SSE transport. */
    url?: string;
    /** Command for stdio transport. */
    command?: string;
    /** Args for stdio transport. */
    args?: string[];
}

/** A resource exposed by an MCP server. */
export interface MCPResource {
    /** Namespaced name: `serverName/resourceName`. */
    name: string;
    /** URI identifying the resource. */
    uri: string;
    /** Human-readable description. */
    description?: string;
    /** MIME type of the resource content. */
    mimeType?: string;
}

/** A prompt template exposed by an MCP server. */
export interface MCPPrompt {
    /** Namespaced name: `serverName/promptName`. */
    name: string;
    /** Human-readable description. */
    description?: string;
    /** Expected arguments for the prompt. */
    arguments?: Array<{
        name: string;
        description?: string;
        required?: boolean;
    }>;
}

// ─── Teams ───────────────────────────────────────────────────────────────────

/** Configuration for a dynamically created team of agents. */
export interface TeamConfig {
    /** Human-readable team name. */
    name: string;
    /** The manager agent definition that coordinates the team. */
    manager: AgentDefinition;
    /** Worker agent definitions managed by the manager. */
    members: AgentDefinition[];
    /** Shared policy applied to all team members (overridden by per-agent policies). */
    policy?: Policy;
}

// ─── Memory ──────────────────────────────────────────────────────────────────

/** A single entry in the agent memory system. */
export interface MemoryEntry {
    /** The key used to store this entry. */
    key: string;
    /** The stored value. */
    value: unknown;
    /** Entry metadata. */
    metadata: {
        /** ISO timestamp when the entry was created. */
        createdAt: string;
        /** ISO timestamp of the last update. */
        updatedAt: string;
        /** Name of the agent that wrote this entry. */
        author: string;
        /** Optional logical grouping namespace. */
        namespace?: string;
        /** Time-to-live in milliseconds (undefined = permanent). */
        ttl?: number;
        /** ISO timestamp when this entry expires (derived from ttl). */
        expiresAt?: string;
    };
}

/** Options for querying memory entries. */
export interface MemoryQueryOptions {
    /** Filter by namespace. */
    namespace?: string;
    /** Filter by key prefix. */
    prefix?: string;
    /** Maximum number of entries to return. */
    limit?: number;
}

/** Summary of a conversation history segment. */
export interface ConversationSummary {
    /** The summarized text. */
    summary: string;
    /** Number of messages that were summarized. */
    messageCount: number;
    /** Estimated token count of the summarized messages. */
    tokenEstimate: number;
    /** ISO timestamp of when the summary was created. */
    createdAt: string;
}

// ─── Claims ──────────────────────────────────────────────────────────────────

export type ClaimLinkType = "supports" | "challenges";

export interface ClaimLink {
    /** ID of the related claim. */
    targetClaimId: string;
    /** Relationship type. */
    type: ClaimLinkType;
}

/** A single claim in the shared reasoning graph. */
export interface Claim {
    /** Unique identifier. */
    id: string;
    /** The assertion being made. */
    statement: string;
    /** Evidence supporting or explaining the claim. */
    evidence: string[];
    /** Confidence score from 0 to 1. */
    confidence: number;
    /** Agent name that authored the claim. */
    author: string;
    /** Links to other claims (supports / challenges). */
    links: ClaimLink[];
    /** ISO timestamp of creation. */
    createdAt: string;
}

// ─── Jobs ────────────────────────────────────────────────────────────────────

export type JobStatus =
    | "pending"
    | "running"
    | "completed"
    | "cancelled"
    | "failed";

export interface Job {
    id: string;
    agentName: string;
    task: string;
    status: JobStatus;
    result?: unknown;
    error?: string;
    createdAt: string;
}

// ─── Messages ────────────────────────────────────────────────────────────────

export interface AgentMessage {
    id: string;
    from: string;
    to: string;
    payload: unknown;
    timestamp: string;
}

// ─── Execution ───────────────────────────────────────────────────────────────

export type RunStatus =
    | "idle"
    | "running"
    | "paused"
    | "completed"
    | "cancelled"
    | "failed";

export interface ExecutionResult {
    status: RunStatus;
    claims: Claim[];
    consensus: string;
    conflicts: string[];
    jobResults: Job[];
}

// ─── Events ──────────────────────────────────────────────────────────────────

/** Base payload included in every event. */
export interface EventMeta {
    correlationId: string;
    timestamp: string;
}

/** All events the system can emit, keyed by event name. */
export interface AgentBoxEvents {
    // Index signatures for mitt compatibility (EventType = string | symbol)
    [key: string]: unknown;
    [key: symbol]: unknown;

    // Run lifecycle
    "run:started": EventMeta & { task: string };
    "run:completed": EventMeta & { status: RunStatus };

    // Agent lifecycle
    "agent:started": EventMeta & { agentName: string };
    "agent:thinking": EventMeta & { agentName: string };
    "agent:idle": EventMeta & { agentName: string };
    "agent:error": EventMeta & { agentName: string; error: string };
    "agent:spawned": EventMeta & { agentName: string; parentAgent: string };

    // Team lifecycle
    "team:created": EventMeta & { teamName: string; manager: string; memberCount: number };

    // Messaging
    "message:sent": EventMeta & { message: AgentMessage };
    "message:received": EventMeta & { message: AgentMessage };

    // Jobs
    "job:scheduled": EventMeta & { job: Job };
    "job:completed": EventMeta & { job: Job };
    "job:cancelled": EventMeta & { jobId: string };

    // Claims
    "claim:created": EventMeta & { claim: Claim };
    "claim:challenged": EventMeta & {
        claimId: string;
        challengerId: string;
    };
    "claim:supported": EventMeta & {
        claimId: string;
        supporterId: string;
    };

    // Memory
    "memory:set": EventMeta & { agentName: string; key: string; namespace?: string };
    "memory:delete": EventMeta & { agentName: string; key: string };
    "memory:shared:set": EventMeta & { agentName: string; key: string; namespace?: string };
    "memory:summarized": EventMeta & { agentName: string; messageCount: number };

    // MCP
    "mcp:connected": EventMeta & { name: string };
    "mcp:error": EventMeta & { name: string; error: string };

    // LLM
    "llm:request": EventMeta & { model: string; provider: LLMProviderName };
    "llm:response": EventMeta & {
        model: string;
        provider: LLMProviderName;
        usage?: TokenUsage;
    };
    "llm:error": EventMeta & {
        model: string;
        provider: LLMProviderName;
        error: string;
    };
}

// ─── LLM ─────────────────────────────────────────────────────────────────────

/** Supported LLM provider identifiers. */
export type LLMProviderName = "openai" | "anthropic" | "google";

/** Chat message role. */
export type ChatRole = "system" | "user" | "assistant";

/** A single message in a chat conversation. */
export interface ChatMessage {
    role: ChatRole;
    content: string;
}

/** Token usage statistics from an LLM response. */
export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /** Reasoning/thinking tokens used (if applicable). */
    reasoningTokens?: number;
}

// ── Provider-specific reasoning effort ───────────────────────────────────────

/**
 * OpenAI reasoning_effort values.
 * @see https://platform.openai.com/docs/api-reference/responses
 */
export type OpenAIReasoningEffort = "minimal" | "low" | "medium" | "high";

/**
 * Anthropic thinking effort values (Claude 4.5+).
 * @see https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking
 */
export type AnthropicThinkingEffort = "low" | "medium" | "high" | "max";

/**
 * Google Gemini 3 thinking level values.
 * @see https://ai.google.dev/gemini-api/docs/thinking
 */
export type GoogleThinkingLevel = "minimal" | "low" | "medium" | "high";

/**
 * Google Gemini 2.5 thinking budget (numeric token count).
 * - `-1` = dynamic thinking (model decides)
 * - `0`  = disable thinking (Flash/Flash-Lite only)
 * - `128–32768` = explicit token budget
 */
export type GoogleThinkingBudget = number;

/** Unified reasoning effort — the client maps this to the provider-specific format. */
export type ReasoningEffort =
    | { provider: "openai"; effort: OpenAIReasoningEffort }
    | { provider: "anthropic"; effort: AnthropicThinkingEffort }
    | { provider: "google"; level: GoogleThinkingLevel }
    | { provider: "google"; budget: GoogleThinkingBudget };

// ── Chat Request / Response ──────────────────────────────────────────────────

/** Options for a chat completion request. */
export interface ChatRequest {
    /** Messages forming the conversation. */
    messages: ChatMessage[];
    /**
     * Provider-specific reasoning effort.
     * Validated against the provider's allowed values.
     */
    reasoningEffort?: OpenAIReasoningEffort | AnthropicThinkingEffort | GoogleThinkingLevel;
    /**
     * Google Gemini 2.5 thinking budget (numeric).
     * Only applicable when using `google/gemini-2.5-*` models.
     */
    thinkingBudget?: GoogleThinkingBudget;
    /** Sampling temperature (0–2). */
    temperature?: number;
    /** Maximum tokens to generate. */
    maxTokens?: number;
    /** Nucleus sampling threshold (0–1). */
    topP?: number;
    /** Stop sequences. */
    stopSequences?: string[];
    /** System prompt (prepended as a system message if provided). */
    systemPrompt?: string;
}

/** Response from a chat completion. */
export interface ChatResponse {
    /** The model's response text. */
    content: string;
    /** Token usage statistics. */
    usage?: TokenUsage;
    /** The model identifier used. */
    model: string;
    /** Provider name. */
    provider: LLMProviderName;
    /** The raw provider response (for advanced use). */
    raw?: unknown;
}

/** Per-provider API key configuration. */
export interface LLMApiKeys {
    openai?: string;
    anthropic?: string;
    google?: string;
}

/** Configuration for the LLM client. */
export interface LLMClientConfig {
    /** API keys per provider. Falls back to env vars if not set. */
    apiKeys?: LLMApiKeys;
    /** Default request parameters applied to every call. */
    defaults?: Partial<Pick<ChatRequest, "temperature" | "maxTokens" | "topP">>;
}
