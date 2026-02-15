import type {
    AgentDefinition,
    ToolDefinition,
    MCPDefinition,
} from "./types.js";

/**
 * Central registry that stores all agent, tool, and MCP definitions.
 * Enforces uniqueness and protects reserved names.
 */
export class Registry {
    private agents = new Map<string, AgentDefinition>();
    private tools = new Map<string, ToolDefinition>();
    private mcps = new Map<string, MCPDefinition>();

    // ── Agents ───────────────────────────────────────────────────────────

    /**
     * Register an agent definition.
     * @throws if an agent with the same name already exists.
     */
    registerAgent(def: AgentDefinition): void {
        if (this.agents.has(def.name)) {
            throw new Error(`Agent "${def.name}" is already registered.`);
        }
        this.agents.set(def.name, def);
    }

    /** Retrieve an agent definition by name. */
    getAgent(name: string): AgentDefinition | undefined {
        return this.agents.get(name);
    }

    /** List all registered agent definitions. */
    listAgents(): AgentDefinition[] {
        return Array.from(this.agents.values());
    }

    /** Check if an agent name is already registered. */
    hasAgent(name: string): boolean {
        return this.agents.has(name);
    }

    // ── Tools ────────────────────────────────────────────────────────────

    /**
     * Register a tool definition.
     * @throws if a tool with the same name already exists.
     */
    registerTool(def: ToolDefinition): void {
        if (this.tools.has(def.name)) {
            throw new Error(`Tool "${def.name}" is already registered.`);
        }
        this.tools.set(def.name, def);
    }

    /** Retrieve a tool definition by name. */
    getTool(name: string): ToolDefinition | undefined {
        return this.tools.get(name);
    }

    /** List all registered tool definitions. */
    listTools(): ToolDefinition[] {
        return Array.from(this.tools.values());
    }

    /** Check if a tool name is already registered. */
    hasTool(name: string): boolean {
        return this.tools.has(name);
    }

    // ── MCP ──────────────────────────────────────────────────────────────

    /**
     * Register an MCP server definition.
     * @throws if an MCP with the same name already exists.
     */
    registerMCP(def: MCPDefinition): void {
        if (this.mcps.has(def.name)) {
            throw new Error(`MCP "${def.name}" is already registered.`);
        }
        this.mcps.set(def.name, def);
    }

    /** Retrieve an MCP definition by name. */
    getMCP(name: string): MCPDefinition | undefined {
        return this.mcps.get(name);
    }

    /** List all registered MCP definitions. */
    listMCPs(): MCPDefinition[] {
        return Array.from(this.mcps.values());
    }

    /** Check if an MCP name is already registered. */
    hasMCP(name: string): boolean {
        return this.mcps.has(name);
    }
}
