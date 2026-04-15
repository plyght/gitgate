import { createHash } from "node:crypto";
import type { CacheConfig, CacheMeta, CacheStats, GitHubRateLimitInfo } from "../types";
import { MemoryCache } from "./memory";
import { ETagStore } from "./etag-store";

export { MemoryCache } from "./memory";
export { ETagStore } from "./etag-store";

export interface CacheGetResult {
  data: Buffer;
  meta: CacheMeta;
  stale: boolean;
}

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  metadata_ttl_seconds: 300,
  asset_ttl_seconds: 86400,
  max_items: 500,
  max_mb: 256,
  stale_while_revalidate_seconds: 60,
  stale_if_error_seconds: 3600,
  enable_etags: true,
};

export function resolveCacheConfig(partial?: Partial<CacheConfig>, fallbackTTL?: number): CacheConfig {
  return {
    ...DEFAULT_CACHE_CONFIG,
    ...(fallbackTTL ? { metadata_ttl_seconds: fallbackTTL, asset_ttl_seconds: fallbackTTL } : {}),
    ...partial,
  };
}

export class GitGateCache {
  private memory: MemoryCache;
  private etagStore: ETagStore;
  private config: CacheConfig;
  private startedAt: number;
  private rateLimitInfo: GitHubRateLimitInfo | null = null;

  constructor(config: CacheConfig) {
    this.config = config;
    this.startedAt = Date.now();

    this.memory = new MemoryCache({
      maxItems: config.max_items,
      maxSizeBytes: config.max_mb * 1024 * 1024,
      defaultTTLMs: config.metadata_ttl_seconds * 1000,
    });

    this.etagStore = new ETagStore();
  }

  get(key: string): CacheGetResult | null {
    const entry = this.memory.get(key);
    if (!entry) return null;

    const stale = this.isStale(entry.meta);
    return { data: entry.data, meta: entry.meta, stale };
  }

  getStale(key: string): CacheGetResult | null {
    const entry = this.memory.peek(key);
    if (!entry) return null;
    return { data: entry.data, meta: entry.meta, stale: true };
  }

  set(key: string, data: Buffer, opts: {
    contentType: string;
    ttlSeconds?: number;
    etag?: string;
    lastModified?: string;
  }): CacheMeta {
    const checksum = createHash("sha256").update(data).digest("hex");
    const isAsset = opts.contentType === "application/octet-stream";
    const ttl = opts.ttlSeconds ?? (isAsset ? this.config.asset_ttl_seconds : this.config.metadata_ttl_seconds);

    const meta: CacheMeta = {
      key,
      checksum,
      etag: opts.etag,
      last_modified: opts.lastModified,
      timestamp: Date.now(),
      ttl,
      size: data.byteLength,
      content_type: opts.contentType,
      stale_while_revalidate: this.config.stale_while_revalidate_seconds,
      stale_if_error: this.config.stale_if_error_seconds,
    };

    this.memory.set(key, { data, meta }, ttl * 1000);

    if (this.config.enable_etags && (opts.etag || opts.lastModified)) {
      this.etagStore.set(key, {
        etag: opts.etag,
        lastModified: opts.lastModified,
        timestamp: Date.now(),
      });
    }

    return meta;
  }

  delete(key: string): void {
    this.memory.delete(key);
    this.etagStore.delete(key);
  }

  clear(): void {
    this.memory.clear();
    this.etagStore.clear();
  }

  getETag(key: string) {
    return this.etagStore.get(key);
  }

  get etags(): ETagStore {
    return this.etagStore;
  }

  getMeta(key: string): CacheMeta | null {
    const entry = this.memory.peek(key);
    return entry?.meta ?? null;
  }

  updateRateLimitInfo(info: GitHubRateLimitInfo): void {
    this.rateLimitInfo = info;
  }

  getStats(): CacheStats {
    return {
      memory: this.memory.stats,
      etag: this.etagStore.stats,
      github: {
        requests_remaining: this.rateLimitInfo?.remaining ?? null,
        requests_limit: this.rateLimitInfo?.limit ?? null,
        reset_at: this.rateLimitInfo
          ? new Date(this.rateLimitInfo.reset * 1000).toISOString()
          : null,
      },
      uptime_seconds: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }

  private isStale(meta: CacheMeta): boolean {
    return Date.now() - meta.timestamp > meta.ttl * 1000;
  }
}
