import hashIt from "hash-it";
import type { AgentTool } from "./tool.js";
import type { LLMClient } from "./llm-client.js";

/**
 * In-memory cache for auto-generated tool descriptions.
 * Uses a combined hash of the tool's execute function, schema, and agent context
 * to avoid redundant LLM calls.
 */
export class ToolDescriptionCache {
    private cache = new Map<string, string>();

    /**
     * Compute a deterministic cache key from the tool + agent context.
     * Uses the spec-mandated triple: `executeHash + schemaHash + agentPromptHash`.
     */
    computeHash(tool: AgentTool, agentPrompt: string): string {
        const executeHash = hashIt(tool.executeSource);
        const schemaHash = hashIt(JSON.stringify(tool.toJSON().parameters));
        const promptHash = hashIt(agentPrompt);
        return `${executeHash}-${schemaHash}-${promptHash}`;
    }

    /** Get a cached description or undefined. */
    get(key: string): string | undefined {
        return this.cache.get(key);
    }

    /** Store a description. */
    set(key: string, description: string): void {
        this.cache.set(key, description);
    }

    /** Check if a cache entry exists. */
    has(key: string): boolean {
        return this.cache.has(key);
    }

    /** Clear the cache. */
    clear(): void {
        this.cache.clear();
    }
}

/**
 * Generate a description for a tool that lacks one.
 * When an `llmClient` and `model` are provided, uses the LLM to produce
 * the description. Otherwise falls back to a deterministic placeholder.
 *
 * @returns The generated description string.
 */
export async function generateToolDescription(
    tool: AgentTool,
    agentPrompt: string,
    cache: ToolDescriptionCache,
    llmClient?: LLMClient,
    model?: string,
): Promise<string> {
    const key = cache.computeHash(tool, agentPrompt);

    // Cache hit
    const cached = cache.get(key);
    if (cached) return cached;

    let generated: string;

    if (llmClient && model) {
        // Use the LLM to generate a real description
        const response = await llmClient.chat(model, {
            messages: [
                {
                    role: "user",
                    content:
                        `Generate a concise, one-sentence description for a tool named "${tool.name}". ` +
                        `Input schema: ${JSON.stringify(tool.toJSON().parameters)}. ` +
                        `Agent context: ${agentPrompt.slice(0, 200)}`,
                },
            ],
            systemPrompt:
                "You are a technical writer. Output only the tool description, nothing else.",
            maxTokens: 100,
            temperature: 0.3,
        });
        generated = response.content.trim();
    } else {
        // Placeholder fallback
        generated =
            `Auto-generated description for tool "${tool.name}". ` +
            `Input schema: ${JSON.stringify(tool.toJSON().parameters)}. ` +
            `Agent context length: ${agentPrompt.length} chars.`;
    }

    cache.set(key, generated);
    return generated;
}

/**
 * Ensure all tools in a set have descriptions —
 * auto-generating where missing.
 */
export async function ensureToolDescriptions(
    tools: AgentTool[],
    agentPrompt: string,
    cache: ToolDescriptionCache,
    llmClient?: LLMClient,
    model?: string,
): Promise<void> {
    const pending = tools.filter((t) => !t.description);
    await Promise.all(
        pending.map(async (tool) => {
            const desc = await generateToolDescription(
                tool,
                agentPrompt,
                cache,
                llmClient,
                model,
            );
            tool.setDescription(desc);
        }),
    );
}
