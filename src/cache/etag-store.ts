import { LRUCache } from "lru-cache";

export interface ETagEntry {
  etag?: string;
  lastModified?: string;
  timestamp: number;
}

/**
 * Tracks ETags and Last-Modified headers for GitHub API conditional requests.
 * Conditional requests that return 304 don't count against the rate limit.
 */
export class ETagStore {
  private store: LRUCache<string, ETagEntry>;
  private conditionalRequests = 0;
  private notModifiedResponses = 0;

  constructor(maxEntries: number = 2000) {
    this.store = new LRUCache<string, ETagEntry>({
      max: maxEntries,
      ttl: 24 * 60 * 60 * 1000,
    });
  }

  get(key: string): ETagEntry | undefined {
    return this.store.get(key);
  }

  set(key: string, entry: ETagEntry): void {
    this.store.set(key, entry);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  recordConditionalRequest(wasNotModified: boolean): void {
    this.conditionalRequests++;
    if (wasNotModified) {
      this.notModifiedResponses++;
    }
  }

  get stats() {
    return {
      conditional_requests: this.conditionalRequests,
      not_modified: this.notModifiedResponses,
      savings_rate:
        this.conditionalRequests > 0
          ? `${((this.notModifiedResponses / this.conditionalRequests) * 100).toFixed(1)}%`
          : "0.0%",
    };
  }

  clear(): void {
    this.store.clear();
    this.conditionalRequests = 0;
    this.notModifiedResponses = 0;
  }
}
