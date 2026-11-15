import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";

/** `#src/*` -> `src/*`: an import prefix and the repository folder it stands for. */
export type Alias = { prefix: string; target: string };

/** Conditions that point at source rather than build output, best first. */
const SOURCE_CONDITIONS = ["source", "development", "import", "node", "default"];

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** A subpath target: a string, or conditions whose source-like branch wins. */
function pickTarget(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return null;
  const conditions = value as Record<string, unknown>;
  const key = SOURCE_CONDITIONS.find((c) => typeof conditions[c] === "string");
  return key ? (conditions[key] as string) : null;
}

function wildcard(prefix: string, target: string): Alias | null {
  if (!prefix.endsWith("*") || !target.endsWith("*")) return null;
  return { prefix: prefix.slice(0, -1), target: posix.normalize(target.slice(0, -1)).replace(/^\.\//, "") };
}

/** `"imports": { "#src/*": { "source": "./src/*", "default": "./dist/*" } }` */
function packageImports(cwd: string): Alias[] {
  const imports = readJson(join(cwd, "package.json"))?.imports;
  if (typeof imports !== "object" || imports === null) return [];
  return Object.entries(imports).flatMap(([key, value]) => {
    const target = pickTarget(value);
    const alias = target ? wildcard(key, target) : null;
    return alias ? [alias] : [];
  });
}

/** `"compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } }` */
function tsconfigPaths(cwd: string): Alias[] {
  const options = readJson(join(cwd, "tsconfig.json"))?.compilerOptions as { baseUrl?: string; paths?: Record<string, string[]> } | undefined;
  const base = options?.baseUrl ?? ".";
  return Object.entries(options?.paths ?? {}).flatMap(([key, targets]) => {
    const alias = targets[0] ? wildcard(key, posix.join(base, targets[0])) : null;
    return alias ? [alias] : [];
  });
}

/** Every wildcard alias the repository declares, longest prefix first so the most specific wins. */
export function loadAliases(cwd: string): Alias[] {
  return [...packageImports(cwd), ...tsconfigPaths(cwd)].sort((a, b) => b.prefix.length - a.prefix.length);
}
