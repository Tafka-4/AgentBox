import type { z } from "zod";
import type { ToolDefinition } from "./types.js";

/**
 * AgentTool wraps a `ToolDefinition` to provide runtime input validation
 * via Zod and a serialization helper for LLM function-calling.
 */
export class AgentTool<TInput = unknown, TOutput = unknown> {
    public readonly name: string;
    public readonly description: string | undefined;
    public readonly inputSchema: z.ZodType<TInput>;
    private readonly executeFn: (input: TInput) => Promise<TOutput>;

    constructor(def: ToolDefinition<TInput, TOutput>) {
        this.name = def.name;
        this.description = def.description;
        this.inputSchema = def.inputSchema;
        this.executeFn = def.execute;
    }

    /**
     * Get the stringified source of the execute function.
     * Used for cache key computation in tool auto-description.
     */
    get executeSource(): string {
        return this.executeFn.toString();
    }

    /**
     * Validate input and execute the tool.
     * @throws ZodError if input validation fails.
     */
    async execute(input: unknown): Promise<TOutput> {
        const parsed = this.inputSchema.parse(input) as TInput;
        return this.executeFn(parsed);
    }

    /** Serialize for LLM function-calling. */
    toJSON(): {
        name: string;
        description: string | undefined;
        parameters: unknown;
    } {
        return {
            name: this.name,
            description: this.description,
            parameters:
                "shape" in this.inputSchema
                    ? jsonSchemaFromZod(this.inputSchema)
                    : {},
        };
    }

    /** Update description (used by auto-description generator). */
    setDescription(desc: string): void {
        (this as { description: string | undefined }).description = desc;
    }
}

/**
 * Minimal Zod-to-JSON-Schema extractor.
 * This handles common cases; for full fidelity use `zod-to-json-schema`.
 */
function jsonSchemaFromZod(schema: z.ZodType): Record<string, unknown> {
    const def = (schema as unknown as { _def: Record<string, unknown> })._def;
    const typeName = def.typeName as string | undefined;

    switch (typeName) {
        case "ZodObject": {
            const shape = (
                schema as unknown as { shape: Record<string, z.ZodType> }
            ).shape;
            const properties: Record<string, unknown> = {};
            const required: string[] = [];

            for (const [key, val] of Object.entries(shape)) {
                properties[key] = jsonSchemaFromZod(val);
                if (
                    !(
                        val as unknown as { _def: { typeName: string } }
                    )._def.typeName.includes("Optional")
                ) {
                    required.push(key);
                }
            }
            return { type: "object", properties, required };
        }
        case "ZodString":
            return { type: "string" };
        case "ZodNumber":
            return { type: "number" };
        case "ZodBoolean":
            return { type: "boolean" };
        case "ZodArray":
            return {
                type: "array",
                items: jsonSchemaFromZod(
                    (def as { type: z.ZodType }).type,
                ),
            };
        case "ZodOptional":
            return jsonSchemaFromZod(
                (def as { innerType: z.ZodType }).innerType,
            );
        default:
            return {};
    }
}
