import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeImpact, impactBrief } from "../src/engine/impact.js";
import { PathMatcher, safePaths } from "../src/engine/paths.js";
import { areaOf, isSensitive } from "../src/engine/signals.js";
import { ImportGraph, isTestFile, resolveImport } from "../src/engine/import-graph.js";
import { tempDir } from "./fixtures.js";

const REPO: Record<string, string> = {
  "src/money.ts": "export const cents = (n: number) => Math.round(n * 100);",
  "src/invoice.ts": 'import { cents } from "./money.js";\nexport const total = (n: number) => cents(n);',
  "src/api/routes.ts": 'import { total } from "../invoice";\nexport const route = () => total(1);',
  "src/server.ts": 'const r = require("./api/routes");\nexport default r;',
  "src/lazy.tsx": 'export const load = () => import("./money");',
  "tests/invoice.test.ts": 'import { total } from "../src/invoice.js";\ntest("t", () => total(1));',
  "tests/routes.spec.ts": 'import { route } from "../src/api/routes";',
  "app/core/__init__.py": "",
  "app/core/db.py": "def connect(): pass",
  "app/service.py": "from app.core import db\nfrom .core.db import connect",
  "app/test_service.py": "import app.service",
  "README.md": "not code",
};

function repo(): string {
  const cwd = tempDir();
  Object.entries(REPO).forEach(([path, text]) => {
    mkdirSync(join(cwd, dirname(path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  });
  return cwd;
}

describe("import graph", () => {
  const files = new Set(Object.keys(REPO));

  it("resolves relative TS/JS imports, .js to .ts, index files, and Python modules", () => {
    expect(resolveImport("src/invoice.ts", "./money.js", files)).toBe("src/money.ts");
    expect(resolveImport("src/api/routes.ts", "../invoice", files)).toBe("src/invoice.ts");
    expect(resolveImport("app/service.py", "app.core", files)).toBe("app/core/__init__.py");
    expect(resolveImport("app/service.py", ".core.db", files)).toBe("app/core/db.py");
    expect(resolveImport("src/invoice.ts", "zod", files)).toBeNull();
  });

  it("finds every importer through several hops, across import, require and import()", () => {
    const graph = new ImportGraph(repo(), Object.keys(REPO));
    expect(graph.dependentsOf(["src/money.ts"]).sort()).toEqual(
      ["src/api/routes.ts", "src/invoice.ts", "src/lazy.tsx", "src/server.ts", "tests/invoice.test.ts", "tests/routes.spec.ts"].sort(),
    );
    expect(graph.dependentsOf(["src/money.ts"], 1).sort()).toEqual(["src/invoice.ts", "src/lazy.tsx"]);
    expect(graph.dependentsOf(["app/core/db.py"]).sort()).toEqual(["app/service.py", "app/test_service.py"]);
  });

  it("recognises test files in the usual layouts", () => {
    expect(["tests/a.ts", "src/a.test.ts", "src/__tests__/a.ts", "x.spec.jsx", "app/test_x.py", "app/x_test.py"].every(isTestFile)).toBe(true);
    expect(isTestFile("src/testing-utils.ts")).toBe(false);
  });
});

describe("impact", () => {
  it("keeps model paths inside the repository", () => {
    expect(safePaths(["./src/a.ts", "src/a.ts", "/etc/passwd", "../x", "src/../../y", " src/b.ts "])).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("matches a misremembered path to the real file, and keeps real new files new", () => {
    const matcher = new PathMatcher(new Set(["src/engine/condense.ts", "tests/engine.test.ts", "src/db.ts"]));
    expect(matcher.match("src/runner/condenser.ts")).toBe("src/engine/condense.ts");
    expect(matcher.match("src/engine/condense.ts")).toBe("src/engine/condense.ts");
    expect(matcher.match("tests/condenser.test.ts")).toBeNull();
    expect(matcher.match("src/dbx.ts")).toBeNull();
  });

  it("measures files, importers and covering tests per story, new files included", async () => {
    const cwd = repo();
    const impacts = await analyzeImpact({
      cwd,
      repoFiles: Object.keys(REPO),
      stories: [
        { id: "money", files: ["src/money.ts", "src/currency.ts"] },
        { id: "none", files: [] },
      ],
    });
    const money = impacts.get("money")!;
    expect(money).toMatchObject({ newFiles: 1, direct: 2, indirect: 2, sourceFiles: 2, untested: 1, lines: 1, areas: 1, source: "imports" });
    expect(money.tests.sort()).toEqual(["tests/invoice.test.ts", "tests/routes.spec.ts"]);
    expect(impacts.get("none")?.source).toBe("none");
    const docs = (await analyzeImpact({ cwd, repoFiles: Object.keys(REPO), stories: [{ id: "d", files: ["README.md"] }] })).get("d");
    expect(docs).toMatchObject({ sourceFiles: 0, untested: 0 });
    expect(impactBrief(money)).toMatch(/Imported directly by 2 files, indirectly by 2\.\nTests that cover them, run these first: tests\//);
    expect(impactBrief(money)).toContain("1 source files have no covering test");
  });
});

describe("signals", () => {
  it("flags code where mistakes cost more", () => {
    expect(["src/auth/session.ts", "db/migrations/001.sql", ".github/workflows/ci.yml", "src/payment-intent.ts", "Dockerfile"].every(isSensitive)).toBe(true);
    expect(["src/ui/Button.tsx", "src/authors.ts", "README.md"].some(isSensitive)).toBe(false);
  });

  it("groups files into areas two levels deep", () => {
    expect(["src/engine/impact.ts", "src/cli.tsx", "README.md", "packages/web/src/a.ts"].map(areaOf)).toEqual(["src/engine", "src", ".", "packages/web"]);
  });
});
