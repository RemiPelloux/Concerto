import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { userConfigPath } from "../config/load.js";

const MS_PER_HOUR = 3_600_000;
/** A failed probe keeps a model out of routing for a day, then it gets another chance. */
const BROKEN_FOR_HOURS = 24;
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

const CheckSchema = z.object({ ok: z.boolean(), checkedAt: z.number(), error: z.string().default("") });
const HealthSchema = z.record(z.string(), CheckSchema);
export type Check = z.infer<typeof CheckSchema>;
export type Health = Record<string, Check>;

export function healthPath(): string {
  return join(dirname(userConfigPath()), "health.json");
}

export function readHealth(path = healthPath()): Health {
  if (!existsSync(path)) return {};
  try {
    const parsed = HealthSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** Merges new probe results into the file; older results for other models are kept. */
export function saveHealth(results: Health, path = healthPath()): Health {
  const merged = { ...readHealth(path), ...results };
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, { mode: FILE_MODE });
  chmodSync(path, FILE_MODE);
  return merged;
}

/** True when the model's last probe failed less than a day ago. */
export function isBroken(health: Health, ref: string, now = Date.now()): boolean {
  const check = health[ref];
  return check !== undefined && !check.ok && now - check.checkedAt < BROKEN_FOR_HOURS * MS_PER_HOUR;
}
