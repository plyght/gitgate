import { Hono } from "hono";
import { createHash } from "node:crypto";
import type { Config } from "./types";
import { authenticateDevice } from "./auth";
import { GitHubClient } from "./github/client";
import { CacheManager } from "./github/cache";
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

  const githubClient = new GitHubClient(config.github.token);
  const cacheManager = new CacheManager(
    config.github.cache_dir,
    config.github.cache_ttl_seconds,
  );
  const auditLogger = new AuditLogger(config.audit?.log_file);
  const rateLimitLimit = 60;
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

  function applyRateLimitHeaders(
    c: { header: (name: string, value: string) => void },
    limit: number,
    remaining: number,
    resetAt: number,
  ): void {
    c.header("X-RateLimit-Limit", limit.toString());
    c.header("X-RateLimit-Remaining", remaining.toString());
    c.header("X-RateLimit-Reset", Math.floor(resetAt / 1000).toString());
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
      const anonKey = parseForwardedFor(headers["x-forwarded-for"]);
      const anonId = `anon:${anonKey}`;
      const anonAllowed = rateLimiter.isAllowed(anonId);
      const anonRemaining = rateLimiter.getRemainingRequests(anonId);
      const anonReset = rateLimiter.getResetTime(anonId);
      applyRateLimitHeaders(c, rateLimitLimit, anonRemaining, anonReset);
      if (!anonAllowed) {
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
    const allowed = rateLimiter.isAllowed(device.device_id);
    const remaining = rateLimiter.getRemainingRequests(device.device_id);
    const resetAt = rateLimiter.getResetTime(device.device_id);
    applyRateLimitHeaders(c, rateLimitLimit, remaining, resetAt);
    if (!allowed) {
      auditLogger.logAction(
        device.device_id,
        "list_releases",
        `${owner}/${repo}`,
        "failure",
        { reason: "rate_limited" },
      );
      throw new RateLimitError("Rate limited");
    }

    const cacheKey = `releases:${owner}:${repo}`;
    const cached = cacheManager.get(cacheKey);

    if (cached) {
      auditLogger.logAction(
        device.device_id,
        "list_releases",
        `${owner}/${repo}`,
        "success",
        { cached: true },
      );
      return c.json(JSON.parse(cached.toString("utf-8")));
    }

    const releases = await githubClient.listReleases(owner, repo);

    if (releases.length === 0) {
      auditLogger.logAction(
        device.device_id,
        "list_releases",
        `${owner}/${repo}`,
        "failure",
        { reason: "not_found" },
      );
      return c.json({ error: "Repository not found" }, 404);
    }

    const data = Buffer.from(JSON.stringify(releases));
    cacheManager.set(cacheKey, data);

    auditLogger.logAction(
      device.device_id,
      "list_releases",
      `${owner}/${repo}`,
      "success",
    );
    return c.json(releases);
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
      const anonKey = parseForwardedFor(headers["x-forwarded-for"]);
      const anonId = `anon:${anonKey}`;
      const anonAllowed = rateLimiter.isAllowed(anonId);
      const anonRemaining = rateLimiter.getRemainingRequests(anonId);
      const anonReset = rateLimiter.getResetTime(anonId);
      applyRateLimitHeaders(c, rateLimitLimit, anonRemaining, anonReset);
      if (!anonAllowed) {
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
    const allowed = rateLimiter.isAllowed(device.device_id);
    const remaining = rateLimiter.getRemainingRequests(device.device_id);
    const resetAt = rateLimiter.getResetTime(device.device_id);
    applyRateLimitHeaders(c, rateLimitLimit, remaining, resetAt);
    if (!allowed) {
      auditLogger.logAction(
        device.device_id,
        "download_asset",
        `${owner}/${repo}/${version}/${assetName}`,
        "failure",
        { reason: "rate_limited" },
      );
      throw new RateLimitError("Rate limited");
    }

    const cacheKey = `asset:${owner}:${repo}:${version}:${assetName}`;
    const cached = cacheManager.get(cacheKey);

    if (cached) {
      const checksum = cacheManager.getChecksum(cacheKey);
      c.header("X-Checksum-SHA256", checksum || "");

      if (assetSigner) {
        const cachedBuffer = cached instanceof Buffer ? cached : Buffer.from(cached);
        const signature = assetSigner.sign(cachedBuffer);
        c.header("X-Signature-RSA-SHA256", signature);
      }

      auditLogger.logAction(
        device.device_id,
        "download_asset",
        `${owner}/${repo}/${version}/${assetName}`,
        "success",
        { cached: true },
      );
      c.header("Content-Type", "application/octet-stream");
      const buf = cached instanceof Buffer ? cached : Buffer.from(cached);
      return new Response(buf);
    }

    const release = await githubClient.getRelease(owner, repo, version);

    if (!release) {
      auditLogger.logAction(
        device.device_id,
        "download_asset",
        `${owner}/${repo}/${version}/${assetName}`,
        "failure",
        { reason: "release_not_found" },
      );
      return c.json({ error: "Release not found" }, 404);
    }

    const asset = release.assets.find((a) => a.name === assetName);

    if (!asset) {
      auditLogger.logAction(
        device.device_id,
        "download_asset",
        `${owner}/${repo}/${version}/${assetName}`,
        "failure",
        { reason: "asset_not_found" },
      );
      return c.json({ error: "Asset not found" }, 404);
    }

    const data = await githubClient.downloadAsset(owner, repo, asset.id);

    if (!data) {
      auditLogger.logAction(
        device.device_id,
        "download_asset",
        `${owner}/${repo}/${version}/${assetName}`,
        "failure",
        { reason: "download_failed" },
      );
      throw new ExternalServiceError("Request failed");
    }

    cacheManager.set(cacheKey, data);
    const checksum = createHash("sha256").update(data).digest("hex");

    c.header("X-Checksum-SHA256", checksum);

    if (assetSigner) {
      const signature = assetSigner.sign(data);
      c.header("X-Signature-RSA-SHA256", signature);
    }

    auditLogger.logAction(
      device.device_id,
      "download_asset",
      `${owner}/${repo}/${version}/${assetName}`,
      "success",
    );
    c.header("Content-Type", "application/octet-stream");
    return new Response(data);
  });

  return app;
}
