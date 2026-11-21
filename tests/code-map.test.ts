import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { codeMap, saveCodeMap } from "#src/engine/code-map.js";
import { ImportGraph } from "#src/engine/import-graph.js";
import { tempDir } from "#tests/fixtures.js";

/** A small app: types.ts is imported everywhere, api.ts by the two handlers, the rest by nobody. */
const FILES: Record<string, string> = {
  "src/types.ts": "export type User = { id: string };\n",
  "src/db.ts": "import type { User } from './types.js';\nexport const db = new Map<string, User>();\n",
  "src/api.ts": "import { db } from './db.js';\nimport type { User } from './types.js';\nexport const get = (id: string): User | undefined => db.get(id);\n",
  "src/login.ts": "import { get } from './api.js';\nimport type { User } from './types.js';\nexport const login = (id: string) => get(id);\n",
  "src/logout.ts": "import { get } from './api.js';\nexport const logout = (id: string) => get(id);\n",
};

function repo(): { cwd: string; graph: ImportGraph } {
  const cwd = tempDir();
  for (const [file, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), text);
  }
  return { cwd, graph: new ImportGraph(cwd, Object.keys(FILES)) };
}

describe("the code map", () => {
  it("lists the most imported files first, with their size and how many import them", () => {
    const map = codeMap(repo().graph, []);
    const hubs = map.split("\n").filter((l) => l.startsWith("- "));
    expect(hubs[0]).toMatch(/^- src\/types\.ts · \d+ lines · imported by 3$/);
    // api.ts has two importers: no hub, left out rather than listed as noise.
    expect(hubs).toHaveLength(1);
  });

  it("traces each file the plan touches to the files that import it", () => {
    const map = codeMap(repo().graph, ["src/api.ts", "src/logout.ts"]);
    expect(map).toContain("- src/api.ts · imported by src/login.ts, src/logout.ts");
    expect(map).toContain("- src/logout.ts · imported by nothing");
  });

  it("is saved under .concerto, where agents and people can read it again", () => {
    const { cwd, graph } = repo();
    const path = saveCodeMap(cwd, codeMap(graph, ["src/api.ts"]));
    expect(path).toBe(join(cwd, ".concerto", "code-map.md"));
    expect(readFileSync(path, "utf8")).toContain("src/types.ts");
  });
});
