import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AuditLog } from "../types";

export class AuditLogger {
  private logFile: string | null;
  private enabled: boolean;

  constructor(logFile?: string) {
    this.logFile = logFile || null;
    this.enabled = !!logFile;

    if (this.logFile) {
      const dir = dirname(this.logFile);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  log(entry: AuditLog): void {
    if (!this.enabled || !this.logFile) {
      return;
    }

    try {
      const line = JSON.stringify(entry) + "\n";
      appendFileSync(this.logFile, line, "utf-8");
    } catch {
      console.warn("Audit log write failed");
      // Silently fail on log write errors
    }
  }

  logAction(
    deviceId: string,
    action: string,
    resource: string,
    status: "success" | "failure",
    details?: Record<string, unknown>,
  ): void {
    this.log({
      timestamp: Date.now(),
      device_id: deviceId,
      action,
      resource,
      status,
      details,
    });
  }
}
