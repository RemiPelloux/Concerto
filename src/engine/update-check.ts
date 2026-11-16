import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { userConfigPath } from "#src/config/load.js";

const RELEASES = "https://api.github.com/repos/RemiPelloux/Concerto/releases/latest";
const DAY_MS = 86_400_000;
const TIMEOUT_MS = 2500;
const NOTE_CHARS = 90;

export type Update = { latest: string; note: string };
type Cache = Update & { at: number };

const cachePath = () => join(dirname(userConfigPath()), "update-check.json");

/** 0.13.0 < 0.16.1 < 1.0.0: numeric parts, compared in order. */
export function newer(a: string, b: string): boolean {
  const [x, y] = [a, b].map((v) => v.replace(/^v/, "").split(".").map(Number));
  for (let i = 0; i < Math.max(x?.length ?? 0, y?.length ?? 0); i += 1) {
    const d = (x?.[i] ?? 0) - (y?.[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/** The release notes' first sentence-worth: its first line that is not a heading or blank. */
export function firstLine(body: string): string {
  const line = body.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#")) ?? "";
  return line.length > NOTE_CHARS ? `${line.slice(0, NOTE_CHARS - 1)}…` : line;
}

function readCache(): Cache | null {
  try {
    return existsSync(cachePath()) ? (JSON.parse(readFileSync(cachePath(), "utf8")) as Cache) : null;
  } catch {
    return null;
  }
}

async function fetchLatest(): Promise<Cache | null> {
  try {
    const res = await fetch(RELEASES, { headers: { accept: "application/vnd.github+json", "user-agent": "concerto-update-check" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const release = (await res.json()) as { tag_name?: string; body?: string };
    const fresh = { at: Date.now(), latest: (release.tag_name ?? "").replace(/^v/, ""), note: firstLine(release.body ?? "") };
    mkdirSync(dirname(cachePath()), { recursive: true, mode: 0o700 });
    writeFileSync(cachePath(), JSON.stringify(fresh), { mode: 0o600 });
    return fresh;
  } catch {
    return null;
  }
}

/**
 * A newer release than `current`, asked of GitHub at most once a day, or null. Nothing about you
 * or your project is sent. Off in CI and with CONCERTO_NO_UPDATE_CHECK=1; offline it is silent.
 */
export async function checkForUpdate(current: string, env: NodeJS.ProcessEnv = process.env): Promise<Update | null> {
  if (env.CONCERTO_NO_UPDATE_CHECK || env.CI) return null;
  const cached = readCache();
  const known = cached && Date.now() - cached.at < DAY_MS ? cached : await fetchLatest();
  return known?.latest && newer(known.latest, current) ? { latest: known.latest, note: known.note } : null;
}
