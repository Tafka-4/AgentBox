// ─── Public API ──────────────────────────────────────────────────────────────

// Primary entry point
export { AgentBox, AgentBuilder } from "./agent-box.js";

// Core components
export { AgentTool } from "./tool.js";
export { EventBus } from "./event-bus.js";
export { Registry } from "./registry.js";
export { Scheduler } from "./scheduler.js";
export type { JobHandle } from "./scheduler.js";
export { ClaimGraph } from "./claim-graph.js";
export type { ClaimSummary } from "./claim-graph.js";
export { MessageRouter } from "./message-router.js";
export { MCPClient } from "./mcp-client.js";
export { ExecutionContext } from "./execution-context.js";
export { PolicyEnforcer } from "./policy-enforcer.js";
export { AgentRuntime } from "./agent-runtime.js";
export { AgentMemory } from "./agent-memory.js";
export { SharedMemory } from "./shared-memory.js";
export { ConversationHistory } from "./conversation-history.js";

// Tool description utilities
export {
    ToolDescriptionCache,
    generateToolDescription,
    ensureToolDescriptions,
} from "./tool-description.js";

// LLM client
export { LLMClient } from "./llm-client.js";

// Types
export type {
    AgentDefinition,
    AgentBoxEvents,
    AgentExecutor,
    AgentMessage,
    AgentRuntimeAPI,
    ChatMessage,
    ChatRequest,
    ChatResponse,
    ChatRole,
    Claim,
    ClaimLink,
    ClaimLinkType,
    ConversationSummary,
    EventMeta,
    ExecutionResult,
    Job,
    JobStatus,
    LLMApiKeys,
    LLMClientConfig,
    LLMProviderName,
    MCPDefinition,
    MCPPrompt,
    MCPResource,
    MCPTransport,
    MemoryEntry,
    MemoryQueryOptions,
    OpenAIReasoningEffort,
    AnthropicThinkingEffort,
    GoogleThinkingLevel,
    GoogleThinkingBudget,
    Policy,
    ReasoningEffort,
    RunStatus,
    TeamConfig,
    TokenUsage,
    ToolDefinition,
} from "./types.js";
