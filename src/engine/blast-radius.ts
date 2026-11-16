import { mkdirSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ImportGraph } from "#src/engine/import-graph.js";
import { ParseCache } from "#src/engine/parse-cache.js";
import { buildRepoMap } from "#src/engine/repo-map.js";

const CONFIG_FILES = ["package.json", "tsconfig.json", "smarttest.config.ts", "smarttest.config.js", ".smarttest.json"];
const CACHE_DIR_MODE = 0o700;
const IGNORED = new Set([".git", "node_modules", ".concerto", ".smarttest", "dist", "build"]);

type Snapshot = {
  files: readonly string[];
  graph: ImportGraph;
  explained: Map<string, string[]>;
  perFile: Map<string, string[]>;
};

function stamp(path: string): string {
  try {
    const stat = statSync(path, { bigint: true });
    return `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  } catch {
    return "missing";
  }
}

function watchedPaths(files: readonly string[]): string[] {
  const paths = new Set([...files, ...CONFIG_FILES, ".", "node_modules/.bin/smarttest"]);
  for (const file of files) {
    for (let dir = dirname(file); dir !== "."; dir = dirname(dir)) paths.add(dir);
  }
  return [...paths];
}

/** Non-Git repositories still need additions and deletions to invalidate their file list. */
async function listFiles(cwd: string, dir = ""): Promise<string[]> {
  const entries = await readdir(join(cwd, dir), { withFileTypes: true });
  const groups = await Promise.all(entries.filter((e) => !IGNORED.has(e.name)).map(async (entry) => {
    // Repository paths use "/" on every system, as git prints them.
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    return entry.isDirectory() ? listFiles(cwd, path) : [path];
  }));
  return groups.flat();
}

/** Owned by one concert, never shared between runs. Metadata checks do not reread sources. */
export class BlastRadius {
  private snapshot: Snapshot | undefined;
  private stamps = new Map<string, string>();

  constructor(private readonly cwd: string, private files: readonly string[]) {
    // The parse cache lives under .concerto/; creating it later would change the folder's
    // modification time and read as a repository change.
    mkdirSync(join(cwd, ".concerto", "cache"), { recursive: true, mode: CACHE_DIR_MODE });
    this.remember();
  }

  private remember(): void {
    this.stamps = new Map(watchedPaths(this.files).map((path) => [path, stamp(join(this.cwd, path))]));
  }

  private async watchDirectories(dir = "."): Promise<void> {
    const entries = await readdir(join(this.cwd, dir), { withFileTypes: true });
    if (!this.stamps.has(dir)) this.stamps.set(dir, stamp(join(this.cwd, dir)));
    await Promise.all(entries.filter((entry) => entry.isDirectory() && !IGNORED.has(entry.name))
      .map((entry) => this.watchDirectories(join(dir, entry.name))));
  }

  async get(): Promise<Snapshot> {
    const changed = [...this.stamps].some(([path, previous]) => stamp(join(this.cwd, path)) !== previous);
    if (changed) {
      const repo = await buildRepoMap(this.cwd);
      this.files = repo.key === "no-git" ? await listFiles(this.cwd) : repo.files;
      this.snapshot = undefined;
      this.remember();
    }
    if (!this.snapshot) await this.watchDirectories();
    this.snapshot ??= { files: this.files, graph: new ImportGraph(this.cwd, this.files, ParseCache.for(this.cwd)), explained: new Map(), perFile: new Map() };
    return this.snapshot;
  }
}
