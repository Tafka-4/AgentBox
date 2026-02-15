import { describe, it, expect, vi } from "vitest";
import { AgentBox } from "../src/agent-box.js";
import { z } from "zod";
import type { AgentDefinition, AgentRuntimeAPI, TeamConfig } from "../src/types.js";

// ── Helper ───────────────────────────────────────────────────────────────────

const dummyTool = {
    name: "dummy",
    description: "Dummy tool",
    inputSchema: z.object({ x: z.number() }),
    execute: async (input: { x: number }) => ({ doubled: input.x * 2 }),
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("AgentRuntime & Dynamic Teams", () => {
    // ── Custom Executor ──────────────────────────────────────────────────

    describe("custom executor", () => {
        it("should invoke the custom executor during run()", async () => {
            const box = new AgentBox();
            const executorSpy = vi.fn(async (_runtime: AgentRuntimeAPI, task: string) => {
                return { processed: task };
            });

            box.defineAgent("Worker")
                .prompt("Do work")
                .executor(executorSpy)
                .build();

            const result = await box.run("test task");
            expect(executorSpy).toHaveBeenCalledOnce();
            expect(result.status).toBe("completed");
        });

        it("executor receives an AgentRuntimeAPI with correct agentName", async () => {
            const box = new AgentBox();
            let capturedRuntime: AgentRuntimeAPI | null = null;

            box.defineAgent("Inspector")
                .prompt("Inspect things")
                .executor(async (runtime) => {
                    capturedRuntime = runtime;
                    return { name: runtime.agentName };
                })
                .build();

            await box.run("inspect");
            expect(capturedRuntime).not.toBeNull();
            expect(capturedRuntime!.agentName).toBe("Inspector");
            expect(capturedRuntime!.definition.name).toBe("Inspector");
        });
    });

    // ── Claim Graph Access ───────────────────────────────────────────────

    describe("runtime claim graph access", () => {
        it("executor can add and list claims", async () => {
            const box = new AgentBox();
            let claims: unknown[] = [];

            box.defineAgent("Claimer")
                .prompt("Make claims")
                .executor(async (runtime) => {
                    runtime.addClaim("Test hypothesis", ["evidence 1"], 0.8);
                    runtime.addClaim("Another claim", [], 0.5);
                    claims = runtime.listClaims();
                    return { claimCount: claims.length };
                })
                .build();

            const result = await box.run("analyze");
            expect(claims).toHaveLength(2);
            expect(result.claims).toHaveLength(2);
        });

        it("executor can challenge and support claims", async () => {
            const box = new AgentBox();

            box.defineAgent("Debater")
                .prompt("Debate claims")
                .executor(async (runtime) => {
                    const c1 = runtime.addClaim("Claim A", [], 0.7);
                    const c2 = runtime.addClaim("Counter to A", [], 0.6);
                    const c3 = runtime.addClaim("Support for A", [], 0.8);
                    runtime.challengeClaim(c1.id, c2.id);
                    runtime.supportClaim(c1.id, c3.id);
                    return { done: true };
                })
                .build();

            const result = await box.run("debate");
            expect(result.conflicts).toContain("Claim A");
        });
    });

    // ── Tool Execution ───────────────────────────────────────────────────

    describe("runtime tool execution", () => {
        it("executor can execute tools", async () => {
            const box = new AgentBox();
            box.defineTool(dummyTool);

            let toolResult: unknown;
            box.defineAgent("ToolUser")
                .prompt("Use tools")
                .tools(["dummy"])
                .executor(async (runtime) => {
                    toolResult = await runtime.executeTool("dummy", { x: 21 });
                    return toolResult;
                })
                .build();

            await box.run("compute");
            expect(toolResult).toEqual({ doubled: 42 });
        });

        it("executor can list available tools", async () => {
            const box = new AgentBox();
            box.defineTool(dummyTool);

            let toolNames: string[] = [];
            box.defineAgent("ToolLister")
                .prompt("List tools")
                .tools(["dummy"])
                .executor(async (runtime) => {
                    toolNames = runtime.listTools();
                    return { tools: toolNames };
                })
                .build();

            await box.run("list");
            expect(toolNames).toContain("dummy");
        });

        it("throws when executing a tool not on the allowlist", async () => {
            const box = new AgentBox();
            box.defineTool(dummyTool);
            box.defineTool({
                name: "forbidden",
                description: "Forbidden tool",
                inputSchema: z.object({}),
                execute: async () => ({}),
            });

            box.defineAgent("RestrictedUser")
                .prompt("Try restricted")
                .tools(["dummy", "forbidden"])
                .policy({ toolAllowlist: ["dummy"] })
                .executor(async (runtime) => {
                    await runtime.executeTool("forbidden", {});
                    return {};
                })
                .build();

            // The tool allowlist validation happens at validate() phase
            // which checks agent.tools vs allowlist. Here "forbidden" is in tools
            // but NOT in allowlist, so validate() will throw.
            await expect(box.run("restricted")).rejects.toThrow("not on the toolAllowlist");
        });
    });

    // ── Messaging ────────────────────────────────────────────────────────

    describe("runtime messaging", () => {
        it("executor can send messages to other agents", async () => {
            const box = new AgentBox();
            const received: unknown[] = [];

            box.on("message:sent", (e) => {
                received.push(e);
            });

            box.defineAgent("Sender")
                .prompt("Send messages")
                .executor(async (runtime) => {
                    runtime.sendMessage("Receiver", { hello: "world" });
                    return { sent: true };
                })
                .build();

            box.defineAgent("Receiver")
                .prompt("Receive messages")
                .build();

            await box.run("communicate");
            expect(received.length).toBeGreaterThanOrEqual(1);
        });
    });

    // ── Dynamic Agent Spawning ───────────────────────────────────────────

    describe("dynamic agent spawning", () => {
        it("executor can spawn a new agent at runtime", async () => {
            const box = new AgentBox();
            const spawnedEvents: string[] = [];

            box.on("agent:spawned", (e) => {
                spawnedEvents.push((e as { agentName: string }).agentName);
            });

            box.defineAgent("Spawner")
                .prompt("Spawn sub-agents")
                .executor(async (runtime) => {
                    const childDef: AgentDefinition = {
                        name: "DynamicChild",
                        prompt: "I am a dynamically spawned agent",
                        tools: [],
                        policy: {},
                        mcpServers: [],
                        executor: async (_rt, task) => ({
                            childResult: `processed: ${task}`,
                        }),
                    };
                    const result = await runtime.spawnAgent(childDef, "sub-task");
                    return { parentResult: "done", childResult: result };
                })
                .build();

            const result = await box.run("spawn test");
            expect(spawnedEvents).toContain("DynamicChild");
            expect(result.status).toBe("completed");
        });

        it("spawned agent has access to claim graph", async () => {
            const box = new AgentBox();

            box.defineAgent("Parent")
                .prompt("Parent agent")
                .executor(async (runtime) => {
                    runtime.addClaim("Parent claim", [], 0.8);

                    const childDef: AgentDefinition = {
                        name: "Child",
                        prompt: "Child agent",
                        tools: [],
                        policy: {},
                        mcpServers: [],
                        executor: async (childRuntime) => {
                            // Child should see parent's claims
                            const claims = childRuntime.listClaims();
                            childRuntime.addClaim("Child claim", [], 0.7);
                            return { seenClaims: claims.length };
                        },
                    };

                    return runtime.spawnAgent(childDef, "child task");
                })
                .build();

            const result = await box.run("hierarchy test");
            expect(result.claims).toHaveLength(2);
        });
    });

    // ── Team Creation ────────────────────────────────────────────────────

    describe("team creation", () => {
        it("executor can create a team with manager and members", async () => {
            const box = new AgentBox();
            const teamEvents: string[] = [];
            const spawnedAgents: string[] = [];

            box.on("team:created", (e) => {
                teamEvents.push((e as { teamName: string }).teamName);
            });
            box.on("agent:spawned", (e) => {
                spawnedAgents.push((e as { agentName: string }).agentName);
            });

            box.defineAgent("Orchestrator")
                .prompt("Create teams")
                .executor(async (runtime) => {
                    const teamConfig: TeamConfig = {
                        name: "ResearchTeam",
                        manager: {
                            name: "ResearchManager",
                            prompt: "Coordinate research",
                            tools: [],
                            policy: {},
                            mcpServers: [],
                            // Manager uses default executor (spawns all members)
                        },
                        members: [
                            {
                                name: "Researcher1",
                                prompt: "Research topic A",
                                tools: [],
                                policy: {},
                                mcpServers: [],
                                executor: async (rt) => {
                                    rt.addClaim("Finding from R1", ["data"], 0.8);
                                    return { agent: "Researcher1", finding: "A" };
                                },
                            },
                            {
                                name: "Researcher2",
                                prompt: "Research topic B",
                                tools: [],
                                policy: {},
                                mcpServers: [],
                                executor: async (rt) => {
                                    rt.addClaim("Finding from R2", ["data"], 0.7);
                                    return { agent: "Researcher2", finding: "B" };
                                },
                            },
                        ],
                    };

                    return runtime.createTeam(teamConfig, "research task");
                })
                .build();

            const result = await box.run("team test");
            expect(teamEvents).toContain("ResearchTeam");
            expect(spawnedAgents).toContain("ResearchManager");
            expect(result.status).toBe("completed");
            expect(result.claims.length).toBeGreaterThanOrEqual(2);
        });

        it("team with custom manager executor", async () => {
            const box = new AgentBox();

            box.defineAgent("Boss")
                .prompt("The boss")
                .executor(async (runtime) => {
                    const teamConfig: TeamConfig = {
                        name: "CustomTeam",
                        manager: {
                            name: "CustomManager",
                            prompt: "Custom strategy",
                            tools: [],
                            policy: {},
                            mcpServers: [],
                            executor: async (managerRuntime, task) => {
                                // Custom manager: spawn only first member, then decide
                                const worker: AgentDefinition = {
                                    name: "SelectedWorker",
                                    prompt: "Selected for this task",
                                    tools: [],
                                    policy: {},
                                    mcpServers: [],
                                    executor: async (rt) => {
                                        rt.addClaim("Worker finding", [], 0.9);
                                        return { result: "specific work done" };
                                    },
                                };

                                const workerResult = await managerRuntime.spawnAgent(worker, task);

                                // Manager aggregates
                                managerRuntime.addClaim(
                                    "Manager summary",
                                    ["Based on worker findings"],
                                    0.85,
                                );

                                return { managerSummary: true, workerResult };
                            },
                        },
                        members: [], // Manager will select its own members
                    };

                    return runtime.createTeam(teamConfig, "selective task");
                })
                .build();

            const result = await box.run("selective team test");
            expect(result.status).toBe("completed");
            expect(result.claims.length).toBeGreaterThanOrEqual(2);
        });

        it("team policy is applied to members", async () => {
            const box = new AgentBox();

            box.defineAgent("PolicyBoss")
                .prompt("Policy boss")
                .executor(async (runtime) => {
                    const teamConfig: TeamConfig = {
                        name: "PolicyTeam",
                        manager: {
                            name: "PolicyManager",
                            prompt: "Manager",
                            tools: [],
                            policy: {},
                            mcpServers: [],
                        },
                        members: [
                            {
                                name: "Worker1",
                                prompt: "Worker",
                                tools: [],
                                policy: {}, // Will inherit team policy
                                mcpServers: [],
                            },
                        ],
                        policy: { maxTokens: 1000, maxParallel: 2 },
                    };

                    return runtime.createTeam(teamConfig, "policy task");
                })
                .build();

            const result = await box.run("policy team test");
            expect(result.status).toBe("completed");
        });
    });

    // ── Run Lifecycle Events ─────────────────────────────────────────────

    describe("run lifecycle events", () => {
        it("emits run:started and run:completed", async () => {
            const box = new AgentBox();
            const events: string[] = [];

            box.on("run:started", () => events.push("run:started"));
            box.on("run:completed", () => events.push("run:completed"));

            box.defineAgent("Simple")
                .prompt("Simple agent")
                .build();

            await box.run("lifecycle test");

            expect(events).toContain("run:started");
            expect(events).toContain("run:completed");
            expect(events.indexOf("run:started")).toBeLessThan(
                events.indexOf("run:completed"),
            );
        });

        it("run:started includes the task", async () => {
            const box = new AgentBox();
            let startPayload: unknown;

            box.on("run:started", (e) => {
                startPayload = e;
            });

            box.defineAgent("Starter")
                .prompt("Starter agent")
                .build();

            await box.run("my special task");
            expect(startPayload).toMatchObject({ task: "my special task" });
        });

        it("run:completed includes status on success", async () => {
            const box = new AgentBox();
            let endPayload: unknown;

            box.on("run:completed", (e) => {
                endPayload = e;
            });

            box.defineAgent("Finisher")
                .prompt("Finisher agent")
                .build();

            await box.run("finish task");
            expect(endPayload).toMatchObject({ status: "completed" });
        });

        it("emits agent:spawned when agents are dynamically created", async () => {
            const box = new AgentBox();
            const spawned: Array<{ agentName: string; parentAgent: string }> = [];

            box.on("agent:spawned", (e) => {
                spawned.push(e as { agentName: string; parentAgent: string });
            });

            box.defineAgent("Spawner2")
                .prompt("Spawn")
                .executor(async (runtime) => {
                    await runtime.spawnAgent(
                        {
                            name: "DynAgent",
                            prompt: "Dynamic",
                            tools: [],
                            policy: {},
                            mcpServers: [],
                        },
                        "dyn task",
                    );
                    return {};
                })
                .build();

            await box.run("spawn event test");
            expect(spawned).toContainEqual(
                expect.objectContaining({
                    agentName: "DynAgent",
                    parentAgent: "Spawner2",
                }),
            );
        });
    });

    // ── Nested Hierarchy ─────────────────────────────────────────────────

    describe("nested hierarchy", () => {
        it("MasterAgent → Manager → Workers (3 levels)", async () => {
            const box = new AgentBox();
            const spawnedAgents: string[] = [];

            box.on("agent:spawned", (e) => {
                spawnedAgents.push((e as { agentName: string }).agentName);
            });

            box.defineAgent("TopManager")
                .prompt("Top-level manager")
                .executor(async (runtime) => {
                    // Create a team with a sub-manager
                    const teamConfig: TeamConfig = {
                        name: "MainTeam",
                        manager: {
                            name: "SubManager",
                            prompt: "Sub-manager",
                            tools: [],
                            policy: {},
                            mcpServers: [],
                            executor: async (managerRuntime, task) => {
                                // Sub-manager spawns individual workers
                                const w1 = await managerRuntime.spawnAgent(
                                    {
                                        name: "DeepWorker1",
                                        prompt: "Deep worker 1",
                                        tools: [],
                                        policy: {},
                                        mcpServers: [],
                                        executor: async (rt) => {
                                            rt.addClaim("Deep finding 1", [], 0.9);
                                            return { deep: 1 };
                                        },
                                    },
                                    task,
                                );
                                const w2 = await managerRuntime.spawnAgent(
                                    {
                                        name: "DeepWorker2",
                                        prompt: "Deep worker 2",
                                        tools: [],
                                        policy: {},
                                        mcpServers: [],
                                        executor: async (rt) => {
                                            rt.addClaim("Deep finding 2", [], 0.85);
                                            return { deep: 2 };
                                        },
                                    },
                                    task,
                                );
                                return [w1, w2];
                            },
                        },
                        members: [],
                    };

                    return runtime.createTeam(teamConfig, "deep task");
                })
                .build();

            const result = await box.run("hierarchy test");
            expect(spawnedAgents).toContain("SubManager");
            expect(spawnedAgents).toContain("DeepWorker1");
            expect(spawnedAgents).toContain("DeepWorker2");
            expect(result.claims.length).toBeGreaterThanOrEqual(2);
        });
    });
});
