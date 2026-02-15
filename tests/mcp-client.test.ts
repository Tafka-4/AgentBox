import { describe, it, expect, vi, beforeEach } from "vitest";
import { MCPClient } from "../src/mcp-client.js";
import { EventBus } from "../src/event-bus.js";
import type { MCPDefinition } from "../src/types.js";

// Mock the @modelcontextprotocol/sdk modules
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
    Client: vi.fn().mockImplementation(() => ({
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        listTools: vi.fn().mockResolvedValue({
            tools: [
                {
                    name: "remote-search",
                    description: "Search remotely",
                    inputSchema: { type: "object" },
                },
                {
                    name: "remote-calc",
                    description: undefined,
                    inputSchema: { type: "object" },
                },
            ],
        }),
        listResources: vi.fn().mockResolvedValue({
            resources: [
                {
                    name: "docs",
                    uri: "file:///docs",
                    description: "Documentation files",
                    mimeType: "text/plain",
                },
            ],
        }),
        listPrompts: vi.fn().mockResolvedValue({
            prompts: [
                {
                    name: "summarize",
                    description: "Summarize a document",
                    arguments: [
                        { name: "text", description: "The text to summarize", required: true },
                    ],
                },
            ],
        }),
        callTool: vi.fn().mockResolvedValue({ result: "ok" }),
    })),
}));

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
    SSEClientTransport: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
    StdioClientTransport: vi.fn().mockImplementation(() => ({})),
}));

describe("MCPClient", () => {
    let bus: EventBus;

    beforeEach(() => {
        bus = new EventBus();
    });

    describe("construction", () => {
        it("exposes the name from the definition", () => {
            const def: MCPDefinition = {
                name: "test-server",
                transport: "sse",
                url: "http://localhost:3000",
            };
            const client = new MCPClient(def, bus);
            expect(client.name).toBe("test-server");
            expect(client.isConnected).toBe(false);
        });
    });

    describe("connect()", () => {
        it("connects with SSE transport and emits mcp:connected", async () => {
            const handler = vi.fn();
            bus.on("mcp:connected", handler);

            const def: MCPDefinition = {
                name: "sse-server",
                transport: "sse",
                url: "http://localhost:8080",
            };
            const client = new MCPClient(def, bus);

            await client.connect();

            expect(client.isConnected).toBe(true);
            expect(handler).toHaveBeenCalledOnce();
            expect(handler.mock.calls[0][0].name).toBe("sse-server");
        });

        it("connects with stdio transport", async () => {
            const def: MCPDefinition = {
                name: "stdio-server",
                transport: "stdio",
                command: "node",
                args: ["server.js"],
            };
            const client = new MCPClient(def, bus);
            await client.connect();
            expect(client.isConnected).toBe(true);
        });

        it("throws when SSE transport has no URL", async () => {
            const def: MCPDefinition = {
                name: "bad-sse",
                transport: "sse",
            };
            const client = new MCPClient(def, bus);
            await expect(client.connect()).rejects.toThrow(
                'MCP "bad-sse": SSE transport requires a URL.',
            );
        });

        it("throws when stdio transport has no command", async () => {
            const def: MCPDefinition = {
                name: "bad-stdio",
                transport: "stdio",
            };
            const client = new MCPClient(def, bus);
            await expect(client.connect()).rejects.toThrow(
                'MCP "bad-stdio": stdio transport requires a command.',
            );
        });

        it("emits mcp:error on connection failure", async () => {
            // Override the Client mock for this test to simulate failure
            const { Client } = await import(
                "@modelcontextprotocol/sdk/client/index.js"
            );
            (Client as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
                () => ({
                    connect: vi
                        .fn()
                        .mockRejectedValue(new Error("Connection refused")),
                    close: vi.fn(),
                }),
            );

            const errorHandler = vi.fn();
            bus.on("mcp:error", errorHandler);

            const def: MCPDefinition = {
                name: "fail-server",
                transport: "sse",
                url: "http://localhost:9999",
            };
            const client = new MCPClient(def, bus);

            await expect(client.connect()).rejects.toThrow("Connection refused");
            expect(errorHandler).toHaveBeenCalledOnce();
            expect(errorHandler.mock.calls[0][0].error).toBe("Connection refused");
        });
    });

    describe("listTools()", () => {
        it("maps MCP tools to ToolDefinitions with namespaced names", async () => {
            const def: MCPDefinition = {
                name: "my-server",
                transport: "sse",
                url: "http://localhost:8080",
            };
            const client = new MCPClient(def, bus);
            await client.connect();

            const tools = await client.listTools();

            expect(tools).toHaveLength(2);
            expect(tools[0].name).toBe("my-server/remote-search");
            expect(tools[0].description).toBe("Search remotely");
            expect(tools[0].inputSchema).toBeDefined();
            expect(typeof tools[0].execute).toBe("function");

            expect(tools[1].name).toBe("my-server/remote-calc");
            expect(tools[1].description).toBeUndefined();
        });

        it("throws if not connected", async () => {
            const def: MCPDefinition = {
                name: "not-connected",
                transport: "sse",
                url: "http://localhost:8080",
            };
            const client = new MCPClient(def, bus);

            await expect(client.listTools()).rejects.toThrow(
                "MCP client not connected.",
            );
        });
    });

    describe("callTool()", () => {
        it("forwards the call to the MCP client", async () => {
            const def: MCPDefinition = {
                name: "server",
                transport: "sse",
                url: "http://localhost:8080",
            };
            const client = new MCPClient(def, bus);
            await client.connect();

            const result = await client.callTool("search", { q: "hello" });
            expect(result).toEqual({ result: "ok" });
        });

        it("throws if not connected", async () => {
            const def: MCPDefinition = {
                name: "server",
                transport: "sse",
                url: "http://localhost:8080",
            };
            const client = new MCPClient(def, bus);
            await expect(
                client.callTool("search", { q: "hello" }),
            ).rejects.toThrow("MCP client not connected.");
        });
    });

    describe("disconnect()", () => {
        it("cleans up state after disconnect", async () => {
            const def: MCPDefinition = {
                name: "server",
                transport: "sse",
                url: "http://localhost:8080",
            };
            const client = new MCPClient(def, bus);
            await client.connect();
            expect(client.isConnected).toBe(true);

            await client.disconnect();
            expect(client.isConnected).toBe(false);
        });

        it("is safe to call when not connected", async () => {
            const def: MCPDefinition = {
                name: "server",
                transport: "sse",
                url: "http://localhost:8080",
            };
            const client = new MCPClient(def, bus);
            // Should not throw
            await client.disconnect();
        });
    });

    describe("listResources()", () => {
        it("maps MCP resources with namespaced names", async () => {
            const def: MCPDefinition = {
                name: "my-server",
                transport: "sse",
                url: "http://localhost:8080",
            };
            const client = new MCPClient(def, bus);
            await client.connect();

            const resources = await client.listResources();

            expect(resources).toHaveLength(1);
            expect(resources[0].name).toBe("my-server/docs");
            expect(resources[0].uri).toBe("file:///docs");
            expect(resources[0].description).toBe("Documentation files");
            expect(resources[0].mimeType).toBe("text/plain");
        });

        it("throws if not connected", async () => {
            const def: MCPDefinition = {
                name: "not-connected",
                transport: "sse",
                url: "http://localhost:8080",
            };
            const client = new MCPClient(def, bus);
            await expect(client.listResources()).rejects.toThrow(
                "MCP client not connected.",
            );
        });
    });

    describe("listPrompts()", () => {
        it("maps MCP prompts with namespaced names", async () => {
            const def: MCPDefinition = {
                name: "my-server",
                transport: "sse",
                url: "http://localhost:8080",
            };
            const client = new MCPClient(def, bus);
            await client.connect();

            const prompts = await client.listPrompts();

            expect(prompts).toHaveLength(1);
            expect(prompts[0].name).toBe("my-server/summarize");
            expect(prompts[0].description).toBe("Summarize a document");
            expect(prompts[0].arguments).toHaveLength(1);
            expect(prompts[0].arguments![0].name).toBe("text");
            expect(prompts[0].arguments![0].required).toBe(true);
        });

        it("throws if not connected", async () => {
            const def: MCPDefinition = {
                name: "not-connected",
                transport: "sse",
                url: "http://localhost:8080",
            };
            const client = new MCPClient(def, bus);
            await expect(client.listPrompts()).rejects.toThrow(
                "MCP client not connected.",
            );
        });
    });
});
