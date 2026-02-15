import { randomUUID } from "node:crypto";
import type { EventBus } from "./event-bus.js";
import type { Job } from "./types.js";

/** Handle returned by `enqueue()` to track both the job metadata and its completion. */
export interface JobHandle {
    /** The Job metadata object — updated in-place as the job progresses. */
    job: Job;
    /** Promise that resolves with the job result or rejects on failure/cancellation. */
    promise: Promise<unknown>;
}

/** Internal wrapper for a queued job with its resolve/reject handles. */
interface QueuedJob {
    job: Job;
    execute: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    /** Optional correlationId for event tracing. */
    correlationId?: string;
}

/**
 * Async job scheduler with configurable concurrency (`maxParallel`),
 * and pause/resume/cancel support.
 */
export class Scheduler {
    private queue: QueuedJob[] = [];
    private running = new Map<string, QueuedJob>();
    private allJobs: Job[] = [];
    private maxParallel: number;
    private paused = false;
    private eventBus: EventBus;

    constructor(eventBus: EventBus, maxParallel = 5) {
        this.eventBus = eventBus;
        this.maxParallel = maxParallel;
    }

    /**
     * Enqueue a job and return a handle with both the Job object and a completion promise.
     * @param agentName - The agent owning this job.
     * @param task - Task description.
     * @param execute - The async function to execute.
     * @param correlationId - Optional correlation ID for event tracing.
     */
    enqueue(
        agentName: string,
        task: string,
        execute: () => Promise<unknown>,
        correlationId?: string,
    ): JobHandle {
        const job: Job = {
            id: randomUUID(),
            agentName,
            task,
            status: "pending",
            createdAt: new Date().toISOString(),
        };

        this.allJobs.push(job);

        const promise = new Promise<unknown>((resolve, reject) => {
            this.queue.push({ job, execute, resolve, reject, correlationId });
            this.eventBus.emit("job:scheduled", { job }, correlationId);
            this.drain();
        });

        return { job, promise };
    }

    /** Try to fill available execution slots from the queue. */
    private drain(): void {
        if (this.paused) return;

        while (
            this.running.size < this.maxParallel &&
            this.queue.length > 0
        ) {
            const item = this.queue.shift()!;
            this.startJob(item);
        }
    }

    /** Start execution of a single job. */
    private startJob(item: QueuedJob): void {
        item.job.status = "running";
        this.running.set(item.job.id, item);

        item
            .execute()
            .then((result) => {
                item.job.status = "completed";
                item.job.result = result;
                this.eventBus.emit("job:completed", { job: item.job }, item.correlationId);
                item.resolve(result);
            })
            .catch((err: unknown) => {
                item.job.status = "failed";
                item.job.error =
                    err instanceof Error ? err.message : String(err);
                this.eventBus.emit("job:completed", { job: item.job }, item.correlationId);
                item.reject(err);
            })
            .finally(() => {
                this.running.delete(item.job.id);
                this.drain();
            });
    }

    /** Pause the scheduler — running jobs continue, no new ones start. */
    pause(): void {
        this.paused = true;
    }

    /** Resume the scheduler and start draining the queue. */
    resume(): void {
        this.paused = false;
        this.drain();
    }

    /** Cancel a specific job by ID. */
    cancel(jobId: string): boolean {
        // Check pending queue first
        const idx = this.queue.findIndex((q) => q.job.id === jobId);
        if (idx !== -1) {
            const [item] = this.queue.splice(idx, 1);
            item.job.status = "cancelled";
            this.eventBus.emit("job:cancelled", { jobId }, item.correlationId);
            item.reject(new Error(`Job ${jobId} cancelled`));
            return true;
        }

        // Mark running job as cancelled (cannot abort the promise)
        const running = this.running.get(jobId);
        if (running) {
            running.job.status = "cancelled";
            this.eventBus.emit("job:cancelled", { jobId }, running.correlationId);
            return true;
        }

        return false;
    }

    /** Cancel all pending and running jobs. */
    cancelAll(): void {
        for (const item of this.queue) {
            item.job.status = "cancelled";
            this.eventBus.emit("job:cancelled", { jobId: item.job.id }, item.correlationId);
            item.reject(new Error(`Job ${item.job.id} cancelled`));
        }
        this.queue = [];

        for (const [id, item] of this.running) {
            item.job.status = "cancelled";
            this.eventBus.emit("job:cancelled", { jobId: id }, item.correlationId);
            item.reject(new Error(`Job ${id} cancelled`));
        }
        this.running.clear();
    }

    /** Get a snapshot of all jobs (pending + running). */
    getJobs(): Job[] {
        const pending = this.queue.map((q) => q.job);
        const active = Array.from(this.running.values()).map((q) => q.job);
        return [...pending, ...active];
    }

    /** Get all jobs that have been enqueued (any status). */
    getAllJobs(): Job[] {
        return [...this.allJobs];
    }

    /** Whether the scheduler is currently paused. */
    get isPaused(): boolean {
        return this.paused;
    }

    /** Number of currently running jobs. */
    get activeCount(): number {
        return this.running.size;
    }

    /** Number of jobs waiting in the queue. */
    get pendingCount(): number {
        return this.queue.length;
    }
}
