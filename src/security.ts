/**
 * Security module for Claude Telegram Bot.
 *
 * Rate limiting, path validation, command safety.
 */

import { resolve, normalize, isAbsolute } from "path";
import { realpathSync } from "fs";
import type { RateLimitBucket } from "./types";
import {
  ALLOWED_PATHS,
  BLOCKED_PATTERNS,
  RATE_LIMIT_ENABLED,
  RATE_LIMIT_REQUESTS,
  RATE_LIMIT_WINDOW,
  TEMP_PATHS,
  WORKING_DIR,
} from "./config";

// ============== Rate Limiter ==============

class RateLimiter {
  private buckets = new Map<number, RateLimitBucket>();
  private maxTokens: number;
  private refillRate: number; // tokens per second

  constructor() {
    this.maxTokens = RATE_LIMIT_REQUESTS;
    this.refillRate = RATE_LIMIT_REQUESTS / RATE_LIMIT_WINDOW;
  }

  check(userId: number): [allowed: boolean, retryAfter?: number] {
    if (!RATE_LIMIT_ENABLED) {
      return [true];
    }

    const now = Date.now();
    let bucket = this.buckets.get(userId);

    if (!bucket) {
      bucket = { tokens: this.maxTokens, lastUpdate: now };
      this.buckets.set(userId, bucket);
    }

    // Refill tokens based on time elapsed
    const elapsed = (now - bucket.lastUpdate) / 1000;
    bucket.tokens = Math.min(
      this.maxTokens,
      bucket.tokens + elapsed * this.refillRate
    );
    bucket.lastUpdate = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return [true];
    }

    // Calculate time until next token
    const retryAfter = (1 - bucket.tokens) / this.refillRate;
    return [false, retryAfter];
  }

  getStatus(userId: number): {
    tokens: number;
    max: number;
    refillRate: number;
  } {
    const bucket = this.buckets.get(userId);
    return {
      tokens: bucket?.tokens ?? this.maxTokens,
      max: this.maxTokens,
      refillRate: this.refillRate,
    };
  }
}

export const rateLimiter = new RateLimiter();

// ============== Path Validation ==============

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function expandUserPath(rawPath: string): string {
  const home = process.env.HOME || "";
  const dequoted = stripWrappingQuotes(rawPath.trim());
  return dequoted
    .replace(/^~(?=\/|$)/, home)
    .replace(/^\$HOME(?=\/|$)/, home);
}

export function isPathAllowed(path: string): boolean {
  try {
    // Expand ~/$HOME and resolve to absolute path.
    const expanded = expandUserPath(path);
    const normalizedPath = normalize(expanded);

    // Try to resolve symlinks (may fail if path doesn't exist yet)
    let resolved: string;
    try {
      const candidate = isAbsolute(normalizedPath)
        ? normalizedPath
        : resolve(WORKING_DIR, normalizedPath);
      resolved = realpathSync(candidate);
    } catch {
      resolved = isAbsolute(normalizedPath)
        ? resolve(normalizedPath)
        : resolve(WORKING_DIR, normalizedPath);
    }

    // Always allow temp paths (for bot's own files)
    for (const tempPath of TEMP_PATHS) {
      if (resolved.startsWith(tempPath)) {
        return true;
      }
    }

    // Check against allowed paths using proper containment
    for (const allowed of ALLOWED_PATHS) {
      const allowedResolved = resolve(allowed);
      if (
        resolved === allowedResolved ||
        resolved.startsWith(allowedResolved + "/")
      ) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

// ============== Command Safety ==============

export function checkCommandSafety(
  command: string
): [safe: boolean, reason: string] {
  const lowerCommand = command.toLowerCase();

  // Check blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (lowerCommand.includes(pattern.toLowerCase())) {
      return [false, `Blocked pattern: ${pattern}`];
    }
  }

  // Special handling for rm commands - validate paths.
  // We parse each shell segment to avoid false positives with operators.
  if (/\brm\b/i.test(command)) {
    try {
      const segments = command.split(/&&|\|\||;|\|/);
      for (const segment of segments) {
        const tokens = segment.match(/"[^"]*"|'[^']*'|\S+/g) || [];
        const rmIndex = tokens.findIndex((token) =>
          /^(?:\S*\/)?rm$/i.test(stripWrappingQuotes(token))
        );

        if (rmIndex === -1) continue;

        for (let i = rmIndex + 1; i < tokens.length; i++) {
          const rawArg = tokens[i]!;
          const arg = stripWrappingQuotes(rawArg);

          // Skip flags and separators
          if (!arg || arg.startsWith("-") || arg === "--") continue;

          if (!isPathAllowed(arg)) {
            return [false, `rm target outside allowed paths: ${rawArg}`];
          }
        }
      }
    } catch {
      // If parsing fails, be cautious
      return [false, "Could not parse rm command for safety check"];
    }
  }

  return [true, ""];
}

// ============== Authorization ==============

export function isAuthorized(
  userId: number | undefined,
  allowedUsers: number[]
): boolean {
  if (!userId) return false;
  if (allowedUsers.length === 0) return false;
  return allowedUsers.includes(userId);
}
