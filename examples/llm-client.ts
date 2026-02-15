/**
 * LLM Client Example
 *
 * Demonstrates the unified LLM client supporting OpenAI, Anthropic, and Google.
 * Shows model naming convention, reasoning effort configuration,
 * and provider-specific parameter handling.
 *
 * Usage: npx tsx examples/llm-client.ts
 *
 * Before running, set at least one API key:
 *   export OPENAI_API_KEY="sk-..."
 *   export ANTHROPIC_API_KEY="sk-ant-..."
 *   export GOOGLE_API_KEY="AIza..."
 */
import { LLMClient, EventBus } from "../src/index.js";

async function main() {
    const bus = new EventBus();

    // ── 1. Create the LLM client ────────────────────────────────────────────
    // API keys can be provided directly or via environment variables.
    const client = new LLMClient(
        {
            apiKeys: {
                // Explicit keys (override env vars):
                // openai: "sk-...",
                // anthropic: "sk-ant-...",
                // google: "AIza...",
            },
            defaults: {
                temperature: 0.7,
                maxTokens: 1024,
            },
        },
        bus, // optional — enables llm:request/response/error events
    );

    // ── 2. Event observability ──────────────────────────────────────────────
    bus.on("llm:request", (e) => {
        console.log(`  📤 Request to ${e.provider}/${e.model}`);
    });
    bus.on("llm:response", (e) => {
        console.log(`  📥 Response from ${e.provider} — tokens: ${JSON.stringify(e.usage)}`);
    });
    bus.on("llm:error", (e) => {
        console.log(`  ❌ Error from ${e.provider}: ${e.error.slice(0, 80)}`);
    });

    // ── 3. Model naming: "provider/model-name" ──────────────────────────────
    console.log("\n▶ Model parsing examples:\n");
    const models = [
        "openai/gpt-5.3-codex",
        "anthropic/claude-opus-4.6",
        "google/gemini-3-pro-preview",
        "google/gemini-2.5-flash",
    ];
    for (const m of models) {
        const parsed = client.parseModel(m);
        console.log(`  ${m} → provider="${parsed.provider}", model="${parsed.model}"`);
    }

    // ── 4. OpenAI with reasoning effort ─────────────────────────────────────
    console.log("\n▶ OpenAI chat (reasoning_effort: high):\n");
    try {
        const response = await client.chat("openai/gpt-5.3-codex", {
            messages: [{ role: "user", content: "Explain quantum computing in 3 sentences." }],
            systemPrompt: "You are a physics professor.",
            reasoningEffort: "high",   // OpenAI: "minimal" | "low" | "medium" | "high"
            temperature: 0.5,
        });
        console.log(`  Response: ${response.content.slice(0, 200)}`);
        console.log(`  Tokens: ${JSON.stringify(response.usage)}`);
    } catch (e) {
        console.log(`  (Skipped — ${(e as Error).message.slice(0, 60)})`);
    }

    // ── 5. Anthropic with thinking effort ───────────────────────────────────
    console.log("\n▶ Anthropic chat (thinking effort: max):\n");
    try {
        const response = await client.chat("anthropic/claude-opus-4.6", {
            messages: [{ role: "user", content: "Prove the Pythagorean theorem." }],
            reasoningEffort: "max",    // Anthropic: "low" | "medium" | "high" | "max"
            maxTokens: 2048,
        });
        console.log(`  Response: ${response.content.slice(0, 200)}`);
    } catch (e) {
        console.log(`  (Skipped — ${(e as Error).message.slice(0, 60)})`);
    }

    // ── 6. Google Gemini 3 with thinking level ──────────────────────────────
    console.log("\n▶ Google Gemini 3 chat (thinkingLevel: low):\n");
    try {
        const response = await client.chat("google/gemini-3-pro-preview", {
            messages: [{ role: "user", content: "List 3 sorting algorithms." }],
            reasoningEffort: "low",    // Google Gemini 3: "minimal" | "low" | "medium" | "high"
        });
        console.log(`  Response: ${response.content.slice(0, 200)}`);
    } catch (e) {
        console.log(`  (Skipped — ${(e as Error).message.slice(0, 60)})`);
    }

    // ── 7. Google Gemini 2.5 with thinking budget ───────────────────────────
    console.log("\n▶ Google Gemini 2.5 chat (thinkingBudget: 4096):\n");
    try {
        const response = await client.chat("google/gemini-2.5-flash", {
            messages: [{ role: "user", content: "Explain recursion." }],
            thinkingBudget: 4096,      // Gemini 2.5: -1 to 32768
        });
        console.log(`  Response: ${response.content.slice(0, 200)}`);
    } catch (e) {
        console.log(`  (Skipped — ${(e as Error).message.slice(0, 60)})`);
    }

    // ── 8. Validation examples ──────────────────────────────────────────────
    console.log("\n▶ Validation checks:\n");

    // Invalid model format
    try {
        client.parseModel("gpt-5");
    } catch (e) {
        console.log(`  ✓ Invalid format: ${(e as Error).message}`);
    }

    // Unknown provider
    try {
        client.parseModel("mistral/large");
    } catch (e) {
        console.log(`  ✓ Unknown provider: ${(e as Error).message}`);
    }

    // Invalid reasoning effort for provider
    try {
        await client.chat("openai/gpt-5", {
            messages: [{ role: "user", content: "test" }],
            reasoningEffort: "max" as any, // "max" is Anthropic-only
        });
    } catch (e) {
        console.log(`  ✓ Wrong effort: ${(e as Error).message.slice(0, 80)}`);
    }
}

main().catch(console.error);
