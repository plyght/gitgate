import { Octokit } from "@octokit/rest";
import type { Release, GitHubRateLimitInfo } from "../types";
import type { ETagStore } from "../cache/etag-store";

export interface GitHubClientOptions {
  token: string;
  etagStore?: ETagStore;
  onRateLimitUpdate?: (info: GitHubRateLimitInfo) => void;
}

type ConditionalHeaders = Record<string, string>;

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

export class GitHubClient {
  private octokit: Octokit;
  private etagStore: ETagStore | null;
  private onRateLimitUpdate: ((info: GitHubRateLimitInfo) => void) | null;

  constructor(opts: GitHubClientOptions) {
    this.octokit = new Octokit({ auth: opts.token, request: { timeout: 30000 } });
    this.etagStore = opts.etagStore ?? null;
    this.onRateLimitUpdate = opts.onRateLimitUpdate ?? null;
  }

  async getRelease(
    owner: string,
    repo: string,
    tag: string,
  ): Promise<{ release: Release | null; etag?: string; lastModified?: string; notModified: boolean }> {
    const cacheKey = `release:${owner}:${repo}:${tag}`;
    const conditionalHeaders = this.buildConditionalHeaders(cacheKey);
    const isConditional = Object.keys(conditionalHeaders).length > 0;

    return this.withRetry(async () => {
      try {
        const response = await this.octokit.repos.getReleaseByTag({
          owner,
          repo,
          tag,
          headers: conditionalHeaders,
        });

        const h = response.headers as Record<string, string | undefined>;
        this.extractRateLimitInfo(h);
        this.storeETag(cacheKey, h);

        if (isConditional) this.etagStore?.recordConditionalRequest();

        return {
          release: this.mapRelease(response.data),
          etag: h.etag,
          lastModified: h["last-modified"],
          notModified: false,
        };
      } catch (err: unknown) {
        if (this.isNotModified(err)) {
          this.etagStore?.recordConditionalRequest();
          this.etagStore?.recordNotModified();
          return { release: null, notModified: true };
        }
        if (this.isRateLimited(err)) {
          throw err;
        }
        if (this.isNotFound(err)) {
          return { release: null, notModified: false };
        }
        throw err;
      }
    });
  }

  async listReleases(
    owner: string,
    repo: string,
    limit: number = 30,
  ): Promise<{ releases: Release[]; etag?: string; lastModified?: string; notModified: boolean }> {
    const cacheKey = `releases:${owner}:${repo}`;
    const conditionalHeaders = this.buildConditionalHeaders(cacheKey);
    const isConditional = Object.keys(conditionalHeaders).length > 0;

    return this.withRetry(async () => {
      try {
        const response = await this.octokit.repos.listReleases({
          owner,
          repo,
          per_page: limit,
          headers: conditionalHeaders,
        });

        const h = response.headers as Record<string, string | undefined>;
        this.extractRateLimitInfo(h);
        this.storeETag(cacheKey, h);

        if (isConditional) this.etagStore?.recordConditionalRequest();

        return {
          releases: response.data.map((r) => this.mapRelease(r)),
          etag: h.etag,
          lastModified: h["last-modified"],
          notModified: false,
        };
      } catch (err: unknown) {
        if (this.isNotModified(err)) {
          this.etagStore?.recordConditionalRequest();
          this.etagStore?.recordNotModified();
          return { releases: [], notModified: true };
        }
        if (this.isRateLimited(err)) {
          throw err;
        }
        if (this.isNotFound(err)) {
          return { releases: [], notModified: false };
        }
        throw err;
      }
    });
  }

  async downloadAsset(
    owner: string,
    repo: string,
    assetId: number,
  ): Promise<Buffer | null> {
    return this.withRetry(async () => {
      try {
        const response = await this.octokit.repos.getReleaseAsset({
          owner,
          repo,
          asset_id: assetId,
          headers: { accept: "application/octet-stream" },
        });

        this.extractRateLimitInfo(response.headers as Record<string, string | undefined>);

        const data = response.data;
        if (data instanceof Buffer) return data;
        if (data instanceof ArrayBuffer) return Buffer.from(data);
        if (typeof data === "string") return Buffer.from(data);
        return null;
      } catch (error: unknown) {
        if (this.isRateLimited(error)) {
          throw error;
        }
        if (this.isNotFound(error)) {
          return null;
        }
        throw error;
      }
    });
  }

  private buildConditionalHeaders(cacheKey: string): ConditionalHeaders {
    if (!this.etagStore) return {};
    const entry = this.etagStore.get(cacheKey);
    if (!entry) return {};

    const headers: ConditionalHeaders = {};
    if (entry.lastModified) headers["if-modified-since"] = entry.lastModified;
    if (entry.etag) headers["if-none-match"] = entry.etag;
    return headers;
  }

  private storeETag(cacheKey: string, headers: Record<string, string | undefined>): void {
    if (!this.etagStore) return;
    const etag = headers.etag;
    const lastModified = headers["last-modified"];
    if (etag || lastModified) {
      this.etagStore.set(cacheKey, {
        etag: etag ?? undefined,
        lastModified: lastModified ?? undefined,
        timestamp: Date.now(),
      });
    }
  }

  private extractRateLimitInfo(headers: Record<string, string | undefined>): void {
    if (!this.onRateLimitUpdate) return;

    const remaining = headers["x-ratelimit-remaining"];
    const limit = headers["x-ratelimit-limit"];
    const reset = headers["x-ratelimit-reset"];
    const used = headers["x-ratelimit-used"];

    if (remaining && limit && reset) {
      this.onRateLimitUpdate({
        remaining: parseInt(remaining, 10),
        limit: parseInt(limit, 10),
        reset: parseInt(reset, 10),
        used: used ? parseInt(used, 10) : 0,
      });
    }
  }

  private isNotModified(err: unknown): boolean {
    return (
      typeof err === "object" &&
      err !== null &&
      "status" in err &&
      (err as { status: number }).status === 304
    );
  }

  private isNotFound(err: unknown): boolean {
    if (typeof err !== "object" || err === null) return false;
    return (err as { status?: number }).status === 404;
  }

  private isRateLimited(err: unknown): boolean {
    if (typeof err !== "object" || err === null) return false;
    const status = (err as { status?: number }).status;
    return status === 403 || status === 429;
  }

  private getRetryAfter(err: unknown): number | null {
    if (typeof err !== "object" || err === null) return null;
    const headers = (err as { response?: { headers?: Record<string, string> } }).response?.headers;
    if (!headers) return null;
    const val = headers["retry-after"];
    if (!val) return null;
    const seconds = parseInt(val, 10);
    return isNaN(seconds) ? null : seconds;
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES && this.isRateLimited(err)) {
          const retryAfter = this.getRetryAfter(err);
          const delay = retryAfter
            ? retryAfter * 1000
            : RETRY_BASE_MS * Math.pow(2, attempt);
          console.warn(`[github] rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await this.sleep(delay);
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private mapRelease(data: unknown): Release {
    const r = data as Record<string, unknown>;
    return {
      id: r.id as number,
      tag_name: r.tag_name as string,
      name: r.name as string,
      draft: r.draft as boolean,
      prerelease: r.prerelease as boolean,
      created_at: r.created_at as string,
      published_at: r.published_at as string,
      assets: ((r.assets as Array<Record<string, unknown>>) || []).map((a) => ({
        id: a.id as number,
        name: a.name as string,
        url: a.url as string,
        browser_download_url: a.browser_download_url as string,
        size: a.size as number,
        download_count: a.download_count as number,
        created_at: a.created_at as string,
        updated_at: a.updated_at as string,
      })),
    };
  }
}
