import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { packageManager } from "#src/engine/checks.js";

const NPM_PLACEHOLDER = /no test specified/;
const MANIFESTS = ["package.json", "Cargo.toml", "go.mod"];

function read(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** The nearest folder under the repository root holding a package manifest; null at the root. */
function packageDir(cwd: string, file: string): string | null {
  for (let dir = posix.dirname(file); dir !== "." && dir !== "/"; dir = posix.dirname(dir)) {
    if (MANIFESTS.some((m) => existsSync(join(cwd, dir, m)))) return dir;
  }
  return null;
}

function nodeTest(cwd: string, dir: string): string | null {
  const manifest = (() => {
    try {
      return JSON.parse(read(join(cwd, dir, "package.json"))) as { name?: string; scripts?: { test?: string } };
    } catch {
      return {};
    }
  })();
  const test = manifest.scripts?.test;
  if (!manifest.name || !test || NPM_PLACEHOLDER.test(test)) return null;
  const commands: Record<string, string> = { pnpm: `pnpm --filter ${manifest.name} test`, yarn: `yarn workspace ${manifest.name} test`, bun: `bun run --filter ${manifest.name} test`, npm: `npm test --workspace ${dir}` };
  return commands[packageManager(cwd)] ?? null;
}

function rustTest(cwd: string, dir: string): string | null {
  const name = /\[package\][^[]*?^\s*name\s*=\s*"([^"]+)"/m.exec(read(join(cwd, dir, "Cargo.toml")))?.[1];
  return name ? `cargo test -p ${name}` : null;
}

/**
 * In a monorepo, the test command of the one package all of a story's files sit in: that
 * package's tests rather than the whole repository's. Null when the files span packages or the
 * root, or the package has no tests of its own.
 */
export function packageTest(cwd: string, files: readonly string[]): string | null {
  const dirs = new Set(files.map((f) => packageDir(cwd, f)));
  const [dir] = [...dirs];
  if (dirs.size !== 1 || !dir) return null;
  if (existsSync(join(cwd, dir, "package.json"))) return nodeTest(cwd, dir);
  if (existsSync(join(cwd, dir, "Cargo.toml"))) return rustTest(cwd, dir);
  return `go -C ${dir} test ./...`;
}
