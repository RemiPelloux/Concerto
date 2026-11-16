import { posix } from "node:path";
import type { Manifests } from "#src/engine/manifests.js";

/**
 * Tests by the conventions of each language: test folders, `.test.ts`, `test_x.py`, `x_test.go`,
 * `x_spec.rb`, `XTest.java`, `XTests.cs`, Maven's `src/test/`, Kotlin's `src/commonTest/`, .NET's
 * `Foo.Tests/` and Cucumber's step folders.
 */
const TEST_FILE = new RegExp([
  String.raw`(?:^|/)(?:__tests__|[Tt]ests?|spec|[^/]+\.Tests?|src/\w+Test|features/(?:steps|step_definitions|support))/`,
  String.raw`\.(?:test|spec)\.[cm]?[jt]sx?$`,
  String.raw`(?:^|/)test_[^/]+\.py$|_test\.py$`,
  String.raw`_test\.(?:go|rb)$|_spec\.rb$`,
  String.raw`(?:Tests?|Spec)\.(?:java|kt|cs|php|swift)$`,
].join("|"));

export function isTestFile(path: string): boolean {
  return TEST_FILE.test(path);
}

/** What resolving an import may look at: files by path, folder and name, and what files declare. */
export type Repo = {
  files: ReadonlySet<string>;
  byDir: Map<string, string[]>;
  byName: Map<string, string[]>;
  /** `=pkg:com.acme.billing` or `=ns:Acme.Billing` -> the files declaring it. */
  declared: Map<string, string[]>;
  /** The namespace or package each file declares, the same `=pkg:`/`=ns:` key. */
  spaceOf: Map<string, string>;
  manifests: Manifests;
  memo: Map<string, string[]>;
};

/** How one language names its imports, and where they point in the repository. */
type Language = { source: RegExp; scan: (text: string) => string[]; resolve: (from: string, spec: string, repo: Repo) => string[] };

const stem = (file: string) => posix.basename(file).replace(/\.[^.]+$/, "");
const groups = (text: string, pattern: RegExp) => [...text.matchAll(pattern)];
const exists = (repo: Repo, candidates: string[]) => candidates.filter((c) => repo.files.has(c)).slice(0, 1);
const sourcesIn = (repo: Repo, dir: string, ext: RegExp) => (repo.byDir.get(dir) ?? []).filter((f) => ext.test(f) && !isTestFile(f));
const declaredBy = (repo: Repo, key: string) => repo.declared.get(key) ?? [];

/**
 * Classes of the same namespace or package need no import in PHP, Java, Kotlin and C#: a
 * capitalised name used here that names a file of this file's namespace (or, without one, of its
 * folder) is a use of it.
 */
const NAME = /\b[A-Z][A-Za-z0-9_]*\b/g;
const names = (text: string) => [...new Set(text.match(NAME) ?? [])].map((n) => `ref:${n}`);

function sibling(from: string, spec: string, repo: Repo): string[] {
  const [ext, space] = [posix.extname(from), repo.spaceOf.get(from)];
  const pool = space ? declaredBy(repo, space) : (repo.byDir.get(posix.dirname(from)) ?? []);
  const name = spec.slice("ref:".length);
  // C# writes `[ValidatedNotNull]` for the class ValidatedNotNullAttribute.
  const names = ext === ".cs" ? [name, `${name}Attribute`] : [name];
  return pool.filter((f) => f !== from && posix.extname(f) === ext && names.includes(stem(f)));
}

/** A test sees its own namespace or package without importing it. */
const ownSpace = (from: string, spec: string, repo: Repo) => (isTestFile(from) ? declaredBy(repo, spec).filter((f) => !isTestFile(f)) : []);

/** Files ending in `tail` (a/b/c.rb), shortest tail with a single match winning: a/b/c.rb, then b/c.rb. */
function bySuffix(repo: Repo, segments: string[], ext: string): string[] {
  const named = repo.byName.get(`${segments.at(-1) ?? ""}${ext}`) ?? [];
  for (let k = 0; k < segments.length; k += 1) {
    const tail = `${segments.slice(k).join("/")}${ext}`;
    const hits = named.filter((f) => f === tail || f.endsWith(`/${tail}`));
    if (hits.length === 1 || (hits.length > 1 && k === 0)) return hits;
  }
  return [];
}

// Go: an import names a package, a folder under a module declared in go.mod. A test file sees its
// own package's files without importing them.
const GO_IMPORT = /^\s*import\s+(?:[\w.]+\s+)?"([^"]+)"|^\s*import\s*\(([^)]*)\)/gm;
const GO: Language = {
  source: /\.go$/,
  scan: (text) => ["=dir", ...groups(text, GO_IMPORT).flatMap((m) => (m[1] ? [m[1]] : groups(m[2] ?? "", /"([^"]+)"/g).map((q) => q[1] ?? "")))],
  resolve(from, spec, repo) {
    if (spec === "=dir") return isTestFile(from) ? sourcesIn(repo, posix.dirname(from), GO.source) : [];
    const mod = repo.manifests.go.find((m) => spec === m.module || spec.startsWith(`${m.module}/`));
    return mod ? sourcesIn(repo, posix.join(mod.dir, spec.slice(mod.module.length + 1)), GO.source) : [];
  },
};

// Rust: `mod x;` is a child module file; `use crate::a::b` and `use other_crate::a` walk modules.
const RS_ITEM = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:mod\s+(\w+)\s*;|use\s+([\w:]+))/gm;
const RS_ROOTS = ["mod.rs", "lib.rs", "main.rs"];
const rsChildren = (file: string) => (RS_ROOTS.includes(posix.basename(file)) ? posix.dirname(file) : file.replace(/\.rs$/, ""));

function rsModule(repo: Repo, dir: string, parts: string[]): string[] {
  for (let n = parts.length; n > 0; n -= 1) {
    const base = posix.join(dir, ...parts.slice(0, n));
    const hit = exists(repo, [`${base}.rs`, `${base}/mod.rs`]);
    if (hit.length) return hit;
  }
  return exists(repo, [posix.join(dir, "lib.rs"), posix.join(dir, "main.rs")]);
}

/** The `src` folder of the crate a file belongs to. */
function crateSrc(repo: Repo, from: string): string | null {
  for (let dir = posix.dirname(from); ; dir = posix.dirname(dir)) {
    const src = posix.join(dir, "src");
    if (exists(repo, [`${src}/lib.rs`, `${src}/main.rs`]).length) return src;
    if (dir === "." || dir === "/") return null;
  }
}

const RUST: Language = {
  source: /\.rs$/,
  scan: (text) => groups(text, RS_ITEM).map((m) => (m[1] ? `mod:${m[1]}` : (m[2] ?? "").replace(/:+$/, ""))),
  resolve(from, spec, repo) {
    if (spec.startsWith("mod:")) return exists(repo, [`${rsChildren(from)}/${spec.slice("mod:".length)}.rs`, `${rsChildren(from)}/${spec.slice("mod:".length)}/mod.rs`]);
    const [head = "", ...parts] = spec.split("::");
    if (head === "self") return rsModule(repo, rsChildren(from), parts);
    if (head === "super") {
      const ups = spec.split("::").findIndex((p) => p !== "super");
      return rsModule(repo, Array.from({ length: ups }).reduce<string>((dir) => posix.dirname(dir), rsChildren(from)), parts.slice(ups - 1));
    }
    const src = head === "crate" ? crateSrc(repo, from) : (repo.manifests.crates.find((c) => c.name === head)?.src ?? null);
    return src ? rsModule(repo, src, parts) : [];
  },
};

// PHP: `use App\Models\User;` through composer.json's PSR-4 map, `require __DIR__ . '/x.php'`.
const PHP_IMPORT = /^\s*use\s+(?:function\s+|const\s+)?\\?([\w\\]+)(?:\s*\{([^}]*)\})?|\b(?:require|include)(?:_once)?\s*\(?\s*(?:__DIR__\s*\.\s*)?['"]([^'"]+\.php)['"]|^\s*namespace\s+([\w\\]+)\s*[;{]/gm;

function phpScan(text: string): string[] {
  return groups(text, PHP_IMPORT).flatMap((m) => {
    if (m[4]) return [`=ns:${m[4]}`];
    if (m[3]) return [`file:${m[3]}`];
    const grouped = m[2]?.split(",").map((n) => n.trim().split(/\s+as\s+/i)[0] ?? "").filter(Boolean);
    return grouped ? grouped.map((n) => `${m[1] ?? ""}${n}`) : [m[1] ?? ""];
  }).concat(names(text));
}

function phpResolve(from: string, spec: string, repo: Repo): string[] {
  if (spec.startsWith("ref:")) return sibling(from, spec, repo);
  if (spec.startsWith("=ns:")) return ownSpace(from, spec, repo);
  if (spec.startsWith("file:")) return exists(repo, [posix.normalize(posix.join(posix.dirname(from), spec.slice("file:".length).replace(/^\//, "")))]);
  const rule = repo.manifests.psr4.filter((r) => spec.startsWith(r.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
  const mapped = rule ? exists(repo, [posix.join(rule.dir, `${spec.slice(rule.prefix.length).replace(/\\/g, "/")}.php`)]) : [];
  return mapped.length ? mapped : bySuffix(repo, spec.split("\\"), ".php");
}

// Java and Kotlin: `import com.acme.Billing` names a class of a package; a test sees its own
// package without importing it.
const JVM_IMPORT = /^\s*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)|^\s*package\s+([\w.]+)/gm;
const JVM_EXT = /\.(?:java|kt|kts)$/;

function jvmResolve(from: string, spec: string, repo: Repo): string[] {
  if (spec.startsWith("=pkg:")) return ownSpace(from, spec, repo);
  if (spec.startsWith("ref:")) return sibling(from, spec, repo);
  const parts = spec.replace(/\.\*$/, "").split(".");
  if (spec.endsWith(".*")) return declaredBy(repo, `=pkg:${parts.join(".")}`);
  for (let n = parts.length; n >= 2; n -= 1) {
    const hits = declaredBy(repo, `=pkg:${parts.slice(0, n - 1).join(".")}`).filter((f) => stem(f) === parts[n - 1]);
    if (hits.length) return hits;
  }
  return declaredBy(repo, `=pkg:${parts.slice(0, -1).join(".")}`);
}

const JVM: Language = {
  source: JVM_EXT,
  scan: (text) => groups(text, JVM_IMPORT).map((m) => (m[2] ? `=pkg:${m[2]}` : (m[1] ?? ""))).concat(names(text)),
  resolve: jvmResolve,
};

// C#: `using Acme.Billing;` brings in a namespace, which any number of files declare.
const CS_IMPORT = /^\s*(?:global\s+)?using\s+(?:static\s+)?(?:\w+\s*=\s*)?([\w.]+)\s*;|^\s*namespace\s+([\w.]+)/gm;
const CSHARP: Language = {
  source: /\.cs$/,
  scan: (text) => groups(text, CS_IMPORT).map((m) => (m[2] ? `=ns:${m[2]}` : (m[1] ?? ""))).concat(names(text)),
  resolve(from, spec, repo) {
    if (spec.startsWith("=ns:")) return ownSpace(from, spec, repo);
    if (spec.startsWith("ref:")) return sibling(from, spec, repo);
    const whole = declaredBy(repo, `=ns:${spec}`);
    if (whole.length) return whole;
    const dot = spec.lastIndexOf(".");
    return declaredBy(repo, `=ns:${spec.slice(0, dot)}`).filter((f) => stem(f) === spec.slice(dot + 1));
  },
};

// Ruby: `require_relative "x"` next to the file, `require "acme/billing"` from lib/ or app/.
const RB_IMPORT = /^\s*(require_relative|require|load)\s*\(?\s*['"]([^'"]+)['"]/gm;
const rb = (path: string) => (path.endsWith(".rb") ? path : `${path}.rb`);
const RUBY: Language = {
  source: /\.rb$/,
  scan: (text) => groups(text, RB_IMPORT).map((m) => (m[1] === "require_relative" ? `rel:${m[2] ?? ""}` : (m[2] ?? ""))),
  resolve(from, spec, repo) {
    if (spec.startsWith("rel:")) return exists(repo, [posix.normalize(posix.join(posix.dirname(from), rb(spec.slice("rel:".length))))]);
    const found = exists(repo, [`lib/${rb(spec)}`, `app/${rb(spec)}`, rb(spec)]);
    return found.length ? found : bySuffix(repo, spec.replace(/\.rb$/, "").split("/"), ".rb");
  },
};

// Swift: `import Billing` and `@testable import Billing` name a SwiftPM target, Sources/Billing/.
const SWIFT_IMPORT = /^\s*(?:@testable\s+)?import\s+(?:(?:class|struct|enum|protocol|func|var|let|typealias)\s+)?(\w+)/gm;
const SWIFT: Language = {
  source: /\.swift$/,
  scan: (text) => groups(text, SWIFT_IMPORT).map((m) => m[1] ?? ""),
  resolve(_from, spec, repo) {
    const key = `swift:${spec}`;
    const known = repo.memo.get(key);
    if (known) return known;
    const found = [...repo.files].filter((f) => f.endsWith(".swift") && (f.startsWith(`Sources/${spec}/`) || f.includes(`/Sources/${spec}/`)));
    repo.memo.set(key, found);
    return found;
  },
};

const LANGUAGES: readonly Language[] = [GO, RUST, { source: /\.php$/, scan: phpScan, resolve: phpResolve }, JVM, CSHARP, RUBY, SWIFT];

/** The language rules for a file, or undefined for JavaScript, TypeScript, Python and the rest. */
export function languageOf(path: string): Language | undefined {
  return LANGUAGES.find((l) => l.source.test(path));
}
