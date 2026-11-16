import { readFileSync, writeFileSync } from "node:fs";

/** The config format this Concerto reads and writes. A config without `version` is from 0.x. */
export const CONFIG_VERSION = 1;

type Raw = Record<string, unknown>;

/**
 * One step per version: MIGRATIONS[n] takes a version-n config to n + 1. Every 0.x release only
 * added keys, each with a default, so 0 to 1 marks the version and changes nothing else.
 */
const MIGRATIONS: ((raw: Raw) => Raw)[] = [(raw) => ({ version: 1, ...raw })];

function versionOf(raw: Raw, source: string): number {
  const v = raw.version ?? 0;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new Error(`${source}: "version" must be a whole number, the config format it was written in.`);
  return v;
}

/** The config brought up to CONFIG_VERSION, and the version it was in. Refuses a config from a newer Concerto. */
export function migrateConfig(raw: unknown, source: string): { config: Raw; from: number } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { config: raw as Raw, from: CONFIG_VERSION };
  const from = versionOf(raw as Raw, source);
  if (from > CONFIG_VERSION) throw new Error(`${source} was written by a newer Concerto (config version ${from}; this one reads up to ${CONFIG_VERSION}). Update Concerto: concerto --update.`);
  const config = MIGRATIONS.slice(from).reduce((r, step) => step(r), raw as Raw);
  return { config: { ...config, version: CONFIG_VERSION }, from };
}

/** `--migrate-config`: rewrites a config file in the current format; false when it already was. */
export function migrateFile(path: string): boolean {
  const { config, from } = migrateConfig(JSON.parse(readFileSync(path, "utf8")), path);
  if (from === CONFIG_VERSION) return false;
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  return true;
}
