import { readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { loadAliases, type Alias } from "#src/engine/aliases.js";
import { languageOf, type Repo } from "#src/engine/languages.js";
import { loadManifests } from "#src/engine/manifests.js";
import type { ParseCache } from "#src/engine/parse-cache.js";

export { isTestFile } from "#src/engine/languages.js";

const SOURCE = /\.(?:[cm]?[jt]sx?|py|go|rs|php|java|kt|kts|cs|rb|swift)$/;
const JS_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const MAX_FILES = 5000;
const MAX_BYTES = 262_144;
const DEFAULT_DEPTH = 4;
const JS_IMPORT = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]/gm;
const PY_IMPORT = /^\s*(?:from\s+([.\w]+)\s+import|import\s+([.\w]+))/gm;

/** Code that tests can cover: docs, config and assets are not. */
const CODE_FILE = /\.(?:[cm]?[jt]sx?|py|go|rs|php|rb|java|kt|kts|swift|dart|cs|c|cc|cpp|h|hpp|scala|ex|exs|vue|svelte)$/;

export function isCodeFile(path: string): boolean {
  return CODE_FILE.test(path);
}

function jsCandidates(base: string): string[] {
  const swapped = base.replace(/\.[cm]?js$/, "");
  const roots = swapped === base ? [base] : [base, swapped];
  return roots.flatMap((r) => [r, ...JS_EXTS.map((e) => r + e), ...JS_EXTS.map((e) => `${r}/index${e}`)]);
}

function pyCandidates(from: string, spec: string): string[] {
  const dots = /^\.*/.exec(spec)?.[0].length ?? 0;
  const parts = spec.slice(dots).split(".").filter(Boolean);
  const up = dots > 0 ? posix.join(posix.dirname(from), ...Array<string>(dots - 1).fill("..")) : "";
  const base = posix.join(up, ...parts);
  return [`${base}.py`, `${base}/__init__.py`];
}

export type Resolution = { files: ReadonlySet<string>; aliases?: readonly Alias[] };

/**
 * A JS/TS specifier as repository paths to try: relative, or through each alias that matches,
 * workspace packages included (`@acme/ui` matches the `@acme/ui/` alias).
 */
function jsBases(from: string, spec: string, aliases: readonly Alias[]): string[] {
  if (spec.startsWith(".")) return [posix.normalize(posix.join(posix.dirname(from), spec))];
  const matching = aliases.filter((a) => spec.startsWith(a.prefix) || `${spec}/` === a.prefix);
  return matching.map((a) => posix.normalize(posix.join(a.target, spec.slice(a.prefix.length))).replace(/\/$/, ""));
}

/** Local imports only: packages are not part of the repository's blast radius. */
export function resolveImport(from: string, spec: string, r: Resolution): string | null {
  if (from.endsWith(".py")) return pyCandidates(from, spec).find((c) => r.files.has(c)) ?? null;
  return jsBases(from, spec, r.aliases ?? []).flatMap(jsCandidates).find((c) => r.files.has(c)) ?? null;
}

function specifiers(path: string, text: string): string[] {
  const language = languageOf(path);
  if (language) return language.scan(text).filter(Boolean);
  const pattern = path.endsWith(".py") ? PY_IMPORT : JS_IMPORT;
  return [...text.matchAll(pattern)].flatMap((m) => m.slice(1).filter((g): g is string => Boolean(g)));
}

function targets(from: string, spec: string, at: { repo: Repo; resolution: Resolution }): string[] {
  const language = languageOf(from);
  if (language) return language.resolve(from, spec, at.repo);
  const target = resolveImport(from, spec, at.resolution);
  return target ? [target] : [];
}

function countLines(text: string): number {
  return text === "" ? 0 : text.split("\n").length;
}

function readSource(cwd: string, path: string, cache?: ParseCache): string {
  try {
    const full = join(cwd, path);
    if (statSync(full).size > MAX_BYTES) return "";
    return cache ? cache.reads.read(full) : readFileSync(full, "utf8");
  } catch {
    return "";
  }
}

/** Files by folder and by name, for the languages whose imports name a folder or a class. */
function repoOf(cwd: string, files: readonly string[]): Repo {
  const [byDir, byName] = [new Map<string, string[]>(), new Map<string, string[]>()];
  const add = (map: Map<string, string[]>, key: string, file: string) => map.set(key, [...(map.get(key) ?? []), file]);
  files.forEach((f) => {
    add(byDir, posix.dirname(f), f);
    add(byName, posix.basename(f), f);
  });
  return { files: new Set(files), byDir, byName, declared: new Map(), spaceOf: new Map(), manifests: loadManifests(cwd, files), memo: new Map() };
}

/** Records `=pkg:` and `=ns:` declarations, which Java, Kotlin and C# imports resolve through. */
function declare(repo: Repo, parsed: [string, string[]][]): void {
  parsed.forEach(([from, specs]) => specs.filter((s) => s.startsWith("=pkg:") || s.startsWith("=ns:")).forEach((s) => {
    repo.declared.set(s, [...(repo.declared.get(s) ?? []), from]);
    if (!repo.spaceOf.has(from)) repo.spaceOf.set(from, s);
  }));
}

/**
 * Who imports whom, built once per run from the repository snapshot: JavaScript and TypeScript
 * (relative imports, package.json `imports`, tsconfig `paths`, workspace packages), Python, Go,
 * Rust, PHP, Java, Kotlin, C#, Ruby and Swift. SmartTest, when installed, handles the rest.
 */
export class ImportGraph {
  private readonly importers = new Map<string, Set<string>>();
  private readonly lineCounts = new Map<string, number>();

  constructor(
    private readonly cwd: string,
    files: readonly string[],
    cache?: ParseCache,
  ) {
    const repo = repoOf(cwd, files);
    const resolution = { files: repo.files, aliases: [...loadAliases(cwd), ...repo.manifests.workspaces] };
    const parse = (from: string) => () => {
      const text = readSource(cwd, from, cache);
      return { lines: countLines(text), specifiers: specifiers(from, text) };
    };
    const parsed = files.filter((f) => SOURCE.test(f)).slice(0, MAX_FILES).map((from): [string, string[]] => {
      const p = cache ? cache.get(cwd, from, parse(from)) : parse(from)();
      this.lineCounts.set(from, p.lines);
      return [from, p.specifiers];
    });
    cache?.save();
    declare(repo, parsed);
    parsed.forEach(([from, specs]) => specs.forEach((spec) => this.link(from, targets(from, spec, { repo, resolution }))));
  }

  private link(from: string, to: string[]): void {
    to.filter((t) => t !== from).forEach((t) => this.importers.set(t, (this.importers.get(t) ?? new Set()).add(from)));
  }

  /** Every file that imports any of `files`, with its distance: 1 = imports it directly. */
  levels(files: readonly string[], depth = DEFAULT_DEPTH): Map<string, number> {
    const hops = new Map<string, number>(files.map((f) => [f, 0]));
    let frontier = [...files];
    for (let hop = 1; hop <= depth && frontier.length > 0; hop += 1) {
      frontier = frontier.flatMap((f) => [...(this.importers.get(f) ?? [])]).filter((f) => !hops.has(f) && hops.set(f, hop));
    }
    files.forEach((f) => hops.delete(f));
    return hops;
  }

  /** Line count of a repository file; parsed sources are already known, others are read once. */
  lines(file: string): number {
    const known = this.lineCounts.get(file);
    if (known !== undefined) return known;
    const counted = countLines(readSource(this.cwd, file));
    this.lineCounts.set(file, counted);
    return counted;
  }

  /** Files that import any of `files`, directly or through up to `depth` hops. */
  dependentsOf(files: readonly string[], depth = DEFAULT_DEPTH): string[] {
    return [...this.levels(files, depth).keys()];
  }
}

