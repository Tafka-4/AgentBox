import type {
    ChatRequest,
    ChatResponse,
    LLMClientConfig,
    LLMProviderName,
    TokenUsage,
    OpenAIReasoningEffort,
    AnthropicThinkingEffort,
    GoogleThinkingLevel,
} from "./types.js";
import type { EventBus } from "./event-bus.js";

// ─── Validation Constants ────────────────────────────────────────────────────

const OPENAI_REASONING_EFFORTS = new Set<OpenAIReasoningEffort>([
    "minimal",
    "low",
    "medium",
    "high",
]);

const ANTHROPIC_THINKING_EFFORTS = new Set<AnthropicThinkingEffort>([
    "low",
    "medium",
    "high",
    "max",
]);

const GOOGLE_THINKING_LEVELS = new Set<GoogleThinkingLevel>([
    "minimal",
    "low",
    "medium",
    "high",
]);

/** Environment variable names for API keys. */
const ENV_KEYS: Record<LLMProviderName, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    google: "GOOGLE_API_KEY",
};

/** Base URLs for each provider's API. */
const BASE_URLS: Record<LLMProviderName, string> = {
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com/v1",
    google: "https://generativelanguage.googleapis.com/v1beta",
};

const ANTHROPIC_API_VERSION = "2024-10-22";

// ─── Provider Adapters ───────────────────────────────────────────────────────

/** Internal interface for provider-specific request/response mapping. */
interface ProviderAdapter {
    buildRequest(
        model: string,
        request: ChatRequest,
    ): { url: string; headers: Record<string, string>; body: unknown };
    parseResponse(raw: unknown): { content: string; usage?: TokenUsage };
}

/** OpenAI Chat Completions adapter. */
function openaiAdapter(apiKey: string): ProviderAdapter {
    return {
        buildRequest(model, req) {
            // Validate reasoning effort
            if (req.reasoningEffort) {
                if (!OPENAI_REASONING_EFFORTS.has(req.reasoningEffort as OpenAIReasoningEffort)) {
                    throw new Error(
                        `Invalid OpenAI reasoning_effort "${req.reasoningEffort}". ` +
                        `Must be one of: ${[...OPENAI_REASONING_EFFORTS].join(", ")}`,
                    );
                }
            }

            const messages: Array<{ role: string; content: string }> = [];
            if (req.systemPrompt) {
                messages.push({ role: "system", content: req.systemPrompt });
            }
            messages.push(
                ...req.messages.map((m) => ({ role: m.role, content: m.content })),
            );

            const body: Record<string, unknown> = {
                model,
                messages,
            };
            if (req.temperature !== undefined) body.temperature = req.temperature;
            if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
            if (req.topP !== undefined) body.top_p = req.topP;
            if (req.stopSequences?.length) body.stop = req.stopSequences;
            if (req.reasoningEffort) {
                body.reasoning_effort = req.reasoningEffort;
            }

            return {
                url: `${BASE_URLS.openai}/chat/completions`,
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                },
                body,
            };
        },
        parseResponse(raw) {
            const r = raw as {
                choices?: Array<{ message?: { content?: string } }>;
                usage?: {
                    prompt_tokens?: number;
                    completion_tokens?: number;
                    total_tokens?: number;
                    completion_tokens_details?: {
                        reasoning_tokens?: number;
                    };
                };
            };
            const content = r.choices?.[0]?.message?.content ?? "";
            const usage: TokenUsage | undefined = r.usage
                ? {
                      promptTokens: r.usage.prompt_tokens ?? 0,
                      completionTokens: r.usage.completion_tokens ?? 0,
                      totalTokens: r.usage.total_tokens ?? 0,
                      reasoningTokens:
                          r.usage.completion_tokens_details?.reasoning_tokens,
                  }
                : undefined;
            return { content, usage };
        },
    };
}

/** Anthropic Messages adapter. */
function anthropicAdapter(apiKey: string): ProviderAdapter {
    return {
        buildRequest(model, req) {
            // Validate thinking effort
            if (req.reasoningEffort) {
                if (!ANTHROPIC_THINKING_EFFORTS.has(req.reasoningEffort as AnthropicThinkingEffort)) {
                    throw new Error(
                        `Invalid Anthropic thinking effort "${req.reasoningEffort}". ` +
                        `Must be one of: ${[...ANTHROPIC_THINKING_EFFORTS].join(", ")}`,
                    );
                }
            }

            const messages: Array<{ role: string; content: string }> = req.messages.map(
                (m) => ({ role: m.role, content: m.content }),
            );

            const body: Record<string, unknown> = {
                model,
                messages,
                max_tokens: req.maxTokens ?? 4096,
            };
            if (req.systemPrompt) body.system = req.systemPrompt;
            if (req.temperature !== undefined) body.temperature = req.temperature;
            if (req.topP !== undefined) body.top_p = req.topP;
            if (req.stopSequences?.length) body.stop_sequences = req.stopSequences;
            if (req.reasoningEffort) {
                body.thinking = { type: "enabled", effort: req.reasoningEffort };
            }

            return {
                url: `${BASE_URLS.anthropic}/messages`,
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": apiKey,
                    "anthropic-version": ANTHROPIC_API_VERSION,
                },
                body,
            };
        },
        parseResponse(raw) {
            const r = raw as {
                content?: Array<{ type: string; text?: string }>;
                usage?: {
                    input_tokens?: number;
                    output_tokens?: number;
                };
            };
            const textBlocks =
                r.content?.filter((b) => b.type === "text") ?? [];
            const content = textBlocks.map((b) => b.text ?? "").join("");
            const usage: TokenUsage | undefined = r.usage
                ? {
                      promptTokens: r.usage.input_tokens ?? 0,
                      completionTokens: r.usage.output_tokens ?? 0,
                      totalTokens:
                          (r.usage.input_tokens ?? 0) +
                          (r.usage.output_tokens ?? 0),
                  }
                : undefined;
            return { content, usage };
        },
    };
}

/** Google Gemini generateContent adapter. */
function googleAdapter(apiKey: string): ProviderAdapter {
    return {
        buildRequest(model, req) {
            // Determine if Gemini 2.5 or 3+
            const isGemini25 = model.includes("2.5");

            // Validate reasoning
            if (req.reasoningEffort && !isGemini25) {
                if (!GOOGLE_THINKING_LEVELS.has(req.reasoningEffort as GoogleThinkingLevel)) {
                    throw new Error(
                        `Invalid Google thinkingLevel "${req.reasoningEffort}". ` +
                        `Must be one of: ${[...GOOGLE_THINKING_LEVELS].join(", ")}`,
                    );
                }
            }
            if (req.thinkingBudget !== undefined) {
                if (!isGemini25) {
                    throw new Error(
                        `thinkingBudget is only supported for Gemini 2.5 models, not "${model}".`,
                    );
                }
                if (req.thinkingBudget < -1 || req.thinkingBudget > 32768) {
                    throw new Error(
                        `thinkingBudget must be between -1 and 32768, got ${req.thinkingBudget}.`,
                    );
                }
            }

            const parts: Array<{ text: string }> = [];
            if (req.systemPrompt) {
                parts.push({ text: req.systemPrompt });
            }
            for (const m of req.messages) {
                parts.push({ text: `${m.role}: ${m.content}` });
            }

            const generationConfig: Record<string, unknown> = {};
            if (req.temperature !== undefined)
                generationConfig.temperature = req.temperature;
            if (req.maxTokens !== undefined)
                generationConfig.maxOutputTokens = req.maxTokens;
            if (req.topP !== undefined) generationConfig.topP = req.topP;
            if (req.stopSequences?.length)
                generationConfig.stopSequences = req.stopSequences;

            // Thinking config
            const thinkingConfig: Record<string, unknown> = {};
            if (isGemini25 && req.thinkingBudget !== undefined) {
                thinkingConfig.thinkingBudget = req.thinkingBudget;
            } else if (!isGemini25 && req.reasoningEffort) {
                thinkingConfig.thinkingLevel = req.reasoningEffort;
            }
            if (Object.keys(thinkingConfig).length > 0) {
                generationConfig.thinkingConfig = thinkingConfig;
            }

            const body = {
                contents: [{ parts }],
                ...(Object.keys(generationConfig).length > 0
                    ? { generationConfig }
                    : {}),
            };

            return {
                url: `${BASE_URLS.google}/models/${model}:generateContent?key=${apiKey}`,
                headers: { "Content-Type": "application/json" },
                body,
            };
        },
        parseResponse(raw) {
            const r = raw as {
                candidates?: Array<{
                    content?: { parts?: Array<{ text?: string }> };
                }>;
                usageMetadata?: {
                    promptTokenCount?: number;
                    candidatesTokenCount?: number;
                    totalTokenCount?: number;
                    thoughtsTokenCount?: number;
                };
            };
            const parts = r.candidates?.[0]?.content?.parts ?? [];
            const content = parts.map((p) => p.text ?? "").join("");
            const usage: TokenUsage | undefined = r.usageMetadata
                ? {
                      promptTokens: r.usageMetadata.promptTokenCount ?? 0,
                      completionTokens:
                          r.usageMetadata.candidatesTokenCount ?? 0,
                      totalTokens: r.usageMetadata.totalTokenCount ?? 0,
                      reasoningTokens: r.usageMetadata.thoughtsTokenCount,
                  }
                : undefined;
            return { content, usage };
        },
    };
}

// ─── LLM Client ──────────────────────────────────────────────────────────────

/**
 * Unified LLM Client supporting OpenAI, Anthropic, and Google models.
 *
 * Model names follow the `provider/model-name` convention:
 * - `openai/gpt-5.3-codex`
 * - `anthropic/claude-opus-4.6`
 * - `google/gemini-3-pro-preview`
 *
 * API keys can be provided via the constructor or environment variables
 * (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`).
 *
 * @example
 * ```ts
 * const client = new LLMClient({
 *     apiKeys: { openai: "sk-..." }
 * });
 * const response = await client.chat("openai/gpt-5.3-codex", {
 *     messages: [{ role: "user", content: "Hello" }],
 *     reasoningEffort: "high",
 * });
 * ```
 */
export class LLMClient {
    private config: LLMClientConfig;
    private eventBus?: EventBus;

    constructor(config: LLMClientConfig = {}, eventBus?: EventBus) {
        this.config = config;
        this.eventBus = eventBus;
    }

    /**
     * Parse a `provider/model` string into its components.
     * @throws if the format is invalid or the provider is unsupported.
     */
    parseModel(modelString: string): { provider: LLMProviderName; model: string } {
        const slashIdx = modelString.indexOf("/");
        if (slashIdx === -1) {
            throw new Error(
                `Invalid model format "${modelString}". Expected "provider/model-name" ` +
                `(e.g. "openai/gpt-5.3-codex").`,
            );
        }
        const provider = modelString.slice(0, slashIdx) as LLMProviderName;
        const model = modelString.slice(slashIdx + 1);

        if (!["openai", "anthropic", "google"].includes(provider)) {
            throw new Error(
                `Unsupported provider "${provider}". Must be one of: openai, anthropic, google.`,
            );
        }
        if (!model) {
            throw new Error(`Model name is empty in "${modelString}".`);
        }
        return { provider, model };
    }

    /** Resolve the API key for a provider. */
    resolveApiKey(provider: LLMProviderName): string {
        const key =
            this.config.apiKeys?.[provider] ?? process.env[ENV_KEYS[provider]];
        if (!key) {
            throw new Error(
                `No API key for "${provider}". Provide it in the constructor ` +
                `or set the ${ENV_KEYS[provider]} environment variable.`,
            );
        }
        return key;
    }

    /** Validate common parameters. */
    private validateRequest(req: ChatRequest): void {
        if (!req.messages.length) {
            throw new Error("messages array must not be empty.");
        }
        if (req.temperature !== undefined) {
            if (req.temperature < 0 || req.temperature > 2) {
                throw new Error(
                    `temperature must be between 0 and 2, got ${req.temperature}.`,
                );
            }
        }
        if (req.topP !== undefined) {
            if (req.topP < 0 || req.topP > 1) {
                throw new Error(
                    `topP must be between 0 and 1, got ${req.topP}.`,
                );
            }
        }
        if (req.maxTokens !== undefined && req.maxTokens <= 0) {
            throw new Error(
                `maxTokens must be positive, got ${req.maxTokens}.`,
            );
        }
    }

    /** Get the adapter for a provider. */
    private getAdapter(
        provider: LLMProviderName,
        apiKey: string,
    ): ProviderAdapter {
        switch (provider) {
            case "openai":
                return openaiAdapter(apiKey);
            case "anthropic":
                return anthropicAdapter(apiKey);
            case "google":
                return googleAdapter(apiKey);
        }
    }

    /**
     * Send a chat completion request to the specified model.
     *
     * @param modelString - Model in `provider/model-name` format.
     * @param request - Chat request parameters.
     * @returns The chat response with content and usage info.
     */
    async chat(
        modelString: string,
        request: ChatRequest,
    ): Promise<ChatResponse> {
        const { provider, model } = this.parseModel(modelString);
        const apiKey = this.resolveApiKey(provider);

        // Merge defaults
        const merged: ChatRequest = {
            ...request,
            temperature:
                request.temperature ?? this.config.defaults?.temperature,
            maxTokens: request.maxTokens ?? this.config.defaults?.maxTokens,
            topP: request.topP ?? this.config.defaults?.topP,
        };

        this.validateRequest(merged);

        const adapter = this.getAdapter(provider, apiKey);
        const { url, headers, body } = adapter.buildRequest(model, merged);

        this.eventBus?.emit("llm:request", { model: modelString, provider });

        try {
            const response = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(
                    `${provider} API error (${response.status}): ${errorText}`,
                );
            }

            const raw = await response.json();
            const parsed = adapter.parseResponse(raw);

            this.eventBus?.emit("llm:response", {
                model: modelString,
                provider,
                usage: parsed.usage,
            });

            return {
                content: parsed.content,
                usage: parsed.usage,
                model: modelString,
                provider,
                raw,
            };
        } catch (err) {
            const errorMsg =
                err instanceof Error ? err.message : String(err);
            this.eventBus?.emit("llm:error", {
                model: modelString,
                provider,
                error: errorMsg,
            });
            throw err;
        }
    }
}
