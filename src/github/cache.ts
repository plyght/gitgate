import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { CacheEntry } from "../types";

export class CacheManager {
  private cacheDir: string;
  private ttl: number;

  constructor(cacheDir: string, ttlSeconds: number = 3600) {
    this.cacheDir = cacheDir;
    this.ttl = ttlSeconds;

    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }
  }

  private getCachePath(key: string): string {
    const hash = createHash("sha256").update(key).digest("hex");
    return resolve(this.cacheDir, `${hash}.cache`);
  }

  get(key: string): Buffer | null {
    const path = this.getCachePath(key);

    if (!existsSync(path)) {
      return null;
    }

    try {
      const content = readFileSync(path, "utf-8");
      const entry = JSON.parse(content) as CacheEntry;

      if (Date.now() - entry.timestamp > entry.ttl * 1000) {
        return null;
      }

      return Buffer.from(entry.data, "base64");
    } catch {
      console.warn("Cache read failed");
      return null;
    }
  }

  set(key: string, data: Buffer): void {
    const path = this.getCachePath(key);
    const checksum = createHash("sha256").update(data).digest("hex");

    const entry: CacheEntry = {
      data: data.toString("base64"),
      checksum,
      timestamp: Date.now(),
      ttl: this.ttl,
    };

    try {
      writeFileSync(path, JSON.stringify(entry), "utf-8");
    } catch {
      console.warn("Cache write failed");
      // Silently fail on cache write errors
    }
  }

  getChecksum(key: string): string | null {
    const path = this.getCachePath(key);

    if (!existsSync(path)) {
      return null;
    }

    try {
      const content = readFileSync(path, "utf-8");
      const entry = JSON.parse(content) as CacheEntry;

      if (Date.now() - entry.timestamp > entry.ttl * 1000) {
        return null;
      }

      return entry.checksum;
    } catch {
      console.warn("Cache checksum read failed");
      return null;
    }
  }

  clear(key: string): void {
    const path = this.getCachePath(key);
    if (existsSync(path)) {
      try {
        // Use a simple approach to delete
        writeFileSync(path, "");
      } catch {
        console.warn("Cache clear failed");
        // Silently fail
      }
    }
  }
}
