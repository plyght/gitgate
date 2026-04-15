import { Hono } from "hono";
import type { Config, DeviceContext } from "./types";
import { authenticateDevice } from "./auth";
import { GitHubClient } from "./github/client";
import { GitGateCache, resolveCacheConfig } from "./cache";
import { AssetSigner } from "./github/signing";
import { AuditLogger } from "./audit/logger";
import { RateLimiter } from "./middleware/ratelimit";
import {
  collectValidatedHeaders,
  validateAssetName,
  validateOrigin,
  validateOwnerRepo,
  parseForwardedFor,
  validateVersion,
} from "./utils/validation";
import {
  AppError,
  ExternalServiceError,
  RateLimitError,
  ValidationError,
} from "./utils/errors";

export function createServer(config: Config): Hono {
  const app = new Hono();

  const cacheConfig = resolveCacheConfig(config.github.cache, config.github.cache_ttl_seconds);

  const cache = new GitGateCache(cacheConfig);

  const githubClient = new GitHubClient({
    token: config.github.token,
    etagStore: cacheConfig.enable_etags ? cache.etags : undefined,
    onRateLimitUpdate: (info) => cache.updateRateLimitInfo(info),
  });

  const auditLogger = new AuditLogger(config.audit?.log_file);
  const rateLimitLimit = config.rate_limit?.requests_per_minute ?? 60;
  const rateLimiter = new RateLimiter(rateLimitLimit);
  const corsAllowedOrigins = config.security?.cors?.allowed_origins || [];
  const corsAllowCredentials = config.security?.cors?.allow_credentials || false;

  let assetSigner: AssetSigner | null = null;
  if (config.signing?.enabled && config.signing?.private_key_path) {
    try {
      assetSigner = new AssetSigner(config.signing.private_key_path);
    } catch {
      console.warn("Failed to load signing key");
    }
  }

  function getAuthConfig(): Record<string, unknown> | undefined {
    if (config.auth.method === "jamf") {
      return config.auth.jamf;
    }
    if (config.auth.method === "tailscale") {
      return config.auth.tailscale;
    }
    if (config.auth.method === "mtls") {
      return config.auth.mtls;
    }
    return undefined;
  }

  app.onError((err, c) => {
    console.error("Request failed:", err);
    if (err instanceof AppError) {
      return c.json({ error: err.message }, err.status);
    }
    return c.json({ error: "Internal server error" }, 500);
  });

  app.use("*", async (c, next) => {
    const origin = validateOrigin(c.req.header("origin"));
    if (origin && corsAllowedOrigins.includes(origin)) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
      if (corsAllowCredentials) {
        c.header("Access-Control-Allow-Credentials", "true");
      }
    }
    c.header("Content-Security-Policy", "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    c.header("X-Frame-Options", "DENY");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
    if (c.req.method === "OPTIONS") {
      c.header("Access-Control-Allow-Methods", "GET,OPTIONS");
      c.header(
        "Access-Control-Allow-Headers",
        "authorization,content-type,x-jamf-token,x-tailscale-user,x-tailscale-device,x-tailscale-ip,x-device-id",
      );
      return c.body(null, 204);
    }
    await next();
  });

  app.get("/", (c) => {
    return c.json({ status: "ok" });
  });

  app.get("/health", (c) => {
    return c.json({ status: "ok", timestamp: Date.now() });
  });

  app.get("/cache/stats", async (c) => {
    const headers = collectValidatedHeaders(c.req.raw.headers);
    const device = await authenticateDevice(
      config.auth.method,
      headers,
      undefined,
      getAuthConfig(),
    );
    if (!device) {
      auditLogger.logAction("unknown", "cache_stats", "/cache/stats", "failure");
      return c.json({ error: "Unauthorized" }, 401);
    }
    auditLogger.logAction(device.device_id, "cache_stats", "/cache/stats", "success");
    return c.json(cache.getStats());
  });

  app.delete("/cache", async (c) => {
    const headers = collectValidatedHeaders(c.req.raw.headers);
    const device = await authenticateDevice(
      config.auth.method,
      headers,
      undefined,
      getAuthConfig(),
    );
    if (!device) {
      auditLogger.logAction("unknown", "cache_clear", "/cache", "failure");
      return c.json({ error: "Unauthorized" }, 401);
    }
    cache.clear();
    auditLogger.logAction(device.device_id, "cache_clear", "/cache", "success");
    return c.json({ status: "ok", message: "Cache cleared" });
  });

  function applyRateLimitHeaders(
    c: { header: (name: string, value: string) => void },
    info: { limit: number; remaining: number; reset_at: number },
  ): void {
    c.header("X-RateLimit-Limit", info.limit.toString());
    c.header("X-RateLimit-Remaining", info.remaining.toString());
    c.header("X-RateLimit-Reset", Math.floor(info.reset_at / 1000).toString());
  }

  function applyCacheHeaders(
    c: { header: (name: string, value: string) => void },
    hit: boolean,
    stale: boolean,
  ): void {
    c.header("X-Cache", hit ? (stale ? "STALE" : "HIT") : "MISS");
  }

  function resolveDeviceKey(
    device: DeviceContext | null,
    headers: Record<string, string>,
  ): string {
    if (device) return device.device_id;
    const ip = parseForwardedFor(headers["x-forwarded-for"]);
    return `anon:${ip}`;
  }

  function enforceRateLimit(
    c: { header: (name: string, value: string) => void },
    deviceKey: string,
  ): boolean {
    const result = rateLimiter.consume(deviceKey);
    applyRateLimitHeaders(c, result);
    return result.allowed;
  }

  function toArrayBuffer(buf: Buffer): ArrayBuffer {
    const ab = new ArrayBuffer(buf.byteLength);
    const view = new Uint8Array(ab);
    view.set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    return ab;
  }

  function showRateLimitHeaders(
    c: { header: (name: string, value: string) => void },
    deviceKey: string,
  ): void {
    applyRateLimitHeaders(c, rateLimiter.check(deviceKey));
  }

  app.get("/releases/:owner/:repo", async (c) => {
    const owner = validateOwnerRepo(c.req.param("owner"));
    const repo = validateOwnerRepo(c.req.param("repo"));
    if (!owner || !repo) {
      throw new ValidationError("Invalid request");
    }
    const headers = collectValidatedHeaders(c.req.raw.headers);

    const device = await authenticateDevice(
      config.auth.method,
      headers,
      undefined,
      getAuthConfig(),
    );

    if (!device) {
      const deviceKey = resolveDeviceKey(null, headers);
      if (!enforceRateLimit(c, deviceKey)) {
        return c.json({ error: "Rate limited" }, 429);
      }
      auditLogger.logAction(
        "unknown",
        "list_releases",
        `${owner}/${repo}`,
        "failure",
      );
      return c.json({ error: "Unauthorized" }, 401);
    }

    const deviceKey = device.device_id;
    const cacheKey = `releases:${owner}:${repo}`;
    const cached = cache.get(cacheKey);

    if (cached && !cached.stale) {
      showRateLimitHeaders(c, deviceKey);
      applyCacheHeaders(c, true, false);
      auditLogger.logAction(
        deviceKey,
        "list_releases",
        `${owner}/${repo}`,
        "success",
        { cached: true },
      );
      return c.json(JSON.parse(cached.data.toString("utf-8")));
    }

    if (!enforceRateLimit(c, deviceKey)) {
      if (cached) {
        applyCacheHeaders(c, true, true);
        auditLogger.logAction(
          deviceKey,
          "list_releases",
          `${owner}/${repo}`,
          "success",
          { cached: true, stale: true, rate_limited: true },
        );
        return c.json(JSON.parse(cached.data.toString("utf-8")));
      }
      auditLogger.logAction(
        deviceKey,
        "list_releases",
        `${owner}/${repo}`,
        "failure",
        { reason: "rate_limited" },
      );
      throw new RateLimitError("Rate limited");
    }

    try {
      const result = await githubClient.listReleases(owner, repo);

      if (result.notModified && cached) {
        applyCacheHeaders(c, true, false);
        cache.set(cacheKey, cached.data, {
          contentType: "application/json",
          etag: cached.meta.etag,
          lastModified: cached.meta.last_modified,
        });
        auditLogger.logAction(
          deviceKey,
          "list_releases",
          `${owner}/${repo}`,
          "success",
          { cached: true, revalidated: true },
        );
        return c.json(JSON.parse(cached.data.toString("utf-8")));
      }

      if (result.releases.length === 0 && !result.notModified) {
        if (cached) {
          applyCacheHeaders(c, true, true);
          auditLogger.logAction(
            deviceKey,
            "list_releases",
            `${owner}/${repo}`,
            "success",
            { cached: true, stale: true },
          );
          return c.json(JSON.parse(cached.data.toString("utf-8")));
        }

        auditLogger.logAction(
          deviceKey,
          "list_releases",
          `${owner}/${repo}`,
          "failure",
          { reason: "not_found" },
        );
        return c.json({ error: "Repository not found" }, 404);
      }

      const data = Buffer.from(JSON.stringify(result.releases));
      cache.set(cacheKey, data, {
        contentType: "application/json",
        etag: result.etag,
        lastModified: result.lastModified,
      });

      applyCacheHeaders(c, false, false);
      auditLogger.logAction(
        deviceKey,
        "list_releases",
        `${owner}/${repo}`,
        "success",
      );
      return c.json(result.releases);
    } catch (err) {
      const staleEntry = cached ?? cache.getStale(cacheKey);
      if (staleEntry) {
        applyCacheHeaders(c, true, true);
        auditLogger.logAction(
          deviceKey,
          "list_releases",
          `${owner}/${repo}`,
          "success",
          { cached: true, stale_if_error: true },
        );
        return c.json(JSON.parse(staleEntry.data.toString("utf-8")));
      }
      throw err;
    }
  });

  app.get("/release/:owner/:repo/:version/:asset", async (c) => {
    const owner = validateOwnerRepo(c.req.param("owner"));
    const repo = validateOwnerRepo(c.req.param("repo"));
    const version = validateVersion(c.req.param("version"));
    const assetName = validateAssetName(c.req.param("asset"));
    if (!owner || !repo || !version || !assetName) {
      throw new ValidationError("Invalid request");
    }
    const headers = collectValidatedHeaders(c.req.raw.headers);

    const device = await authenticateDevice(
      config.auth.method,
      headers,
      undefined,
      getAuthConfig(),
    );

    if (!device) {
      const deviceKey = resolveDeviceKey(null, headers);
      if (!enforceRateLimit(c, deviceKey)) {
        return c.json({ error: "Rate limited" }, 429);
      }
      auditLogger.logAction(
        "unknown",
        "download_asset",
        `${owner}/${repo}/${version}/${assetName}`,
        "failure",
      );
      return c.json({ error: "Unauthorized" }, 401);
    }

    const deviceKey = device.device_id;
    const cacheKey = `asset:${owner}:${repo}:${version}:${assetName}`;
    const cached = cache.get(cacheKey);

    if (cached && !cached.stale) {
      showRateLimitHeaders(c, deviceKey);
      applyCacheHeaders(c, true, false);
      c.header("X-Checksum-SHA256", cached.meta.checksum);

      if (assetSigner) {
        const signature = assetSigner.sign(cached.data);
        c.header("X-Signature-RSA-SHA256", signature);
      }

      auditLogger.logAction(
        deviceKey,
        "download_asset",
        `${owner}/${repo}/${version}/${assetName}`,
        "success",
        { cached: true },
      );
      c.header("Content-Type", "application/octet-stream");
      return c.body(toArrayBuffer(cached.data));
    }

    if (!enforceRateLimit(c, deviceKey)) {
      if (cached) {
        applyCacheHeaders(c, true, true);
        c.header("X-Checksum-SHA256", cached.meta.checksum);
        if (assetSigner) c.header("X-Signature-RSA-SHA256", assetSigner.sign(cached.data));
        auditLogger.logAction(
          deviceKey,
          "download_asset",
          `${owner}/${repo}/${version}/${assetName}`,
          "success",
          { cached: true, stale: true, rate_limited: true },
        );
        c.header("Content-Type", "application/octet-stream");
        return c.body(toArrayBuffer(cached.data));
      }
      auditLogger.logAction(
        deviceKey,
        "download_asset",
        `${owner}/${repo}/${version}/${assetName}`,
        "failure",
        { reason: "rate_limited" },
      );
      throw new RateLimitError("Rate limited");
    }

    try {
      const releaseResult = await githubClient.getRelease(owner, repo, version);

      if (releaseResult.notModified && cached) {
        cache.set(cacheKey, cached.data, {
          contentType: "application/octet-stream",
          etag: cached.meta.etag,
          lastModified: cached.meta.last_modified,
        });
        applyCacheHeaders(c, true, false);
        c.header("X-Checksum-SHA256", cached.meta.checksum);
        if (assetSigner) c.header("X-Signature-RSA-SHA256", assetSigner.sign(cached.data));
        auditLogger.logAction(
          deviceKey,
          "download_asset",
          `${owner}/${repo}/${version}/${assetName}`,
          "success",
          { cached: true, revalidated: true },
        );
        c.header("Content-Type", "application/octet-stream");
        return c.body(toArrayBuffer(cached.data));
      }

      if (!releaseResult.release) {
        if (cached) {
          applyCacheHeaders(c, true, true);
          c.header("X-Checksum-SHA256", cached.meta.checksum);
          if (assetSigner) c.header("X-Signature-RSA-SHA256", assetSigner.sign(cached.data));
          c.header("Content-Type", "application/octet-stream");
          return c.body(toArrayBuffer(cached.data));
        }

        auditLogger.logAction(
          deviceKey,
          "download_asset",
          `${owner}/${repo}/${version}/${assetName}`,
          "failure",
          { reason: "release_not_found" },
        );
        return c.json({ error: "Release not found" }, 404);
      }

      const asset = releaseResult.release.assets.find((a) => a.name === assetName);

      if (!asset) {
        auditLogger.logAction(
          deviceKey,
          "download_asset",
          `${owner}/${repo}/${version}/${assetName}`,
          "failure",
          { reason: "asset_not_found" },
        );
        return c.json({ error: "Asset not found" }, 404);
      }

      const data = await githubClient.downloadAsset(owner, repo, asset.id);

      if (!data) {
        const staleEntry = cached ?? cache.getStale(cacheKey);
        if (staleEntry) {
          applyCacheHeaders(c, true, true);
          c.header("X-Checksum-SHA256", staleEntry.meta.checksum);
          if (assetSigner) c.header("X-Signature-RSA-SHA256", assetSigner.sign(staleEntry.data));
          c.header("Content-Type", "application/octet-stream");
          return c.body(toArrayBuffer(staleEntry.data));
        }

        auditLogger.logAction(
          deviceKey,
          "download_asset",
          `${owner}/${repo}/${version}/${assetName}`,
          "failure",
          { reason: "download_failed" },
        );
        throw new ExternalServiceError("Request failed");
      }

      const meta = cache.set(cacheKey, data, { contentType: "application/octet-stream" });

      applyCacheHeaders(c, false, false);
      c.header("X-Checksum-SHA256", meta.checksum);

      if (assetSigner) {
        const signature = assetSigner.sign(data);
        c.header("X-Signature-RSA-SHA256", signature);
      }

      auditLogger.logAction(
        deviceKey,
        "download_asset",
        `${owner}/${repo}/${version}/${assetName}`,
        "success",
      );
      c.header("Content-Type", "application/octet-stream");
      return c.body(toArrayBuffer(data));
    } catch (err) {
      const staleEntry = cached ?? cache.getStale(cacheKey);
      if (staleEntry) {
        applyCacheHeaders(c, true, true);
        c.header("X-Checksum-SHA256", staleEntry.meta.checksum);
        if (assetSigner) c.header("X-Signature-RSA-SHA256", assetSigner.sign(staleEntry.data));
        c.header("Content-Type", "application/octet-stream");
        auditLogger.logAction(
          deviceKey,
          "download_asset",
          `${owner}/${repo}/${version}/${assetName}`,
          "success",
          { cached: true, stale_if_error: true },
        );
        return c.body(toArrayBuffer(staleEntry.data));
      }
      throw err;
    }
  });

  return app;
}
