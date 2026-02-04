import type { RateLimitState } from "../types";

export class RateLimiter {
  private limits: Map<string, RateLimitState>;
  private requestsPerMinute: number;

  constructor(requestsPerMinute: number = 60) {
    this.limits = new Map();
    this.requestsPerMinute = requestsPerMinute;
  }

  private consumeInternal(deviceId: string): {
    allowed: boolean;
    remaining: number;
    reset_at: number;
  } {
    const now = Date.now();
    const state = this.limits.get(deviceId);
    const limit = this.requestsPerMinute;

    if (!state) {
      this.limits.set(deviceId, {
        requests: 1,
        reset_at: now + 60000,
        violations: 0,
      });
      return {
        allowed: true,
        remaining: Math.max(0, limit - 1),
        reset_at: now + 60000,
      };
    }

    if (state.blocked_until && now < state.blocked_until) {
      return {
        allowed: false,
        remaining: 0,
        reset_at: state.blocked_until,
      };
    }

    if (now > state.reset_at) {
      state.requests = 1;
      state.reset_at = now + 60000;
      state.violations = Math.max(0, (state.violations ?? 0) - 1);
      return {
        allowed: true,
        remaining: Math.max(0, limit - 1),
        reset_at: state.reset_at,
      };
    }

    if (state.requests < limit) {
      state.requests += 1;
      return {
        allowed: true,
        remaining: Math.max(0, limit - state.requests),
        reset_at: state.reset_at,
      };
    }

    const violations = (state.violations ?? 0) + 1;
    state.violations = violations;
    const blockMs = Math.min(15 * 60 * 1000, 60000 * violations);
    state.blocked_until = now + blockMs;
    return {
      allowed: false,
      remaining: 0,
      reset_at: state.blocked_until,
    };
  }

  consume(deviceId: string): {
    allowed: boolean;
    limit: number;
    remaining: number;
    reset_at: number;
  } {
    const result = this.consumeInternal(deviceId);
    return {
      allowed: result.allowed,
      limit: this.requestsPerMinute,
      remaining: result.remaining,
      reset_at: result.reset_at,
    };
  }

  isAllowed(deviceId: string): boolean {
    return this.consumeInternal(deviceId).allowed;
  }

  getRemainingRequests(deviceId: string): number {
    const now = Date.now();
    const state = this.limits.get(deviceId);

    if (!state || now > state.reset_at) {
      return this.requestsPerMinute;
    }

    if (state.blocked_until && now < state.blocked_until) {
      return 0;
    }

    return Math.max(0, this.requestsPerMinute - state.requests);
  }

  getResetTime(deviceId: string): number {
    const state = this.limits.get(deviceId);
    if (!state) {
      return Date.now();
    }
    if (state.blocked_until && state.blocked_until > state.reset_at) {
      return state.blocked_until;
    }
    return state.reset_at;
  }
}
