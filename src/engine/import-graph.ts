import { readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { loadAliases, type Alias } from "#src/engine/aliases.js";

const SOURCE = /\.(?:[cm]?[jt]sx?|py)$/;
const JS_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const MAX_FILES = 5000;
const MAX_BYTES = 262_144;
const DEFAULT_DEPTH = 4;
const JS_IMPORT = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]/gm;
const PY_IMPORT = /^\s*(?:from\s+([.\w]+)\s+import|import\s+([.\w]+))/gm;
const TEST_FILE = /(?:^|\/)(?:__tests__|tests?|spec)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)test_[^/]+\.py$|_test\.py$/;

/** Code that tests can cover: docs, config and assets are not. */
const CODE_FILE = /\.(?:[cm]?[jt]sx?|py|go|rs|php|rb|java|kt|kts|swift|dart|cs|c|cc|cpp|h|hpp|scala|ex|exs|vue|svelte)$/;

export function isCodeFile(path: string): boolean {
  return CODE_FILE.test(path);
}

export function isTestFile(path: string): boolean {
  return TEST_FILE.test(path);
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

/** A JS/TS specifier as a repository path: relative, or through a declared alias. Else null. */
function jsBase(from: string, spec: string, aliases: readonly Alias[]): string | null {
  if (spec.startsWith(".")) return posix.normalize(posix.join(posix.dirname(from), spec));
  const alias = aliases.find((a) => spec.startsWith(a.prefix));
  return alias ? posix.normalize(posix.join(alias.target, spec.slice(alias.prefix.length))) : null;
}

/** Local imports only: packages are not part of the repository's blast radius. */
export function resolveImport(from: string, spec: string, r: Resolution): string | null {
  if (from.endsWith(".py")) return pyCandidates(from, spec).find((c) => r.files.has(c)) ?? null;
  const base = jsBase(from, spec, r.aliases ?? []);
  return base === null ? null : (jsCandidates(base).find((c) => r.files.has(c)) ?? null);
}

function specifiers(path: string, text: string): string[] {
  const pattern = path.endsWith(".py") ? PY_IMPORT : JS_IMPORT;
  return [...text.matchAll(pattern)].flatMap((m) => m.slice(1).filter((g): g is string => Boolean(g)));
}

function countLines(text: string): number {
  return text === "" ? 0 : text.split("\n").length;
}

function readSource(cwd: string, path: string): string {
  try {
    const full = join(cwd, path);
    return statSync(full).size > MAX_BYTES ? "" : readFileSync(full, "utf8");
  } catch {
    return "";
  }
}

/**
 * Who imports whom, for JavaScript, TypeScript and Python, built once per run from the
 * repository snapshot. Relative imports and the aliases the repository declares (package.json
 * `imports`, tsconfig `paths`); SmartTest, when installed, handles the rest.
 */
export class ImportGraph {
  private readonly importers = new Map<string, Set<string>>();
  private readonly lineCounts = new Map<string, number>();

  constructor(
    private readonly cwd: string,
    files: readonly string[],
  ) {
    const resolution = { files: new Set(files), aliases: loadAliases(cwd) };
    files.filter((f) => SOURCE.test(f)).slice(0, MAX_FILES).forEach((from) => {
      const text = readSource(cwd, from);
      this.lineCounts.set(from, countLines(text));
      specifiers(from, text).forEach((spec) => {
        const target = resolveImport(from, spec, resolution);
        if (target && target !== from) this.importers.set(target, (this.importers.get(target) ?? new Set()).add(from));
      });
    });
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

