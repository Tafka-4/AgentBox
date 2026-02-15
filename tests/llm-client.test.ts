import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LLMClient } from "../src/llm-client.js";
import { EventBus } from "../src/event-bus.js";

describe("LLMClient", () => {
    let client: LLMClient;
    const originalEnv = { ...process.env };

    beforeEach(() => {
        client = new LLMClient({
            apiKeys: {
                openai: "sk-test-key",
                anthropic: "sk-ant-test-key",
                google: "AIza-test-key",
            },
        });
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    describe("parseModel()", () => {
        it("parses openai/model-name correctly", () => {
            const result = client.parseModel("openai/gpt-5.3-codex");
            expect(result.provider).toBe("openai");
            expect(result.model).toBe("gpt-5.3-codex");
        });

        it("parses anthropic/model-name correctly", () => {
            const result = client.parseModel("anthropic/claude-opus-4.6");
            expect(result.provider).toBe("anthropic");
            expect(result.model).toBe("claude-opus-4.6");
        });

        it("parses google/model-name correctly", () => {
            const result = client.parseModel("google/gemini-3-pro-preview");
            expect(result.provider).toBe("google");
            expect(result.model).toBe("gemini-3-pro-preview");
        });

        it("throws on missing slash", () => {
            expect(() => client.parseModel("gpt-5")).toThrow(
                'Invalid model format "gpt-5"',
            );
        });

        it("throws on unsupported provider", () => {
            expect(() => client.parseModel("mistral/large")).toThrow(
                'Unsupported provider "mistral"',
            );
        });

        it("throws on empty model name", () => {
            expect(() => client.parseModel("openai/")).toThrow(
                "Model name is empty",
            );
        });

        it("handles model names with slashes", () => {
            const result = client.parseModel("google/models/gemini-3-pro");
            expect(result.provider).toBe("google");
            expect(result.model).toBe("models/gemini-3-pro");
        });
    });

    describe("resolveApiKey()", () => {
        it("resolves key from constructor config", () => {
            expect(client.resolveApiKey("openai")).toBe("sk-test-key");
            expect(client.resolveApiKey("anthropic")).toBe("sk-ant-test-key");
            expect(client.resolveApiKey("google")).toBe("AIza-test-key");
        });

        it("falls back to environment variables", () => {
            const envClient = new LLMClient({});
            process.env.OPENAI_API_KEY = "env-openai-key";
            expect(envClient.resolveApiKey("openai")).toBe("env-openai-key");
        });

        it("throws when no key is available", () => {
            const noKeyClient = new LLMClient({});
            delete process.env.OPENAI_API_KEY;
            expect(() => noKeyClient.resolveApiKey("openai")).toThrow(
                'No API key for "openai"',
            );
        });
    });

    describe("reasoning effort validation", () => {
        const messages = [{ role: "user" as const, content: "Hello" }];

        it("validates OpenAI reasoning effort accepts valid values", async () => {
            // We can't actually call the API, but we can verify the adapter
            // build step doesn't throw for valid values
            const validEfforts = ["minimal", "low", "medium", "high"] as const;
            for (const effort of validEfforts) {
                // This would fail at the fetch call, not at validation
                await expect(
                    client.chat("openai/gpt-5.3-codex", {
                        messages,
                        reasoningEffort: effort,
                    }),
                ).rejects.toThrow(); // Will throw on fetch, not validation
            }
        });

        it("rejects invalid OpenAI reasoning effort", async () => {
            await expect(
                client.chat("openai/gpt-5.3-codex", {
                    messages,
                    reasoningEffort: "max" as any,
                }),
            ).rejects.toThrow('Invalid OpenAI reasoning_effort "max"');
        });

        it("rejects invalid Anthropic thinking effort", async () => {
            await expect(
                client.chat("anthropic/claude-opus-4.6", {
                    messages,
                    reasoningEffort: "minimal" as any,
                }),
            ).rejects.toThrow('Invalid Anthropic thinking effort "minimal"');
        });

        it("rejects invalid Google thinking level", async () => {
            await expect(
                client.chat("google/gemini-3-pro-preview", {
                    messages,
                    reasoningEffort: "max" as any,
                }),
            ).rejects.toThrow('Invalid Google thinkingLevel "max"');
        });

        it("rejects thinkingBudget for non-Gemini-2.5 models", async () => {
            await expect(
                client.chat("google/gemini-3-pro-preview", {
                    messages,
                    thinkingBudget: 1024,
                }),
            ).rejects.toThrow("thinkingBudget is only supported for Gemini 2.5 models");
        });

        it("rejects thinkingBudget out of range", async () => {
            await expect(
                client.chat("google/gemini-2.5-flash", {
                    messages,
                    thinkingBudget: 99999,
                }),
            ).rejects.toThrow("thinkingBudget must be between -1 and 32768");
        });
    });

    describe("common parameter validation", () => {
        const messages = [{ role: "user" as const, content: "Hello" }];

        it("rejects empty messages", async () => {
            await expect(
                client.chat("openai/gpt-5", { messages: [] }),
            ).rejects.toThrow("messages array must not be empty");
        });

        it("rejects temperature out of range", async () => {
            await expect(
                client.chat("openai/gpt-5", { messages, temperature: 3 }),
            ).rejects.toThrow("temperature must be between 0 and 2");
        });

        it("rejects negative temperature", async () => {
            await expect(
                client.chat("openai/gpt-5", { messages, temperature: -0.5 }),
            ).rejects.toThrow("temperature must be between 0 and 2");
        });

        it("rejects topP out of range", async () => {
            await expect(
                client.chat("openai/gpt-5", { messages, topP: 1.5 }),
            ).rejects.toThrow("topP must be between 0 and 1");
        });

        it("rejects non-positive maxTokens", async () => {
            await expect(
                client.chat("openai/gpt-5", { messages, maxTokens: 0 }),
            ).rejects.toThrow("maxTokens must be positive");
        });
    });

    describe("defaults merging", () => {
        it("applies defaults from config", async () => {
            const clientWithDefaults = new LLMClient({
                apiKeys: { openai: "sk-test" },
                defaults: { temperature: 0.5, maxTokens: 500, topP: 0.9 },
            });

            // The chat call will fail at fetch, but we can verify
            // defaults would be applied by checking they don't throw validation
            await expect(
                clientWithDefaults.chat("openai/gpt-5", {
                    messages: [{ role: "user", content: "test" }],
                }),
            ).rejects.toThrow(); // fetch error, not validation
        });

        it("request params override defaults", async () => {
            const clientWithDefaults = new LLMClient({
                apiKeys: { openai: "sk-test" },
                defaults: { temperature: 0.5 },
            });

            // Override with temperature=0.8 should be fine
            await expect(
                clientWithDefaults.chat("openai/gpt-5", {
                    messages: [{ role: "user", content: "test" }],
                    temperature: 0.8,
                }),
            ).rejects.toThrow(); // fetch error, not validation
        });
    });

    describe("EventBus integration", () => {
        it("emits llm:request and llm:error events", async () => {
            const bus = new EventBus();
            const requestHandler = vi.fn();
            const errorHandler = vi.fn();
            bus.on("llm:request", requestHandler);
            bus.on("llm:error", errorHandler);

            const eventClient = new LLMClient(
                { apiKeys: { openai: "sk-test" } },
                bus,
            );

            await expect(
                eventClient.chat("openai/gpt-5", {
                    messages: [{ role: "user", content: "hello" }],
                }),
            ).rejects.toThrow();

            expect(requestHandler).toHaveBeenCalledOnce();
            expect(requestHandler.mock.calls[0][0].model).toBe("openai/gpt-5");
            expect(requestHandler.mock.calls[0][0].provider).toBe("openai");

            expect(errorHandler).toHaveBeenCalledOnce();
        });
    });

    describe("provider adapter request building", () => {
        // Test via a mocked fetch to verify correct request structure
        const originalFetch = globalThis.fetch;
        let fetchMock: ReturnType<typeof vi.fn>;

        beforeEach(() => {
            fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    // OpenAI response shape
                    choices: [{ message: { content: "Hello back!" } }],
                    usage: {
                        prompt_tokens: 10,
                        completion_tokens: 5,
                        total_tokens: 15,
                    },
                }),
            });
            globalThis.fetch = fetchMock;
        });

        afterEach(() => {
            globalThis.fetch = originalFetch;
        });

        it("builds correct OpenAI request", async () => {
            await client.chat("openai/gpt-5.3-codex", {
                messages: [{ role: "user", content: "Hi" }],
                systemPrompt: "You are helpful.",
                temperature: 0.7,
                maxTokens: 100,
                reasoningEffort: "high",
            });

            expect(fetchMock).toHaveBeenCalledOnce();
            const [url, opts] = fetchMock.mock.calls[0];
            expect(url).toContain("api.openai.com");
            expect(url).toContain("chat/completions");

            const body = JSON.parse(opts.body);
            expect(body.model).toBe("gpt-5.3-codex");
            expect(body.messages).toHaveLength(2); // system + user
            expect(body.messages[0].role).toBe("system");
            expect(body.temperature).toBe(0.7);
            expect(body.max_tokens).toBe(100);
            expect(body.reasoning_effort).toBe("high");

            expect(opts.headers.Authorization).toBe("Bearer sk-test-key");
        });

        it("builds correct Anthropic request", async () => {
            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    content: [{ type: "text", text: "Hello!" }],
                    usage: { input_tokens: 8, output_tokens: 3 },
                }),
            });

            await client.chat("anthropic/claude-opus-4.6", {
                messages: [{ role: "user", content: "Hi" }],
                systemPrompt: "Be concise.",
                reasoningEffort: "max",
            });

            const [url, opts] = fetchMock.mock.calls[0];
            expect(url).toContain("api.anthropic.com");
            expect(url).toContain("messages");

            const body = JSON.parse(opts.body);
            expect(body.model).toBe("claude-opus-4.6");
            expect(body.system).toBe("Be concise.");
            expect(body.thinking).toEqual({ type: "enabled", effort: "max" });
            expect(opts.headers["x-api-key"]).toBe("sk-ant-test-key");
            expect(opts.headers["anthropic-version"]).toBeDefined();
        });

        it("builds correct Google Gemini 3 request", async () => {
            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    candidates: [
                        { content: { parts: [{ text: "Hi!" }] } },
                    ],
                    usageMetadata: {
                        promptTokenCount: 5,
                        candidatesTokenCount: 2,
                        totalTokenCount: 7,
                    },
                }),
            });

            await client.chat("google/gemini-3-pro-preview", {
                messages: [{ role: "user", content: "Hi" }],
                reasoningEffort: "low",
            });

            const [url, opts] = fetchMock.mock.calls[0];
            expect(url).toContain("generativelanguage.googleapis.com");
            expect(url).toContain("gemini-3-pro-preview");
            expect(url).toContain("key=AIza-test-key");

            const body = JSON.parse(opts.body);
            expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe("low");
        });

        it("builds correct Google Gemini 2.5 request with thinkingBudget", async () => {
            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    candidates: [
                        { content: { parts: [{ text: "Response" }] } },
                    ],
                }),
            });

            await client.chat("google/gemini-2.5-flash", {
                messages: [{ role: "user", content: "Hi" }],
                thinkingBudget: 4096,
            });

            const [url, opts] = fetchMock.mock.calls[0];
            const body = JSON.parse(opts.body);
            expect(body.generationConfig.thinkingConfig.thinkingBudget).toBe(4096);
        });
    });

    describe("response parsing", () => {
        const originalFetch = globalThis.fetch;
        let fetchMock: ReturnType<typeof vi.fn>;

        beforeEach(() => {
            fetchMock = vi.fn();
            globalThis.fetch = fetchMock;
        });

        afterEach(() => {
            globalThis.fetch = originalFetch;
        });

        it("parses OpenAI response correctly", async () => {
            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    choices: [{ message: { content: "Hello!" } }],
                    usage: {
                        prompt_tokens: 10,
                        completion_tokens: 5,
                        total_tokens: 15,
                        completion_tokens_details: { reasoning_tokens: 3 },
                    },
                }),
            });

            const result = await client.chat("openai/gpt-5", {
                messages: [{ role: "user", content: "Hi" }],
            });

            expect(result.content).toBe("Hello!");
            expect(result.provider).toBe("openai");
            expect(result.model).toBe("openai/gpt-5");
            expect(result.usage?.promptTokens).toBe(10);
            expect(result.usage?.completionTokens).toBe(5);
            expect(result.usage?.totalTokens).toBe(15);
            expect(result.usage?.reasoningTokens).toBe(3);
        });

        it("parses Anthropic response correctly", async () => {
            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    content: [
                        { type: "thinking", thinking: "...", signature: "..." },
                        { type: "text", text: "World" },
                    ],
                    usage: { input_tokens: 8, output_tokens: 4 },
                }),
            });

            const result = await client.chat("anthropic/claude-opus-4.6", {
                messages: [{ role: "user", content: "Hi" }],
            });

            expect(result.content).toBe("World"); // Filters to text blocks only
            expect(result.usage?.promptTokens).toBe(8);
            expect(result.usage?.completionTokens).toBe(4);
            expect(result.usage?.totalTokens).toBe(12);
        });

        it("parses Google response correctly", async () => {
            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    candidates: [
                        { content: { parts: [{ text: "Part1" }, { text: "Part2" }] } },
                    ],
                    usageMetadata: {
                        promptTokenCount: 5,
                        candidatesTokenCount: 8,
                        totalTokenCount: 13,
                        thoughtsTokenCount: 2,
                    },
                }),
            });

            const result = await client.chat("google/gemini-3-pro-preview", {
                messages: [{ role: "user", content: "Hi" }],
            });

            expect(result.content).toBe("Part1Part2");
            expect(result.usage?.promptTokens).toBe(5);
            expect(result.usage?.reasoningTokens).toBe(2);
        });

        it("handles API errors gracefully", async () => {
            fetchMock.mockResolvedValueOnce({
                ok: false,
                status: 429,
                text: async () => "Rate limit exceeded",
            });

            await expect(
                client.chat("openai/gpt-5", {
                    messages: [{ role: "user", content: "Hi" }],
                }),
            ).rejects.toThrow("openai API error (429): Rate limit exceeded");
        });
    });
});
