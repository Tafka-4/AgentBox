import type { EventBus } from "./event-bus.js";
import type { MemoryEntry, MemoryQueryOptions } from "./types.js";

/**
 * Shared cross-agent memory — a global key-value store that all agents
 * in a run can read from and write to.
 *
 * Every entry is tagged with the authoring agent's name for traceability.
 * A single `SharedMemory` instance is created per `ExecutionContext`.
 */
export class SharedMemory {
    private store = new Map<string, MemoryEntry>();
    private eventBus: EventBus;
    private correlationId: string;

    constructor(eventBus: EventBus, correlationId: string) {
        this.eventBus = eventBus;
        this.correlationId = correlationId;
    }

    /** Update the correlation ID (set when a new run starts). */
    setCorrelationId(id: string): void {
        this.correlationId = id;
    }

    /** Get a value by key, returns undefined if not found or expired. */
    get(key: string): unknown | undefined {
        const entry = this.store.get(key);
        if (!entry) return undefined;

        if (entry.metadata.expiresAt) {
            if (new Date(entry.metadata.expiresAt).getTime() <= Date.now()) {
                this.store.delete(key);
                return undefined;
            }
        }

        return entry.value;
    }

    /** Store a value, tagged with the authoring agent. */
    set(
        agentName: string,
        key: string,
        value: unknown,
        opts?: { namespace?: string; ttl?: number },
    ): void {
        const now = new Date().toISOString();
        const existing = this.store.get(key);

        let expiresAt: string | undefined;
        if (opts?.ttl) {
            expiresAt = new Date(Date.now() + opts.ttl).toISOString();
        }

        const entry: MemoryEntry = {
            key,
            value,
            metadata: {
                createdAt: existing?.metadata.createdAt ?? now,
                updatedAt: now,
                author: agentName,
                namespace: opts?.namespace,
                ttl: opts?.ttl,
                expiresAt,
            },
        };

        this.store.set(key, entry);

        this.eventBus.emit(
            "memory:shared:set",
            { agentName, key, namespace: opts?.namespace },
            this.correlationId,
        );
    }

    /** List entries with optional filtering. */
    list(opts?: MemoryQueryOptions): MemoryEntry[] {
        const now = Date.now();
        const entries: MemoryEntry[] = [];

        for (const entry of this.store.values()) {
            if (
                entry.metadata.expiresAt &&
                new Date(entry.metadata.expiresAt).getTime() <= now
            ) {
                this.store.delete(entry.key);
                continue;
            }

            if (opts?.namespace && entry.metadata.namespace !== opts.namespace) {
                continue;
            }

            if (opts?.prefix && !entry.key.startsWith(opts.prefix)) {
                continue;
            }

            entries.push(entry);
        }

        if (opts?.limit && entries.length > opts.limit) {
            return entries.slice(0, opts.limit);
        }

        return entries;
    }

    /** Get the total number of non-expired entries. */
    get size(): number {
        return this.list().length;
    }

    /** Clear all entries. */
    clear(): void {
        this.store.clear();
    }
}
