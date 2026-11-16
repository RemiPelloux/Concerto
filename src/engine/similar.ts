import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
/** Share of content words two requests must have in common to be the same request reworded. */
const SAME = 0.85;
const KEPT = 200;
const MS_PER_HOUR = 3_600_000;
/** Words that change the wording, not the request. */
const FILLER = new Set(["a", "an", "the", "to", "of", "and", "or", "in", "on", "for", "with", "please", "can", "you", "i", "we", "want", "would", "like", "it", "its", "this", "that", "so", "just", "also", "then", "be", "is", "are", "should", "make", "sure", "done", "means"]);

type Entry = { at: number; repoKey: string; words: string[]; reply: string };

export const requestsPath = (cwd: string) => join(cwd, ".concerto", "cache", "requests.jsonl");

/** The request's content words, lowercased, filler dropped, each once. */
export function contentWords(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter((w) => w && !FILLER.has(w)))].sort();
}

const numbers = (words: string[]) => words.filter((w) => /\d/.test(w)).join(",");

/** Jaccard overlap of content words; requests that name different numbers never match. */
export function sameRequest(a: string[], b: string[]): boolean {
  if (numbers(a) !== numbers(b)) return false;
  const shared = a.filter((w) => b.includes(w)).length;
  const all = new Set([...a, ...b]).size;
  return all > 0 && shared / all >= SAME;
}

function entries(cwd: string): Entry[] {
  const file = requestsPath(cwd);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").flatMap((l) => {
    try {
      return l ? [JSON.parse(l) as Entry] : [];
    } catch {
      return [];
    }
  });
}

/** The plan a reworded version of this request got, on the same repository state and within the TTL. */
export function planForSimilar(cwd: string, request: string, opts: { repoKey: string; ttlHours: number }): string | null {
  const words = contentWords(request);
  const fresh = Date.now() - opts.ttlHours * MS_PER_HOUR;
  const hit = entries(cwd).reverse().find((e) => e.at > fresh && e.repoKey === opts.repoKey && sameRequest(words, e.words));
  return hit?.reply ?? null;
}

/** Remembers the plan a request got, keeping the newest KEPT, owner-only. */
export function rememberPlan(cwd: string, request: string, opts: { repoKey: string; reply: string }): void {
  const file = requestsPath(cwd);
  mkdirSync(dirname(file), { recursive: true, mode: DIR_MODE });
  const kept = entries(cwd).slice(-(KEPT - 1));
  writeFileSync(file, kept.map((e) => `${JSON.stringify(e)}\n`).join(""), { mode: FILE_MODE });
  appendFileSync(file, `${JSON.stringify({ at: Date.now(), repoKey: opts.repoKey, words: contentWords(request), reply: opts.reply })}\n`);
}
