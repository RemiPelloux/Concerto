import { posix } from "node:path";
import { isTestFile } from "./import-graph.js";

const MAX_FILES_PER_STORY = 20;
/** Shorter stems ("db", "api") match too much to be a safe correction. */
const MIN_STEM = 4;

/** Repository-relative, normalized, no `..`: the scorer's paths are model output. */
export function safePaths(paths: readonly string[]): string[] {
  const clean = paths.map((p) => posix.normalize(p.trim().replace(/^\.\//, "")));
  return [...new Set(clean)].filter((p) => p && !p.startsWith("/") && !p.split("/").includes("..")).slice(0, MAX_FILES_PER_STORY);
}

/** "src/engine/condense.ts" -> "condense"; "tests/a.test.ts" -> "a". */
function stem(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  return base.replace(/\.(?:test|spec)(?=\.)/, "").replace(/\.[^.]+$/, "").replace(/[^a-z0-9]/g, "");
}

function sharedSegments(a: string, b: string): number {
  const bs = new Set(b.split("/"));
  return a.split("/").filter((s) => bs.has(s)).length;
}

/**
 * Models misremember paths ("src/runner/condenser.ts" for "src/engine/condense.ts"). A path
 * that does not exist is matched to an existing file with the same stem, or a stem one is a
 * prefix of, in the same test/source kind; the closest directory wins. No match: a new file.
 */
export class PathMatcher {
  private readonly byStem = new Map<string, string[]>();

  constructor(private readonly known: ReadonlySet<string>) {
    known.forEach((f) => this.byStem.set(stem(f), [...(this.byStem.get(stem(f)) ?? []), f]));
  }

  match(path: string): string | null {
    if (this.known.has(path)) return path;
    const wanted = stem(path);
    if (wanted.length < MIN_STEM) return null;
    const stems = [wanted, ...[...this.byStem.keys()].filter((s) => s.length >= MIN_STEM && (wanted.startsWith(s) || s.startsWith(wanted)))];
    const candidates = stems.flatMap((s) => this.byStem.get(s) ?? []).filter((f) => isTestFile(f) === isTestFile(path));
    return candidates.sort((a, b) => sharedSegments(b, path) - sharedSegments(a, path))[0] ?? null;
  }
}
