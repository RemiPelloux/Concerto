import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { userConfigPath } from "#src/config/load.js";
import { resetAt } from "#src/models/reset-time.js";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_SECOND = 1000;
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
/** A plain 429 with no reset time: wait a quarter of an hour before trying that account again. */
const DEFAULT_PAUSE_MINUTES = 15;
/** Usage older than the longest window anyone sets is dropped when the file is rewritten. */
const KEEP_HOURS = 24;
/** Claude Code says "You've hit your 5-hour limit" or "your weekly limit". */
const RATE_LIMIT = /rate.?limit|usage limit|hit your [\w -]*limit|quota|too many requests|\b429\b/i;
const RESET_EPOCH = /limit reached\|(\d{10})/i;
const RESET_IN = /(?:try again|resets?) in (\d+)\s*(minute|hour)/i;

/** One account a model is reached through: `claude-code`, `codex`, `codex@ce-gpt`, `anthropic`… */
export type Limit = { windowHours: number; maxUsd: number };
type Spend = { at: number; account: string; cost: number };
type Pause = { at: number; account: string; until: number };
type Line = Spend | Pause;

export const usagePath = () => join(dirname(userConfigPath()), "usage.jsonl");

function lines(path: string): Line[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").flatMap((l) => {
    try {
      return l ? [JSON.parse(l) as Line] : [];
    } catch {
      return [];
    }
  });
}

function append(path: string, line: Line): void {
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
  const kept = lines(path).filter((l) => l.at > Date.now() - KEEP_HOURS * MS_PER_HOUR);
  writeFileSync(path, kept.map((l) => `${JSON.stringify(l)}\n`).join(""), { mode: FILE_MODE });
  appendFileSync(path, `${JSON.stringify(line)}\n`);
  chmodSync(path, FILE_MODE);
}

/** Records what one call cost on its account, for the rolling window. */
export function recordSpend(account: string, cost: number, path = usagePath()): void {
  if (cost > 0) append(path, { at: Date.now(), account, cost });
}

/**
 * When an error says the account is rate-limited, pauses it until the reset it names (an epoch,
 * Codex's "try again in 2 hours", Claude Code's "resets 6:40pm (Europe/Paris)"), or a quarter of
 * an hour. Returns whether it did.
 */
export function pauseOnLimit(account: string, message: string, path = usagePath()): boolean {
  if (!RATE_LIMIT.test(message)) return false;
  const epoch = RESET_EPOCH.exec(message)?.[1];
  const inMatch = RESET_IN.exec(message);
  const wait = inMatch ? Number(inMatch[1]) * (inMatch[2]?.toLowerCase() === "hour" ? MS_PER_HOUR : MS_PER_MINUTE) : DEFAULT_PAUSE_MINUTES * MS_PER_MINUTE;
  const until = epoch ? Number(epoch) * MS_PER_SECOND : (resetAt(message) ?? Date.now() + wait);
  append(path, { at: Date.now(), account, until });
  return true;
}

/** Why the account should not take a call right now, or null: paused, or its window is spent. */
export function blocked(account: string, limit: Limit | undefined, path = usagePath()): string | null {
  const now = Date.now();
  const all = lines(path).filter((l) => l.account === account);
  const pause = all.filter((l): l is Pause => "until" in l && l.until > now).at(-1);
  if (pause) return `rate-limited until ${new Date(pause.until).toLocaleTimeString()}`;
  if (!limit) return null;
  const spent = all.filter((l): l is Spend => "cost" in l && l.at > now - limit.windowHours * MS_PER_HOUR).reduce((s, l) => s + l.cost, 0);
  return spent >= limit.maxUsd ? `$${spent.toFixed(2)} of its $${limit.maxUsd} per ${limit.windowHours} h window used` : null;
}
