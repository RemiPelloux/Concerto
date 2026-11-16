import { readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import type { Alias } from "#src/engine/aliases.js";

const MAX_BYTES = 262_144;
const MAX_MANIFESTS = 500;

/** What the repository's build files say about where its modules live. */
export type Manifests = {
  /** go.mod: module path and its folder. */
  go: { dir: string; module: string }[];
  /** Cargo.toml: crate name (as `use` writes it) and its src folder. */
  crates: { name: string; src: string }[];
  /** composer.json autoload psr-4: namespace prefix and its folder. */
  psr4: { prefix: string; dir: string }[];
  /** package.json in workspace packages: `@acme/ui` and `@acme/ui/x` point at that package. */
  workspaces: Alias[];
};

function read(cwd: string, path: string): string {
  try {
    const full = join(cwd, path);
    return statSync(full).size > MAX_BYTES ? "" : readFileSync(full, "utf8");
  } catch {
    return "";
  }
}

function json(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const named = (files: readonly string[], name: string) => files.filter((f) => (f === name || f.endsWith(`/${name}`)) && !f.includes("node_modules/") && !f.includes("vendor/")).slice(0, MAX_MANIFESTS);
const dirOf = (file: string) => posix.dirname(file);

function goModules(cwd: string, files: readonly string[]): Manifests["go"] {
  return named(files, "go.mod").flatMap((f) => {
    const module = /^module\s+(\S+)/m.exec(read(cwd, f))?.[1];
    return module ? [{ dir: dirOf(f), module }] : [];
  });
}

function crates(cwd: string, files: readonly string[]): Manifests["crates"] {
  return named(files, "Cargo.toml").flatMap((f) => {
    const name = /\[package\][^[]*?^\s*name\s*=\s*"([^"]+)"/m.exec(read(cwd, f))?.[1];
    return name ? [{ name: name.replace(/-/g, "_"), src: posix.join(dirOf(f), "src") }] : [];
  });
}

function psr4(cwd: string, files: readonly string[]): Manifests["psr4"] {
  return named(files, "composer.json").flatMap((f) => {
    const manifest = json(read(cwd, f)) as { autoload?: { "psr-4"?: Record<string, string | string[]> }; "autoload-dev"?: { "psr-4"?: Record<string, string | string[]> } };
    const rules = { ...manifest.autoload?.["psr-4"], ...manifest["autoload-dev"]?.["psr-4"] };
    return Object.entries(rules).flatMap(([prefix, dirs]) => [dirs].flat().map((d) => ({ prefix, dir: posix.normalize(posix.join(dirOf(f), d)) })));
  });
}

/** Each workspace package by name, to its folder and to its src/, for imports that skip the build. */
function workspaces(cwd: string, files: readonly string[]): Alias[] {
  return named(files, "package.json").filter((f) => f !== "package.json").flatMap((f) => {
    const name = json(read(cwd, f)).name;
    if (typeof name !== "string") return [];
    return [{ prefix: `${name}/`, target: `${posix.join(dirOf(f), "src")}/` }, { prefix: `${name}/`, target: `${dirOf(f)}/` }];
  });
}

export function loadManifests(cwd: string, files: readonly string[]): Manifests {
  return { go: goModules(cwd, files), crates: crates(cwd, files), psr4: psr4(cwd, files), workspaces: workspaces(cwd, files) };
}
