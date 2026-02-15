import type { EventBus } from "./event-bus.js";
import type { LLMClient } from "./llm-client.js";
import type { ChatMessage, ConversationSummary } from "./types.js";

/**
 * Per-agent conversation history with token estimation and
 * LLM-powered summarization for context window management.
 *
 * When a conversation exceeds a token budget, `summarize()` compresses
 * older messages into a summary, allowing agents to maintain context
 * over long-running tasks without overflowing the LLM context window.
 */
export class ConversationHistory {
    /** The raw message log (append-only). */
    private messages: ChatMessage[] = [];
    /** Summaries generated from older messages. */
    private summaries: ConversationSummary[] = [];

    private agentName: string;
    private eventBus: EventBus;
    private correlationId: string;

    /** Average chars per token for estimation (GPT-family heuristic). */
    private static readonly CHARS_PER_TOKEN = 4;

    constructor(agentName: string, eventBus: EventBus, correlationId: string) {
        this.agentName = agentName;
        this.eventBus = eventBus;
        this.correlationId = correlationId;
    }

    // ── Basic Operations ─────────────────────────────────────────────────

    /** Append a message to the history. */
    append(message: ChatMessage): void {
        this.messages.push(message);
    }

    /** Get all messages in order. */
    getMessages(): ChatMessage[] {
        return [...this.messages];
    }

    /** Get the count of messages. */
    get messageCount(): number {
        return this.messages.length;
    }

    /** Get current conversation summaries. */
    getSummaries(): ConversationSummary[] {
        return [...this.summaries];
    }

    /** Get the latest summary, or null if none exist. */
    getLatestSummary(): ConversationSummary | null {
        return this.summaries.length > 0
            ? this.summaries[this.summaries.length - 1]
            : null;
    }

    // ── Token Estimation ─────────────────────────────────────────────────

    /** Estimate the token count for a string. */
    static estimateTokens(text: string): number {
        return Math.ceil(text.length / ConversationHistory.CHARS_PER_TOKEN);
    }

    /** Estimate total tokens for all messages. */
    estimateTotalTokens(): number {
        return this.messages.reduce(
            (sum, msg) => sum + ConversationHistory.estimateTokens(msg.content),
            0,
        );
    }

    // ── Context Window ───────────────────────────────────────────────────

    /**
     * Build a context-aware message list that fits within a token budget.
     * Returns the latest summary (if any) followed by as many recent
     * messages as fit within `maxTokens`.
     *
     * @param maxTokens - Maximum token budget for the context window.
     * @returns Array of messages to include in the LLM prompt.
     */
    getContextWindow(maxTokens: number): ChatMessage[] {
        const result: ChatMessage[] = [];
        let remainingTokens = maxTokens;

        // Include latest summary as a system message
        const summary = this.getLatestSummary();
        if (summary) {
            const summaryTokens = ConversationHistory.estimateTokens(summary.summary);
            if (summaryTokens <= remainingTokens) {
                result.push({
                    role: "system",
                    content: `[Conversation Summary]\n${summary.summary}`,
                });
                remainingTokens -= summaryTokens;
            }
        }

        // Add recent messages from newest to oldest, then reverse
        const recentMessages: ChatMessage[] = [];
        for (let i = this.messages.length - 1; i >= 0; i--) {
            const msg = this.messages[i];
            const tokens = ConversationHistory.estimateTokens(msg.content);
            if (tokens > remainingTokens) break;
            recentMessages.unshift(msg);
            remainingTokens -= tokens;
        }

        result.push(...recentMessages);
        return result;
    }

    // ── Summarization ────────────────────────────────────────────────────

    /**
     * Summarize the conversation history using an LLM.
     * If no LLM client is provided, generates a deterministic fallback summary.
     *
     * @param llmClient - Optional LLM client for AI-powered summarization.
     * @param model - Optional model string (e.g. "openai/gpt-4o").
     * @returns The generated summary.
     */
    async summarize(
        llmClient?: LLMClient,
        model?: string,
    ): Promise<ConversationSummary> {
        if (this.messages.length === 0) {
            const empty: ConversationSummary = {
                summary: "No messages to summarize.",
                messageCount: 0,
                tokenEstimate: 0,
                createdAt: new Date().toISOString(),
            };
            this.summaries.push(empty);
            return empty;
        }

        const messageCount = this.messages.length;
        const tokenEstimate = this.estimateTotalTokens();

        let summaryText: string;

        if (llmClient && model) {
            // LLM-powered summarization
            const conversationText = this.messages
                .map((m) => `${m.role}: ${m.content}`)
                .join("\n");

            const response = await llmClient.chat(model, {
                messages: [
                    {
                        role: "user",
                        content:
                            `Summarize the following conversation between an AI agent and its tools/interactions. ` +
                            `Preserve key findings, decisions, and important context. Be concise.\n\n` +
                            `${conversationText}`,
                    },
                ],
                systemPrompt:
                    "You are a summarization assistant. Output only the summary, nothing else.",
                maxTokens: 500,
                temperature: 0.2,
            });
            summaryText = response.content.trim();
        } else {
            // Deterministic fallback
            const roles = new Map<string, number>();
            for (const msg of this.messages) {
                roles.set(msg.role, (roles.get(msg.role) ?? 0) + 1);
            }
            const roleBreakdown = [...roles.entries()]
                .map(([role, count]) => `${role}: ${count}`)
                .join(", ");

            const lastMessages = this.messages.slice(-3);
            const lastContent = lastMessages
                .map((m) => `[${m.role}] ${m.content.slice(0, 100)}`)
                .join(" | ");

            summaryText =
                `Conversation with ${messageCount} messages (~${tokenEstimate} tokens). ` +
                `Role breakdown: ${roleBreakdown}. ` +
                `Recent context: ${lastContent}`;
        }

        const summary: ConversationSummary = {
            summary: summaryText,
            messageCount,
            tokenEstimate,
            createdAt: new Date().toISOString(),
        };

        this.summaries.push(summary);

        this.eventBus.emit(
            "memory:summarized",
            { agentName: this.agentName, messageCount },
            this.correlationId,
        );

        return summary;
    }

    /** Clear all messages and summaries. */
    clear(): void {
        this.messages = [];
        this.summaries = [];
    }
}
