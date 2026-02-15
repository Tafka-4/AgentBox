# AgentBox

> Orchestration framework for multi-agent LLM systems — build agent teams that collaborate, debate, and verify hypotheses.

[![npm version](https://img.shields.io/npm/v/agentbox.svg)](https://www.npmjs.com/package/agentbox)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

## Features

- **Builder DSL** — Fluent API to define agents, tools, and MCP connections
- **Custom Executors** — Full control over agent behavior via `AgentRuntimeAPI`
- **Dynamic Spawning & Teams** — Spawn agents and create hierarchical teams at runtime
- **Memory System** — Per-agent working memory, cross-agent shared memory, and conversation history with LLM summarization
- **Parallel Scheduler** — Async job queue with `maxParallel`, pause/resume/cancel
- **Claim Graph** — Shared reasoning structure with support/challenge relationships
- **Direct Messaging** — Agent-to-agent communication with per-agent rate limiting
- **MCP Integration** — Connect to Model Context Protocol servers (SSE & stdio)
- **Event Streaming** — Observe every action via typed `EventBus` with correlation IDs
- **Tool Auto-Description** — LLM-generated descriptions with hash-based caching
- **Policy Enforcement** — Budget (tokens/cost), tool allowlists, and rate limits
- **Multi-Provider LLM** — Unified client for OpenAI, Anthropic, and Google

## Installation

```bash
npm install agentbox
```

## Quick Start

```typescript
import { AgentBox } from "agentbox";
import { z } from "zod";

const box = new AgentBox();

// Define a tool
box.defineTool({
    name: "search",
    description: "Search the web for information",
    inputSchema: z.object({ query: z.string() }),
    execute: async ({ query }) => {
        return { results: [`Result for: ${query}`] };
    },
});

// Define an agent with a custom executor
box.defineAgent("Researcher")
    .prompt("Search for evidence about the given hypothesis.")
    .tools(["search"])
    .policy({ maxParallel: 2, maxTokens: 5000 })
    .executor(async (runtime, task) => {
        // Use memory to track progress
        runtime.setMemory("status", "researching", { namespace: "meta" });

        // Execute tools
        const results = await runtime.executeTool("search", { query: task });

        // Store findings in shared memory for other agents
        runtime.setShared("research:findings", results);

        // Add claims to the reasoning graph
        runtime.addClaim("TypeScript reduces bugs", ["Study A"], 0.8);

        return { findings: results };
    })
    .build();

// Run
const result = await box.run("Validate the hypothesis that TypeScript improves code quality.");
console.log(result.consensus);   // High-confidence, unchallenged claims
console.log(result.conflicts);   // Claims with active challenges
```

## Core Concepts

### Agents

Agents are defined using the builder pattern and registered in the `AgentBox` registry:

```typescript
box.defineAgent("Verifier")
    .prompt("Verify claims by cross-referencing multiple sources.")
    .tools([searchTool])               // ToolDefinition objects or name strings
    .policy({ maxParallel: 1 })
    .mcpServers(["external-tools"])
    .executor(async (runtime, task) => {
        // Custom execution logic with full AgentRuntimeAPI access
        const claims = runtime.listClaims();
        // ... verify each claim ...
        return { verified: claims.length };
    })
    .build();
```

> **Note:** `"MasterAgent"` is a reserved name — it's auto-created on every `AgentBox` instance.

### Custom Executors & Runtime API

The `executor()` method receives an `AgentRuntimeAPI` with access to the full framework:

```typescript
box.defineAgent("Analyst")
    .prompt("Analyze data")
    .executor(async (runtime, task) => {
        // Claims
        const claim = runtime.addClaim("Finding X", ["evidence"], 0.9);
        runtime.supportClaim(claim.id, otherClaimId);

        // Messaging
        runtime.sendMessage("Researcher", { request: "more data" });

        // Tool execution
        const result = await runtime.executeTool("analyze", { data });

        // LLM chat
        const response = await runtime.chat("openai/gpt-4o", {
            messages: [{ role: "user", content: "Summarize..." }],
        });

        // Dynamic spawning
        await runtime.spawnAgent(subAgentDef, "sub-task");

        return { analysis: result };
    })
    .build();
```

### Memory System

Three layers of memory are available through the runtime API:

```typescript
box.defineAgent("MemoryAgent")
    .prompt("Use memory")
    .executor(async (runtime, task) => {
        // ── Working Memory (per-agent) ──
        runtime.setMemory("step1", { data: "result" }, { namespace: "work", ttl: 60000 });
        const val = runtime.getMemory("step1");
        runtime.deleteMemory("step1");
        const entries = runtime.listMemory({ namespace: "work", prefix: "step" });

        // ── Shared Memory (cross-agent) ──
        runtime.setShared("global:status", { phase: "analysis" });
        const status = runtime.getShared("global:status");
        const shared = runtime.listShared({ namespace: "results" });

        // ── Conversation History ──
        runtime.appendHistory({ role: "user", content: "Analyze X" });
        runtime.appendHistory({ role: "assistant", content: "Found Y" });
        const history = runtime.getHistory();
        const summary = await runtime.summarizeHistory(); // LLM-powered
        const latest = runtime.getHistorySummary();

        return { done: true };
    })
    .build();
```

### Dynamic Spawning & Teams

Agents can spawn sub-agents and create hierarchical teams at runtime:

```typescript
box.defineAgent("Coordinator")
    .prompt("Coordinate research")
    .executor(async (runtime, task) => {
        // Spawn a single agent
        const result = await runtime.spawnAgent(
            { name: "Helper", prompt: "Help with...", tools: [], policy: {}, mcpServers: [] },
            "sub-task",
        );

        // Create a team with a manager and workers
        const teamResults = await runtime.createTeam(
            {
                name: "ResearchTeam",
                manager: { name: "Manager", prompt: "Coordinate", tools: [], policy: {}, mcpServers: [] },
                members: [
                    { name: "Worker1", prompt: "Research A", tools: ["search"], policy: {}, mcpServers: [] },
                    { name: "Worker2", prompt: "Research B", tools: ["search"], policy: {}, mcpServers: [] },
                ],
                policy: { maxTokens: 10000 },
            },
            task,
        );

        return teamResults;
    })
    .build();
```

### Tools

Tools use Zod schemas for input validation:

```typescript
import { z } from "zod";

const calculatorTool = {
    name: "calculator",
    description: "Perform arithmetic calculations",
    inputSchema: z.object({
        expression: z.string(),
    }),
    execute: async ({ expression }) => eval(expression),
};
```

Tools without descriptions get **auto-generated descriptions** via an LLM call (with hash-based caching to avoid redundant calls).

### Claim Graph

Agents build a shared reasoning graph of claims, each with evidence and confidence scores:

```typescript
// During execution, agents can:
claims.addClaim("TypeScript reduces bugs", "Researcher", ["Study A"], 0.8);
claims.challengeClaim(targetId, challengerClaimId);
claims.supportClaim(targetId, supporterClaimId);

// After execution, summarize:
const summary = claims.summarize();
// { consensus: [...], conflicts: [...], claims: [...] }
```

### Event Streaming

Every action emits a typed event with a `correlationId`:

```typescript
box.on("run:started",        (e) => console.log(`Run started: ${e.task}`));
box.on("agent:started",      (e) => console.log(`${e.agentName} started`));
box.on("agent:thinking",     (e) => console.log(`${e.agentName} thinking`));
box.on("agent:spawned",      (e) => console.log(`${e.agentName} spawned by ${e.parentAgent}`));
box.on("team:created",       (e) => console.log(`Team ${e.teamName} created`));
box.on("memory:set",         (e) => console.log(`${e.agentName} set ${e.key}`));
box.on("memory:shared:set",  (e) => console.log(`Shared: ${e.key} by ${e.agentName}`));
box.on("memory:summarized",  (e) => console.log(`${e.agentName} summarized ${e.messageCount} msgs`));
box.on("job:scheduled",      (e) => console.log(`Job ${e.job.id} scheduled`));
box.on("claim:created",      (e) => console.log(`Claim: ${e.claim.statement}`));
box.on("message:sent",       (e) => console.log(`${e.message.from} → ${e.message.to}`));
box.on("llm:request",        (e) => console.log(`LLM ${e.model} request`));
```

**Event categories:** `run:*`, `agent:*`, `team:*`, `memory:*`, `job:*`, `claim:*`, `message:*`, `mcp:*`, `llm:*`, `tool:*`

### Control API

Intervene in running executions:

```typescript
const resultPromise = box.run("Analyze this dataset...");

// Pause/resume
box.pause();
box.resume();

// Inject a message into an agent
box.injectMessage("Researcher", { hint: "Check source B" });

// Cancel entirely
box.cancel();
```

### LLM Client

Unified client for interacting with multiple LLM providers:

```typescript
import { LLMClient } from "agentbox";

const llm = new LLMClient({
    apiKeys: {
        openai: process.env.OPENAI_API_KEY,
        anthropic: process.env.ANTHROPIC_API_KEY,
        google: process.env.GOOGLE_API_KEY,
    },
    defaults: { temperature: 0.7 },
});

// Use provider/model format
const response = await llm.chat("openai/gpt-4o", {
    messages: [{ role: "user", content: "Hello!" }],
    systemPrompt: "You are a helpful assistant.",
});

console.log(response.content);
console.log(response.usage); // { promptTokens, completionTokens, totalTokens }
```

**Supported providers:** `openai`, `anthropic`, `google`  
**Reasoning modes:** OpenAI `reasoning_effort`, Anthropic `thinking`, Google `thinkingLevel` / `thinkingBudget`

## API Reference

### `AgentBox`

| Method | Description |
|--------|-------------|
| `defineAgent(name)` | Returns an `AgentBuilder` for fluent agent definition |
| `defineTool(def)` | Register a `ToolDefinition` directly |
| `defineMCP(name, config)` | Register an MCP server connection |
| `setLLMClient(client, model)` | Set the LLM client for tool auto-description |
| `run(task, options?)` | Execute a task with all agents → `ExecutionResult` |
| `spawnAgent(def, task)` | Spawn a new agent at runtime |
| `createTeam(config, task)` | Create a team with manager and workers |
| `pause()` / `resume()` / `cancel()` | Control a running execution |
| `injectMessage(to, payload, from?)` | Send a message to a running agent |
| `on(event, handler)` / `off(event, handler)` | Subscribe/unsubscribe to events |

### `AgentBuilder`

| Method | Description |
|--------|-------------|
| `.prompt(text)` | Set the agent's system prompt |
| `.tools(list)` | Assign tools (names or `ToolDefinition` objects) |
| `.policy(policy)` | Set constraints (maxParallel, maxTokens, maxCost, etc.) |
| `.mcpServers(names)` | Declare MCP server dependencies |
| `.executor(fn)` | Set custom execution logic via `AgentRuntimeAPI` |
| `.build()` | Finalize and register the agent |

### `AgentRuntimeAPI`

| Method | Description |
|--------|-------------|
| `addClaim()` / `challengeClaim()` / `supportClaim()` / `listClaims()` | Claim graph operations |
| `sendMessage(to, payload)` | Send a message to another agent |
| `executeTool(name, input)` / `listTools()` | Tool execution |
| `spawnAgent(def, task)` / `createTeam(config, task)` | Dynamic agent/team creation |
| `getMemory()` / `setMemory()` / `deleteMemory()` / `listMemory()` | Per-agent working memory |
| `getShared()` / `setShared()` / `listShared()` | Cross-agent shared memory |
| `getHistory()` / `appendHistory()` / `summarizeHistory()` / `getHistorySummary()` | Conversation history |
| `chat(model, request)` | LLM chat |

### `ExecutionResult`

```typescript
interface ExecutionResult {
    status: RunStatus;
    claims: Claim[];
    consensus: string;       // High-confidence, unchallenged claims
    conflicts: string[];     // Claims with active challenges
    jobResults: Job[];
}
```

### `Policy`

```typescript
interface Policy {
    maxParallel?: number;
    maxTokens?: number;        // Enforced at runtime via PolicyEnforcer
    maxCost?: number;          // Enforced at runtime via PolicyEnforcer
    toolAllowlist?: string[];  // Validated before execution
    maxMessagesPerSecond?: number;  // Enforced per-agent by MessageRouter
}
```

## Project Structure

```
src/
├── index.ts                 # Public API exports
├── types.ts                 # All TypeScript interfaces
├── agent-box.ts             # AgentBox + AgentBuilder (DSL entry point)
├── execution-context.ts     # Run pipeline lifecycle management
├── agent-runtime.ts         # Per-agent runtime API implementation
├── registry.ts              # Agent/Tool/MCP registry
├── event-bus.ts             # Typed EventBus (mitt wrapper)
├── scheduler.ts             # Async job queue with concurrency control
├── claim-graph.ts           # Shared reasoning graph
├── message-router.ts        # Agent-to-agent messaging with rate limiting
├── policy-enforcer.ts       # Budget (token/cost) enforcement
├── agent-memory.ts          # Per-agent working memory (KV store)
├── shared-memory.ts         # Cross-agent shared memory
├── conversation-history.ts  # Conversation history with LLM summarization
├── tool.ts                  # AgentTool (Zod validation + serialization)
├── tool-description.ts      # Auto-description + hash caching
├── llm-client.ts            # Unified multi-provider LLM client
└── mcp-client.ts            # MCP SDK client wrapper
```

## Development

```bash
# Install dependencies
npm install

# Type-check
npm run lint

# Run tests
npm test

# Build (ESM + CJS)
npm run build

# Watch mode
npm run dev
```

## License

[Apache-2.0](LICENSE)
