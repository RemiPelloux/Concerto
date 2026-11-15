import { readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";

const SOURCE = /\.(?:[cm]?[jt]sx?|py)$/;
const JS_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const MAX_FILES = 5000;
const MAX_BYTES = 262_144;
const DEFAULT_DEPTH = 4;
const JS_IMPORT = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]/gm;
const PY_IMPORT = /^\s*(?:from\s+([.\w]+)\s+import|import\s+([.\w]+))/gm;
const TEST_FILE = /(?:^|\/)(?:__tests__|tests?|spec)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)test_[^/]+\.py$|_test\.py$/;

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

/** Local imports only: packages are not part of the repository's blast radius. */
export function resolveImport(from: string, spec: string, files: ReadonlySet<string>): string | null {
  const candidates = from.endsWith(".py")
    ? pyCandidates(from, spec)
    : spec.startsWith(".") ? jsCandidates(posix.normalize(posix.join(posix.dirname(from), spec))) : [];
  return candidates.find((c) => files.has(c)) ?? null;
}

function specifiers(path: string, text: string): string[] {
  const pattern = path.endsWith(".py") ? PY_IMPORT : JS_IMPORT;
  return [...text.matchAll(pattern)].flatMap((m) => m.slice(1).filter((g): g is string => Boolean(g)));
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
 * repository snapshot. Relative imports only; SmartTest, when installed, handles the rest.
 */
export class ImportGraph {
  private readonly importers = new Map<string, Set<string>>();

  constructor(cwd: string, files: readonly string[]) {
    const known = new Set(files);
    files.filter((f) => SOURCE.test(f)).slice(0, MAX_FILES).forEach((from) => {
      specifiers(from, readSource(cwd, from)).forEach((spec) => {
        const target = resolveImport(from, spec, known);
        if (target && target !== from) this.importers.set(target, (this.importers.get(target) ?? new Set()).add(from));
      });
    });
  }

  /** Files that import any of `files`, directly or through up to `depth` hops. */
  dependentsOf(files: readonly string[], depth = DEFAULT_DEPTH): string[] {
    const start = new Set(files);
    const seen = new Set(files);
    let frontier = [...start];
    for (let hop = 0; hop < depth && frontier.length > 0; hop += 1) {
      frontier = frontier.flatMap((f) => [...(this.importers.get(f) ?? [])]).filter((f) => !seen.has(f) && seen.add(f));
    }
    return [...seen].filter((f) => !start.has(f));
  }
}

