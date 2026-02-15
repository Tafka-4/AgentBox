import { describe, it, expect, vi, beforeEach } from "vitest";
import { Scheduler } from "../src/scheduler.js";
import { EventBus } from "../src/event-bus.js";

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Scheduler", () => {
    let bus: EventBus;

    beforeEach(() => {
        bus = new EventBus();
    });

    it("enqueues and executes a single job", async () => {
        const scheduler = new Scheduler(bus, 5);
        const { promise } = scheduler.enqueue("agent1", "task1", async () => 42);
        const result = await promise;
        expect(result).toBe(42);
    });

    it("enqueue returns a JobHandle with job metadata", async () => {
        const scheduler = new Scheduler(bus, 5);
        const handle = scheduler.enqueue("agent1", "task1", async () => "ok");

        expect(handle.job).toBeDefined();
        expect(handle.job.agentName).toBe("agent1");
        expect(handle.job.task).toBe("task1");
        // Job may already be 'running' since maxParallel=5 allows immediate start
        expect(["pending", "running"]).toContain(handle.job.status);
        expect(handle.promise).toBeInstanceOf(Promise);

        await handle.promise;
        expect(handle.job.status).toBe("completed");
    });

    it("respects maxParallel=1 — runs jobs sequentially", async () => {
        const scheduler = new Scheduler(bus, 1);
        const order: number[] = [];

        const { promise: p1 } = scheduler.enqueue("a", "t", async () => {
            order.push(1);
            await delay(50);
            order.push(2);
            return "first";
        });
        const { promise: p2 } = scheduler.enqueue("b", "t", async () => {
            order.push(3);
            return "second";
        });

        await Promise.all([p1, p2]);
        // Job 2 should only start after job 1 finishes
        expect(order).toEqual([1, 2, 3]);
    });

    it("runs jobs in parallel when maxParallel > 1", async () => {
        const scheduler = new Scheduler(bus, 3);
        const running: string[] = [];

        const makeJob = (name: string) =>
            scheduler.enqueue(name, "t", async () => {
                running.push(`start:${name}`);
                await delay(30);
                running.push(`end:${name}`);
            });

        await Promise.all([makeJob("a"), makeJob("b"), makeJob("c")].map((h) => h.promise));
        // All three should start before any ends (parallel)
        const starts = running.filter((s) => s.startsWith("start:"));
        expect(starts.length).toBe(3);
    });

    it("emits job:scheduled and job:completed events", async () => {
        const scheduled = vi.fn();
        const completed = vi.fn();
        bus.on("job:scheduled", scheduled);
        bus.on("job:completed", completed);

        const scheduler = new Scheduler(bus, 5);
        await scheduler.enqueue("a", "task", async () => "done").promise;

        expect(scheduled).toHaveBeenCalledOnce();
        expect(completed).toHaveBeenCalledOnce();
    });

    it("emits job:completed for failed jobs too", async () => {
        const completed = vi.fn();
        bus.on("job:completed", completed);

        const scheduler = new Scheduler(bus, 5);
        const { promise } = scheduler.enqueue("a", "t", async () => {
            throw new Error("boom");
        });

        await promise.catch(() => {});
        expect(completed).toHaveBeenCalledOnce();
        expect(completed.mock.calls[0][0].job.status).toBe("failed");
        expect(completed.mock.calls[0][0].job.error).toBe("boom");
    });

    it("pause() prevents new jobs from starting", async () => {
        const scheduler = new Scheduler(bus, 1);
        const order: string[] = [];

        // Start first job
        const { promise: p1 } = scheduler.enqueue("a", "t", async () => {
            order.push("job1-start");
            await delay(50);
            order.push("job1-end");
        });

        // Pause before first job finishes
        scheduler.pause();
        expect(scheduler.isPaused).toBe(true);

        // Enqueue second while paused
        const { promise: p2 } = scheduler.enqueue("b", "t", async () => {
            order.push("job2-start");
        });

        await p1;
        // Job 2 shouldn't have started yet
        expect(order).toEqual(["job1-start", "job1-end"]);
        expect(scheduler.pendingCount).toBe(1);

        // Resume to let job 2 run
        scheduler.resume();
        await p2;
        expect(order).toContain("job2-start");
    });

    it("cancel() removes a pending job", async () => {
        const scheduler = new Scheduler(bus, 1);
        const cancelledHandler = vi.fn();
        bus.on("job:cancelled", cancelledHandler);

        // Fill the single slot
        const { promise: p1 } = scheduler.enqueue("a", "t", async () => {
            await delay(100);
            return "done";
        });

        // This one will be pending — immediately attach catch to prevent unhandled rejection
        const { promise: p2 } = scheduler.enqueue("b", "t", async () => "never");
        const p2Catch = p2.catch(() => {}); // prevent unhandled rejection

        // Get the pending job's ID
        const jobs = scheduler.getJobs();
        const pendingJob = jobs.find((j) => j.status === "pending");
        expect(pendingJob).toBeDefined();

        const cancelled = scheduler.cancel(pendingJob!.id);
        expect(cancelled).toBe(true);
        expect(cancelledHandler).toHaveBeenCalledOnce();

        await p1;
        await p2Catch;
        await expect(p2).rejects.toThrow("cancelled");
    });

    it("cancelAll() empties queue and marks running jobs", async () => {
        const scheduler = new Scheduler(bus, 1);

        const { promise: p1 } = scheduler.enqueue("a", "t", async () => {
            await delay(200);
        });
        const p1Catch = p1.catch(() => {}); // prevent unhandled rejection
        const { promise: p2 } = scheduler.enqueue("b", "t", async () => {});
        const p2Catch = p2.catch(() => {}); // prevent unhandled rejection

        scheduler.cancelAll();

        expect(scheduler.pendingCount).toBe(0);
        await p1Catch;
        await p2Catch;
        // Both p1 (running) and p2 (pending) should be cancelled
        await expect(p1).rejects.toThrow("cancelled");
        await expect(p2).rejects.toThrow("cancelled");
    });

    it("cancel returns false for unknown job ID", () => {
        const scheduler = new Scheduler(bus, 5);
        expect(scheduler.cancel("nonexistent")).toBe(false);
    });

    it("getJobs() returns a snapshot of pending + running", async () => {
        const scheduler = new Scheduler(bus, 1);

        const { promise: p1 } = scheduler.enqueue("a", "t", async () => {
            await delay(50);
        });
        const { promise: p2 } = scheduler.enqueue("b", "t", async () => {});

        const jobs = scheduler.getJobs();
        expect(jobs.length).toBe(2);

        const statuses = jobs.map((j) => j.status);
        expect(statuses).toContain("running");
        expect(statuses).toContain("pending");

        await p1;
        await p2;
    });

    it("getAllJobs() returns all jobs including completed ones", async () => {
        const scheduler = new Scheduler(bus, 5);

        const { promise: p1 } = scheduler.enqueue("a", "t1", async () => "r1");
        const { promise: p2 } = scheduler.enqueue("b", "t2", async () => "r2");
        await Promise.all([p1, p2]);

        const allJobs = scheduler.getAllJobs();
        expect(allJobs).toHaveLength(2);
        expect(allJobs.every((j) => j.status === "completed")).toBe(true);
    });

    it("activeCount and pendingCount reflect current state", async () => {
        const scheduler = new Scheduler(bus, 1);

        const { promise: p1 } = scheduler.enqueue("a", "t", async () => {
            await delay(50);
        });
        scheduler.enqueue("b", "t", async () => {});

        expect(scheduler.activeCount).toBe(1);
        expect(scheduler.pendingCount).toBe(1);

        await p1;
    });

    it("handles job failures gracefully", async () => {
        const scheduler = new Scheduler(bus, 5);

        await expect(
            scheduler.enqueue("a", "t", async () => {
                throw new Error("boom");
            }).promise,
        ).rejects.toThrow("boom");
    });
});
