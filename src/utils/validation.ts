import { isIP } from "node:net";
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";

const OWNER_REPO_PATTERN = /^[A-Za-z0-9_-]+$/;
const TAG_PATTERN = /^[A-Za-z0-9._-]+$/;
const SEMVER_PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const ASSET_PATTERN = /^[A-Za-z0-9._+() -]+$/;

export const MAX_OWNER_REPO_LENGTH = 100;
export const MAX_VERSION_LENGTH = 200;
export const MAX_ASSET_LENGTH = 200;
export const MAX_HEADER_LENGTH = 2048;

export function validateOwnerRepo(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_OWNER_REPO_LENGTH) {
    return null;
  }
  if (!OWNER_REPO_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function validateVersion(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_VERSION_LENGTH) {
    return null;
  }
  if (SEMVER_PATTERN.test(trimmed) || TAG_PATTERN.test(trimmed)) {
    return trimmed;
  }
  return null;
}

export function validateAssetName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ASSET_LENGTH) {
    return null;
  }
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    return null;
  }
  if (!ASSET_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function validateHeaderValue(
  value: string | undefined,
  maxLength: number = MAX_HEADER_LENGTH,
): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    return null;
  }
  if (/[\r\n\0]/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function validateTokenHeader(value: string | undefined): string | null {
  const token = validateHeaderValue(value, MAX_HEADER_LENGTH);
  if (!token) {
    return null;
  }
  if (!/^[A-Za-z0-9._~=-]+$/.test(token)) {
    return null;
  }
  return token;
}

export function validateUserHeader(value: string | undefined): string | null {
  const user = validateHeaderValue(value, MAX_HEADER_LENGTH);
  if (!user) {
    return null;
  }
  if (!/^[A-Za-z0-9._@+-]+$/.test(user) || user.length > MAX_OWNER_REPO_LENGTH) {
    return null;
  }
  return user;
}

export function validateDeviceHeader(value: string | undefined): string | null {
  const device = validateHeaderValue(value, MAX_HEADER_LENGTH);
  if (!device) {
    return null;
  }
  if (!/^[A-Za-z0-9._-]+$/.test(device) || device.length > MAX_OWNER_REPO_LENGTH) {
    return null;
  }
  return device;
}

export function validateDeviceId(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_OWNER_REPO_LENGTH) {
    return null;
  }
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function parseForwardedFor(value: string | undefined): string {
  if (!value) {
    return "0.0.0.0";
  }
  const first = value.split(",")[0]?.trim();
  if (!first) {
    return "0.0.0.0";
  }
  if (isIP(first)) {
    return first;
  }
  if (first.startsWith("[") && first.includes("]")) {
    const inner = first.slice(1, first.indexOf("]"));
    if (isIP(inner)) {
      return inner;
    }
  }
  const ipv4Port = first.split(":")[0];
  if (isIP(ipv4Port)) {
    return ipv4Port;
  }
  return "0.0.0.0";
}

export function validateIpAddress(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (isIP(trimmed)) {
    return trimmed;
  }
  return null;
}

export function getHeader(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const key = name.toLowerCase();
  if (headers[key] !== undefined) {
    return headers[key];
  }
  const matched = Object.entries(headers).find(
    ([headerName]) => headerName.toLowerCase() === key,
  );
  return matched ? matched[1] : undefined;
}

export function resolveSafePath(baseDir: string, inputPath: string): string | null {
  const trimmed = inputPath.trim();
  if (trimmed.length === 0 || trimmed.length > 4096) {
    return null;
  }
  if (trimmed.includes("\0")) {
    return null;
  }
  const rawSegments = trimmed.split(/[\\/]+/).filter(Boolean);
  if (rawSegments.includes("..")) {
    return null;
  }
  const resolved = isAbsolute(trimmed) ? normalize(trimmed) : resolve(baseDir, trimmed);
  if (!isAbsolute(resolved)) {
    return null;
  }
  if (!isAbsolute(trimmed)) {
    const rel = relative(baseDir, resolved);
    if (rel === ".." || rel.startsWith(`..${sep}`)) {
      return null;
    }
  }
  return resolved;
}

export function validateHttpsUrl(value: string | undefined): URL | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") {
      return null;
    }
    if (url.username || url.password) {
      return null;
    }
    if (!url.hostname) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function collectValidatedHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, name) => {
    const safeValue = validateHeaderValue(value);
    if (safeValue) {
      result[name.toLowerCase()] = safeValue;
    }
  });
  return result;
}

export function validateOrigin(value: string | undefined): string | null {
  const header = validateHeaderValue(value, MAX_HEADER_LENGTH);
  if (!header) {
    return null;
  }
  const url = validateHttpsUrl(header);
  if (!url) {
    return null;
  }
  return url.origin;
}
