import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentBox } from "../src/agent-box.js";
import { AgentMemory } from "../src/agent-memory.js";
import { SharedMemory } from "../src/shared-memory.js";
import { ConversationHistory } from "../src/conversation-history.js";
import { EventBus } from "../src/event-bus.js";
import type { AgentRuntimeAPI, MemoryEntry } from "../src/types.js";

// ── Unit Tests ───────────────────────────────────────────────────────────────

describe("AgentMemory (per-agent working memory)", () => {
    let memory: AgentMemory;
    let eventBus: EventBus;

    beforeEach(() => {
        eventBus = new EventBus();
        memory = new AgentMemory("TestAgent", eventBus, "corr-1");
    });

    it("should set and get values", () => {
        memory.set("key1", { data: "hello" });
        expect(memory.get("key1")).toEqual({ data: "hello" });
    });

    it("should return undefined for missing keys", () => {
        expect(memory.get("nonexistent")).toBeUndefined();
    });

    it("should update existing values", () => {
        memory.set("key1", "v1");
        memory.set("key1", "v2");
        expect(memory.get("key1")).toBe("v2");
    });

    it("should delete keys", () => {
        memory.set("key1", "value");
        expect(memory.delete("key1")).toBe(true);
        expect(memory.get("key1")).toBeUndefined();
    });

    it("should return false when deleting non-existent key", () => {
        expect(memory.delete("missing")).toBe(false);
    });

    it("should support TTL expiration", async () => {
        memory.set("ephemeral", "data", { ttl: 50 });
        expect(memory.get("ephemeral")).toBe("data");

        // Wait for TTL to expire
        await new Promise((r) => setTimeout(r, 60));
        expect(memory.get("ephemeral")).toBeUndefined();
    });

    it("should filter by namespace", () => {
        memory.set("a1", "v1", { namespace: "research" });
        memory.set("a2", "v2", { namespace: "research" });
        memory.set("b1", "v3", { namespace: "planning" });

        const researchEntries = memory.list({ namespace: "research" });
        expect(researchEntries).toHaveLength(2);
        expect(researchEntries.every((e) => e.metadata.namespace === "research")).toBe(true);
    });

    it("should filter by prefix", () => {
        memory.set("result:1", "a");
        memory.set("result:2", "b");
        memory.set("config:1", "c");

        const results = memory.list({ prefix: "result:" });
        expect(results).toHaveLength(2);
    });

    it("should apply limit", () => {
        for (let i = 0; i < 10; i++) {
            memory.set(`k${i}`, i);
        }
        const limited = memory.list({ limit: 3 });
        expect(limited).toHaveLength(3);
    });

    it("should emit memory:set events", () => {
        const events: unknown[] = [];
        eventBus.on("memory:set", (e) => events.push(e));

        memory.set("key", "value", { namespace: "ns" });
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            agentName: "TestAgent",
            key: "key",
            namespace: "ns",
        });
    });

    it("should emit memory:delete events", () => {
        const events: unknown[] = [];
        eventBus.on("memory:delete", (e) => events.push(e));

        memory.set("key", "value");
        memory.delete("key");
        expect(events).toHaveLength(1);
    });

    it("should track entry metadata (author, timestamps)", () => {
        memory.set("key", "value");
        const entries = memory.list();
        expect(entries[0].metadata.author).toBe("TestAgent");
        expect(entries[0].metadata.createdAt).toBeTruthy();
        expect(entries[0].metadata.updatedAt).toBeTruthy();
    });

    it("should report correct size", () => {
        memory.set("a", 1);
        memory.set("b", 2);
        expect(memory.size).toBe(2);
    });

    it("should clear all entries", () => {
        memory.set("a", 1);
        memory.set("b", 2);
        memory.clear();
        expect(memory.size).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("SharedMemory (cross-agent)", () => {
    let sharedMemory: SharedMemory;
    let eventBus: EventBus;

    beforeEach(() => {
        eventBus = new EventBus();
        sharedMemory = new SharedMemory(eventBus, "corr-1");
    });

    it("should allow multiple agents to write and read", () => {
        sharedMemory.set("Agent1", "findings", { topic: "A" });
        sharedMemory.set("Agent2", "analysis", { topic: "B" });

        expect(sharedMemory.get("findings")).toEqual({ topic: "A" });
        expect(sharedMemory.get("analysis")).toEqual({ topic: "B" });
    });

    it("should track authorship", () => {
        sharedMemory.set("AgentX", "data", "value");
        const entries = sharedMemory.list();
        expect(entries[0].metadata.author).toBe("AgentX");
    });

    it("should support TTL expiration", async () => {
        sharedMemory.set("Agent1", "temp", "value", { ttl: 50 });
        expect(sharedMemory.get("temp")).toBe("value");

        await new Promise((r) => setTimeout(r, 60));
        expect(sharedMemory.get("temp")).toBeUndefined();
    });

    it("should support namespace filtering", () => {
        sharedMemory.set("A", "k1", "v1", { namespace: "research" });
        sharedMemory.set("B", "k2", "v2", { namespace: "planning" });

        const research = sharedMemory.list({ namespace: "research" });
        expect(research).toHaveLength(1);
        expect(research[0].key).toBe("k1");
    });

    it("should emit memory:shared:set events", () => {
        const events: unknown[] = [];
        eventBus.on("memory:shared:set", (e) => events.push(e));

        sharedMemory.set("Agent1", "key", "value");
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            agentName: "Agent1",
            key: "key",
        });
    });

    it("should update correlation ID", () => {
        sharedMemory.setCorrelationId("new-corr");
        const events: Array<{ correlationId: string }> = [];
        eventBus.on("memory:shared:set", (e) => events.push(e as { correlationId: string }));

        sharedMemory.set("A", "k", "v");
        expect(events[0].correlationId).toBe("new-corr");
    });

    it("should report correct size", () => {
        sharedMemory.set("A", "k1", 1);
        sharedMemory.set("B", "k2", 2);
        expect(sharedMemory.size).toBe(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("ConversationHistory", () => {
    let history: ConversationHistory;
    let eventBus: EventBus;

    beforeEach(() => {
        eventBus = new EventBus();
        history = new ConversationHistory("TestAgent", eventBus, "corr-1");
    });

    it("should append and retrieve messages", () => {
        history.append({ role: "user", content: "Hello" });
        history.append({ role: "assistant", content: "Hi there" });

        const messages = history.getMessages();
        expect(messages).toHaveLength(2);
        expect(messages[0].content).toBe("Hello");
    });

    it("should estimate token count", () => {
        // 4 chars ≈ 1 token
        const tokens = ConversationHistory.estimateTokens("Hello world!"); // 12 chars
        expect(tokens).toBe(3);
    });

    it("should estimate total tokens across messages", () => {
        history.append({ role: "user", content: "1234" }); // 1 token
        history.append({ role: "assistant", content: "12345678" }); // 2 tokens
        expect(history.estimateTotalTokens()).toBe(3);
    });

    it("should return null summary when none exists", () => {
        expect(history.getLatestSummary()).toBeNull();
    });

    it("should generate deterministic fallback summary", async () => {
        history.append({ role: "user", content: "What is 2+2?" });
        history.append({ role: "assistant", content: "4" });

        const summary = await history.summarize();
        expect(summary.messageCount).toBe(2);
        expect(summary.summary).toContain("2 messages");
        expect(summary.createdAt).toBeTruthy();
    });

    it("should emit memory:summarized events", async () => {
        const events: unknown[] = [];
        eventBus.on("memory:summarized", (e) => events.push(e));

        history.append({ role: "user", content: "test" });
        await history.summarize();

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            agentName: "TestAgent",
            messageCount: 1,
        });
    });

    it("should store multiple summaries", async () => {
        history.append({ role: "user", content: "First batch" });
        await history.summarize();

        history.append({ role: "user", content: "Second batch" });
        await history.summarize();

        expect(history.getSummaries()).toHaveLength(2);
        expect(history.getLatestSummary()!.messageCount).toBe(2);
    });

    describe("getContextWindow", () => {
        it("should return messages within token budget", () => {
            // Each message: 4 chars = 1 token
            history.append({ role: "user", content: "AAAA" });  // 1 token
            history.append({ role: "assistant", content: "BBBB" }); // 1 token
            history.append({ role: "user", content: "CCCC" });  // 1 token

            const window = history.getContextWindow(2);
            expect(window).toHaveLength(2);
            // Should include the most recent messages
            expect(window[0].content).toBe("BBBB");
            expect(window[1].content).toBe("CCCC");
        });

        it("should include summary in context window when available", async () => {
            history.append({ role: "user", content: "Old message 1" });
            history.append({ role: "assistant", content: "Old message 2" });
            await history.summarize();

            history.append({ role: "user", content: "New" });

            const window = history.getContextWindow(1000);
            // First message should be the summary (role: system)
            expect(window[0].role).toBe("system");
            expect(window[0].content).toContain("[Conversation Summary]");
        });

        it("should handle empty history", () => {
            const window = history.getContextWindow(100);
            expect(window).toHaveLength(0);
        });
    });

    it("should clear all data", async () => {
        history.append({ role: "user", content: "test" });
        await history.summarize();
        history.clear();

        expect(history.messageCount).toBe(0);
        expect(history.getSummaries()).toHaveLength(0);
    });

    it("should handle summarize with empty history", async () => {
        const summary = await history.summarize();
        expect(summary.messageCount).toBe(0);
        expect(summary.summary).toContain("No messages");
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Memory Integration (via AgentBox)", () => {
    it("executor can use working memory during a run", async () => {
        const box = new AgentBox();
        let savedEntries: MemoryEntry[] = [];

        box.defineAgent("MemoryAgent")
            .prompt("Use memory")
            .executor(async (runtime) => {
                runtime.setMemory("step1", { data: "initial" }, { namespace: "work" });
                runtime.setMemory("step2", { data: "processed" }, { namespace: "work" });

                const v1 = runtime.getMemory("step1");
                expect(v1).toEqual({ data: "initial" });

                savedEntries = runtime.listMemory({ namespace: "work" });
                return { memoryCount: savedEntries.length };
            })
            .build();

        const result = await box.run("memory test");
        expect(result.status).toBe("completed");
        expect(savedEntries).toHaveLength(2);
    });

    it("executor can delete from working memory", async () => {
        const box = new AgentBox();

        box.defineAgent("Cleaner")
            .prompt("Clean up")
            .executor(async (runtime) => {
                runtime.setMemory("temp", "value");
                expect(runtime.deleteMemory("temp")).toBe(true);
                expect(runtime.getMemory("temp")).toBeUndefined();
                return { cleaned: true };
            })
            .build();

        await box.run("clean test");
    });

    it("agents can share data via shared memory", async () => {
        const box = new AgentBox();

        box.defineAgent("Writer")
            .prompt("Write shared data")
            .executor(async (runtime) => {
                runtime.setShared("global:result", { finding: "important" });
                return { written: true };
            })
            .build();

        // Since agents run in parallel within a single run, we use spawning
        // to test cross-agent shared memory
        box.defineAgent("Coordinator")
            .prompt("Coordinate")
            .executor(async (runtime) => {
                // Spawn a writer
                await runtime.spawnAgent(
                    {
                        name: "SubWriter",
                        prompt: "Write results",
                        tools: [],
                        policy: {},
                        mcpServers: [],
                        executor: async (rt) => {
                            rt.setShared("shared:data", { x: 42 });
                            return {};
                        },
                    },
                    "write",
                );

                // Read what the sub-writer wrote
                const data = runtime.getShared("shared:data");
                expect(data).toEqual({ x: 42 });

                return { sharedData: data };
            })
            .build();

        const result = await box.run("shared memory test");
        expect(result.status).toBe("completed");
    });

    it("executor can use conversation history", async () => {
        const box = new AgentBox();

        box.defineAgent("Conversationalist")
            .prompt("Track conversation")
            .executor(async (runtime) => {
                runtime.appendHistory({ role: "user", content: "What is the capital of France?" });
                runtime.appendHistory({ role: "assistant", content: "Paris" });
                runtime.appendHistory({ role: "user", content: "And Germany?" });
                runtime.appendHistory({ role: "assistant", content: "Berlin" });

                const history = runtime.getHistory();
                expect(history).toHaveLength(4);

                const summary = await runtime.summarizeHistory();
                expect(summary.messageCount).toBe(4);
                expect(runtime.getHistorySummary()).not.toBeNull();

                return { historyLength: history.length, summary: summary.summary };
            })
            .build();

        const result = await box.run("conversation test");
        expect(result.status).toBe("completed");
    });

    it("emits memory events during agent execution", async () => {
        const box = new AgentBox();
        const memoryEvents: string[] = [];

        box.on("memory:set", () => memoryEvents.push("set"));
        box.on("memory:delete", () => memoryEvents.push("delete"));
        box.on("memory:shared:set", () => memoryEvents.push("shared:set"));
        box.on("memory:summarized", () => memoryEvents.push("summarized"));

        box.defineAgent("EventEmitter")
            .prompt("Emit events")
            .executor(async (runtime) => {
                runtime.setMemory("k", "v");
                runtime.deleteMemory("k");
                runtime.setShared("sk", "sv");
                runtime.appendHistory({ role: "user", content: "test" });
                await runtime.summarizeHistory();
                return {};
            })
            .build();

        await box.run("event test");
        expect(memoryEvents).toContain("set");
        expect(memoryEvents).toContain("delete");
        expect(memoryEvents).toContain("shared:set");
        expect(memoryEvents).toContain("summarized");
    });
});
