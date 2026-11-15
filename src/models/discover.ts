import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { claudeBin, codexBin, piBin } from "#src/runner/bins.js";
import { childEnv } from "#src/runner/env.js";
import { onPath, runTool } from "#src/runner/tool.js";
import type { ModelRef } from "#src/runner/types.js";

const LIST_TIMEOUT_MS = 30_000;


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

const PI_LIST_TTL_MS = 600_000;
let piListing: Promise<Set<string>> | null = null;

/** Changes to pi's own config files invalidate the cached list. Reads mtimes, never contents. */
function piConfigStamp(): string {
  const dir = process.env.PI_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  return ["models.json", "auth.json", "settings.json"]
    .map((f) => join(dir, f))
    .map((f) => (existsSync(f) ? String(statSync(f).mtimeMs) : "-"))
    .join(":");
}

function piCacheFile(): string {
  return join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "concerto", "pi-models.json");
}

function readPiCache(stamp: string): Set<string> | null {
  try {
    const cached = JSON.parse(readFileSync(piCacheFile(), "utf8")) as { stamp?: string; at?: number; refs?: unknown };
    const fresh = cached.stamp === stamp && Date.now() - (cached.at ?? 0) < PI_LIST_TTL_MS && Array.isArray(cached.refs);
    return fresh ? new Set((cached.refs as unknown[]).filter((r): r is string => typeof r === "string")) : null;
  } catch {
    return null;
  }
}

async function listPi(): Promise<Set<string>> {
  const stamp = piConfigStamp();
  const cached = readPiCache(stamp);
  if (cached) return cached;
  const { stdout } = await runTool(piBin(), ["--list-models", "--offline"], { timeout: LIST_TIMEOUT_MS, env: childEnv() });
  const refs = parseListModels(stdout);
  mkdirSync(dirname(piCacheFile()), { recursive: true, mode: 0o700 });
  writeFileSync(piCacheFile(), JSON.stringify({ stamp, at: Date.now(), refs }), { mode: 0o600 });
  return new Set(refs);
}

/**
 * Models pi can reach. `pi --list-models` takes about half a second, so the answer is shared
 * within a run and cached for ten minutes on disk, until pi's config files change.
 */
export function piRefs(): Promise<Set<string>> {
  if (!onPath(piBin())) return Promise.resolve(new Set());
  piListing ??= listPi().catch((error: unknown) => {
    piListing = null;
    throw error;
  });
  return piListing;
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
