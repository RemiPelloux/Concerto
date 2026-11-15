import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { claudeBin } from "../runner/claude.js";
import { codexBin } from "../runner/codex.js";
import { childEnv } from "../runner/env.js";
import { piBin } from "../runner/pi.js";
import type { ModelRef } from "../runner/types.js";

const run = promisify(execFile);
const LIST_TIMEOUT_MS = 30_000;

export function onPath(bin: string): boolean {
  if (bin.includes("/")) return existsSync(bin);
  return (process.env.PATH ?? "").split(delimiter).some((dir) => dir && existsSync(join(dir, bin)));
}

export function codexHome(): string {
  return process.env.CODEX_HOME ?? join(homedir(), ".codex");
}

/** Model slugs the ChatGPT subscription offers, from Codex's own cache. Empty when unknown. */
export function codexSlugs(): Set<string> {
  const file = join(codexHome(), "models_cache.json");
  if (!existsSync(file)) return new Set();
  const data = JSON.parse(readFileSync(file, "utf8")) as { models?: { slug?: unknown }[] };
  return new Set((data.models ?? []).flatMap((m) => (typeof m.slug === "string" ? [m.slug] : [])));
}

const PROFILE_SUFFIX = ".config.toml";

/** Codex profiles: every `$CODEX_HOME/<name>.config.toml`, e.g. a proxy such as ce-gpt. */
export function codexProfiles(): string[] {
  const home = codexHome();
  if (!existsSync(home)) return [];
  return readdirSync(home)
    .filter((f) => f.endsWith(PROFILE_SUFFIX) && f !== "config.toml")
    .map((f) => f.slice(0, -PROFILE_SUFFIX.length))
    .sort();
}

/** Parses the table printed by `pi --list-models` into "provider/id" refs. */
export function parseListModels(text: string): string[] {
  return text
    .split("\n")
    .slice(1)
    .flatMap((row) => {
      const [provider, id] = row.trim().split(/\s+/);
      return provider && id ? [`${provider}/${id}`] : [];
    });
}

export async function piRefs(): Promise<Set<string>> {
  if (!onPath(piBin())) return new Set();
  const { stdout } = await run(piBin(), ["--list-models", "--offline"], { timeout: LIST_TIMEOUT_MS, env: childEnv() });
  return new Set(parseListModels(stdout));
}

/**
 * Which configured refs can run right now. Each source is checked once, and pi is only
 * started when the config uses pi models at all.
 */
export async function reachableRefs(refs: ModelRef[]): Promise<Set<string>> {
  const usesPi = refs.some((r) => r.backend === "pi");
  const [pi, slugs] = [usesPi ? await piRefs() : new Set<string>(), codexSlugs()];
  const hasClaude = onPath(claudeBin());
  const hasCodex = onPath(codexBin());
  const ok = (r: ModelRef): boolean => {
    if (r.backend === "claude-code") return hasClaude;
    if (r.backend === "pi") return pi.has(`${r.prefix}/${r.id}`);
    if (!hasCodex) return false;
    return r.profile ? existsSync(join(codexHome(), `${r.profile}.config.toml`)) : slugs.size === 0 || slugs.has(r.id);
  };
  return new Set(refs.filter(ok).map((r) => `${r.prefix}/${r.id}`));
}
