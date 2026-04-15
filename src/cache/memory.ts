import { LRUCache } from "lru-cache";
import type { CacheMeta } from "../types";

export interface MemoryCacheEntry {
  data: Buffer;
  meta: CacheMeta;
}

export interface MemoryCacheOptions {
  maxItems: number;
  maxSizeBytes: number;
  defaultTTLMs: number;
}

const DEFAULT_OPTIONS: MemoryCacheOptions = {
  maxItems: 500,
  maxSizeBytes: 256 * 1024 * 1024,
  defaultTTLMs: 3600_000,
};

export class MemoryCache {
  private cache: LRUCache<string, MemoryCacheEntry>;
  private hits = 0;
  private misses = 0;
  private maxSizeBytes: number;

  constructor(opts: Partial<MemoryCacheOptions> = {}) {
    const options = { ...DEFAULT_OPTIONS, ...opts };
    this.maxSizeBytes = options.maxSizeBytes;

    this.cache = new LRUCache<string, MemoryCacheEntry>({
      max: options.maxItems,
      maxSize: options.maxSizeBytes,
      sizeCalculation: (entry) => entry.data.byteLength + 512,
      ttl: options.defaultTTLMs,
      allowStale: true,
      updateAgeOnGet: true,
    });
  }

  get(key: string): MemoryCacheEntry | undefined {
    const entry = this.cache.get(key);
    if (entry) {
      this.hits++;
    } else {
      this.misses++;
    }
    return entry;
  }

  /**
   * Returns entry without updating recency or TTL age (non-mutating read).
   */
  peek(key: string): MemoryCacheEntry | undefined {
    return this.cache.peek(key, { allowStale: true });
  }

  set(key: string, entry: MemoryCacheEntry, ttlMs?: number): void {
    this.cache.set(key, entry, { ttl: ttlMs });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  get stats() {
    const total = this.hits + this.misses;
    return {
      items: this.cache.size,
      max_items: this.cache.max,
      size_bytes: this.cache.calculatedSize,
      max_bytes: this.maxSizeBytes,
      hits: this.hits,
      misses: this.misses,
      hit_rate: total > 0 ? `${((this.hits / total) * 100).toFixed(1)}%` : "0.0%",
    };
  }
}
