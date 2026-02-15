import type { EventBus } from "./event-bus.js";
import type { MemoryEntry, MemoryQueryOptions } from "./types.js";

/**
 * Per-agent working memory — a key-value store with namespace support,
 * TTL-based expiration, and event emission for observability.
 *
 * Each agent receives its own `AgentMemory` instance scoped to its name.
 */
export class AgentMemory {
    private store = new Map<string, MemoryEntry>();
    private agentName: string;
    private eventBus: EventBus;
    private correlationId: string;

    constructor(agentName: string, eventBus: EventBus, correlationId: string) {
        this.agentName = agentName;
        this.eventBus = eventBus;
        this.correlationId = correlationId;
    }

    /** Get a value by key, returns undefined if not found or expired. */
    get(key: string): unknown | undefined {
        const entry = this.store.get(key);
        if (!entry) return undefined;

        // TTL check
        if (entry.metadata.expiresAt) {
            if (new Date(entry.metadata.expiresAt).getTime() <= Date.now()) {
                this.store.delete(key);
                return undefined;
            }
        }

        return entry.value;
    }

    /** Store a value with optional namespace and TTL. */
    set(
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
                author: this.agentName,
                namespace: opts?.namespace,
                ttl: opts?.ttl,
                expiresAt,
            },
        };

        this.store.set(key, entry);

        this.eventBus.emit(
            "memory:set",
            { agentName: this.agentName, key, namespace: opts?.namespace },
            this.correlationId,
        );
    }

    /** Delete a key. Returns true if the key existed. */
    delete(key: string): boolean {
        const existed = this.store.delete(key);
        if (existed) {
            this.eventBus.emit(
                "memory:delete",
                { agentName: this.agentName, key },
                this.correlationId,
            );
        }
        return existed;
    }

    /** List entries with optional filtering. */
    list(opts?: MemoryQueryOptions): MemoryEntry[] {
        const now = Date.now();
        const entries: MemoryEntry[] = [];

        for (const entry of this.store.values()) {
            // Skip expired
            if (
                entry.metadata.expiresAt &&
                new Date(entry.metadata.expiresAt).getTime() <= now
            ) {
                this.store.delete(entry.key);
                continue;
            }

            // Namespace filter
            if (opts?.namespace && entry.metadata.namespace !== opts.namespace) {
                continue;
            }

            // Prefix filter
            if (opts?.prefix && !entry.key.startsWith(opts.prefix)) {
                continue;
            }

            entries.push(entry);
        }

        // Apply limit
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
