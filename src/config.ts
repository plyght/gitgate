import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Config } from "./types";
import { ConfigError } from "./utils/errors";
import { resolveSafePath, validateHttpsUrl } from "./utils/validation";

let cachedConfig: Config | null = null;

export function loadConfig(configPath?: string): Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  const baseDir = process.cwd();
  const inputPath =
    configPath || process.env.GITGATE_CONFIG || resolve(baseDir, "config.json");
  const path = resolveSafePath(baseDir, inputPath);

  if (!path) {
    throw new ConfigError("Invalid configuration path");
  }

  try {
    const content = readFileSync(path, "utf-8");
    cachedConfig = JSON.parse(content) as Config;
    return cachedConfig;
  } catch (error) {
    console.error("Failed to load configuration");
    throw new ConfigError("Failed to load configuration");
  }
}

export function getConfig(): Config {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

export function validateConfig(config: Config): boolean {
  if (!config.port || config.port < 1 || config.port > 65535) {
    throw new ConfigError("Invalid port number");
  }

  if (!config.host || typeof config.host !== "string") {
    throw new ConfigError("Invalid host value");
  }

  if (!config.github?.token) {
    throw new ConfigError("GitHub token is required");
  }

  if (!config.github?.cache_dir) {
    throw new ConfigError("Cache directory is required");
  }

  const baseDir = process.cwd();
  const cacheDir = resolveSafePath(baseDir, config.github.cache_dir);
  if (!cacheDir) {
    throw new ConfigError("Invalid cache directory");
  }
  config.github.cache_dir = cacheDir;

  if (!config.auth?.method) {
    throw new ConfigError("Auth method is required");
  }

  if (config.auth.method === "jamf") {
    if (!config.auth.jamf?.api_url || !config.auth.jamf?.api_key) {
      throw new ConfigError("Jamf configuration incomplete");
    }
    const jamfUrl = validateHttpsUrl(config.auth.jamf.api_url);
    if (!jamfUrl) {
      throw new ConfigError("Jamf API URL must be HTTPS");
    }
    config.auth.jamf.api_url = jamfUrl.toString().replace(/\/$/, "");
  }

  if (config.auth.method === "tailscale") {
    if (!config.auth.tailscale?.api_key) {
      throw new ConfigError("Tailscale API key not configured");
    }
  }

  if (config.auth.method === "mtls") {
    if (!config.auth.mtls?.ca_cert_path) {
      throw new ConfigError("mTLS CA certificate path not configured");
    }
    const caPath = resolveSafePath(baseDir, config.auth.mtls.ca_cert_path);
    if (!caPath) {
      throw new ConfigError("Invalid mTLS CA certificate path");
    }
    config.auth.mtls.ca_cert_path = caPath;
  }

  if (config.signing?.enabled && config.signing.private_key_path) {
    const keyPath = resolveSafePath(baseDir, config.signing.private_key_path);
    if (!keyPath) {
      throw new ConfigError("Invalid signing key path");
    }
    config.signing.private_key_path = keyPath;
  }

  if (config.audit?.log_file) {
    const logPath = resolveSafePath(baseDir, config.audit.log_file);
    if (!logPath) {
      throw new ConfigError("Invalid audit log path");
    }
    config.audit.log_file = logPath;
  }

  if (config.security?.cors?.allowed_origins) {
    const allowed = config.security.cors.allowed_origins.filter(
      (origin) => validateHttpsUrl(origin) !== null,
    );
    config.security.cors.allowed_origins = allowed;
  }

  return true;
}
