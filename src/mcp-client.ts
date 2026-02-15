import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { EventBus } from "./event-bus.js";
import type { MCPDefinition, MCPResource, MCPPrompt, ToolDefinition } from "./types.js";
import { z } from "zod";

/**
 * MCP client wrapper that connects to an MCP server and maps its
 * tools/resources/prompts to the AgentBox internal DSL.
 */
export class MCPClient {
    private client: Client | null = null;
    private definition: MCPDefinition;
    private eventBus: EventBus;
    private connected = false;

    constructor(definition: MCPDefinition, eventBus: EventBus) {
        this.definition = definition;
        this.eventBus = eventBus;
    }

    /** The MCP definition this client was created from. */
    get name(): string {
        return this.definition.name;
    }

    /** Whether the client is currently connected. */
    get isConnected(): boolean {
        return this.connected;
    }

    /** Connect to the MCP server. */
    async connect(): Promise<void> {
        try {
            const transport = this.createTransport();
            this.client = new Client(
                { name: `agentbox-${this.definition.name}`, version: "0.1.0" },
                { capabilities: {} },
            );
            await this.client.connect(transport);
            this.connected = true;
            this.eventBus.emit("mcp:connected", { name: this.definition.name });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.eventBus.emit("mcp:error", {
                name: this.definition.name,
                error: message,
            });
            throw err;
        }
    }

    /** Create the appropriate transport based on the definition. */
    private createTransport(): SSEClientTransport | StdioClientTransport {
        if (this.definition.transport === "sse") {
            if (!this.definition.url) {
                throw new Error(
                    `MCP "${this.definition.name}": SSE transport requires a URL.`,
                );
            }
            return new SSEClientTransport(new URL(this.definition.url));
        }

        if (!this.definition.command) {
            throw new Error(
                `MCP "${this.definition.name}": stdio transport requires a command.`,
            );
        }
        return new StdioClientTransport({
            command: this.definition.command,
            args: this.definition.args,
        });
    }

    /**
     * List tools from the MCP server and map them to AgentBox ToolDefinitions.
     */
    async listTools(): Promise<ToolDefinition[]> {
        if (!this.client) throw new Error("MCP client not connected.");

        const response = await this.client.listTools();
        return response.tools.map((tool) =>
            this.mapMCPTool(tool.name, tool.description, tool.inputSchema),
        );
    }

    /** Map a single MCP tool to an AgentBox ToolDefinition. */
    private mapMCPTool(
        name: string,
        description: string | undefined,
        _inputSchema: unknown,
    ): ToolDefinition {
        const mcpName = `${this.definition.name}/${name}`;
        const client = this.client!;

        return {
            name: mcpName,
            description: description ?? undefined,
            inputSchema: z.record(z.unknown()),
            execute: async (input: unknown) => {
                const result = await client.callTool({
                    name,
                    arguments: input as Record<string, unknown>,
                });
                return result;
            },
        };
    }

    /**
     * List resources from the MCP server and map them to AgentBox MCPResource objects.
     */
    async listResources(): Promise<MCPResource[]> {
        if (!this.client) throw new Error("MCP client not connected.");

        try {
            const response = await this.client.listResources();
            return (response.resources ?? []).map((r) => ({
                name: `${this.definition.name}/${r.name}`,
                uri: r.uri,
                description: r.description,
                mimeType: r.mimeType,
            }));
        } catch {
            // Server may not support resources — return empty
            return [];
        }
    }

    /**
     * List prompts from the MCP server and map them to AgentBox MCPPrompt objects.
     */
    async listPrompts(): Promise<MCPPrompt[]> {
        if (!this.client) throw new Error("MCP client not connected.");

        try {
            const response = await this.client.listPrompts();
            return (response.prompts ?? []).map((p) => ({
                name: `${this.definition.name}/${p.name}`,
                description: p.description,
                arguments: p.arguments,
            }));
        } catch {
            // Server may not support prompts — return empty
            return [];
        }
    }

    /** Call a tool on the MCP server. */
    async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        if (!this.client) throw new Error("MCP client not connected.");
        return this.client.callTool({ name, arguments: args });
    }

    /** Disconnect from the MCP server. */
    async disconnect(): Promise<void> {
        if (this.client) {
            await this.client.close();
            this.client = null;
            this.connected = false;
        }
    }
}
