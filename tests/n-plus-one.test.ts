import { execFile } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { readChanges } from "#src/engine/changes.js";
import { analyzeImpact } from "#src/engine/impact.js";
import { childEnv, gitEnv } from "#src/runner/env.js";
import { createFixture, enableSmarttest } from "#scripts/perf-fixture.js";

const run = promisify(execFile);
const TAB_NAME = "tab\tname.txt";
/** Windows forbids tabs in file names, so that case only exists on Linux and macOS. */
const TAB_NAMES = process.platform === "win32" ? [] : [TAB_NAME];

describe("batched subprocess behavior", () => {
  it("matches Git counts for text, empty, binary and symlink files", async () => {
    const fixture = await createFixture();
    const files = ["plain.txt", "no-newline.txt", "empty.txt", "binary.bin", "late-null.txt", ...TAB_NAMES, "link", "force-binary.txt", "force-text.bin", "driver.txt"];
    try {
      writeFileSync(join(fixture.cwd, files[0]!), "one\ntwo\n");
      writeFileSync(join(fixture.cwd, files[1]!), "one\ntwo");
      writeFileSync(join(fixture.cwd, files[2]!), "");
      writeFileSync(join(fixture.cwd, files[3]!), Buffer.from([0, 10, 10]));
      writeFileSync(join(fixture.cwd, files[4]!), `${"x".repeat(8000)}\0\n`);
      TAB_NAMES.forEach((name) => writeFileSync(join(fixture.cwd, name), "one\n"));
      symlinkSync("plain.txt", join(fixture.cwd, "link"));
      writeFileSync(join(fixture.cwd, ".gitattributes"), "force-binary.txt binary\nforce-text.bin diff\ndriver.txt diff=custom\n");
      writeFileSync(join(fixture.cwd, "force-binary.txt"), "one\ntwo\n");
      writeFileSync(join(fixture.cwd, "force-text.bin"), Buffer.from([0, 10, 10]));
      writeFileSync(join(fixture.cwd, "driver.txt"), "one\ntwo\n");
      await run("git", ["config", "diff.custom.binary", "true"], { cwd: fixture.cwd, env: gitEnv() });
      const changes = await readChanges(fixture.cwd);
      for (const file of files) {
        const { stdout } = await run("git", ["diff", "--no-index", "--numstat", "/dev/null", file], { cwd: fixture.cwd, env: gitEnv() })
          .catch((error: { stdout: string }) => ({ stdout: error.stdout }));
        expect(changes.find((change) => change.file === file)).toEqual({ file, added: Number(stdout.split("\t")[0]) || 0, removed: 0, status: "added" });
      }
    } finally { fixture.cleanup(); }
  });

  it("preserves per-file coverage across an individual third-party explain failure", async () => {
    const fixture = await createFixture();
    try {
      const stub = join(fixture.cwd, "node_modules/@tkmremi/smarttest");
      mkdirSync(stub, { recursive: true });
      mkdirSync(join(fixture.cwd, "node_modules/.bin"), { recursive: true });
      writeFileSync(join(stub, "bin.js"), "");
      symlinkSync(join(stub, "bin.js"), join(fixture.cwd, "node_modules/.bin/smarttest"));
      writeFileSync(join(stub, "package.json"), JSON.stringify({ name: "@tkmremi/smarttest", type: "module", exports: "./index.js" }));
      writeFileSync(join(stub, "index.js"), `
        export async function main(args) {
          const file = args[1];
          if (file.includes("missing")) throw new Error("unknown file");
          await new Promise(resolve => setTimeout(resolve, file.includes("module-1") ? 20 : 0));
          const tests = file.includes("module-0") ? ["tests/zero.test.ts", "tests/one.test.ts"] : ["tests/one.test.ts"];
          process.stdout.write(JSON.stringify({ target: file, tests: tests.map(test => ({test})) }, null, 2) + "\\n");
          return 0;
        }
      `);
      const files = ["src/module-1.ts", "src/module-2.ts", "src/module-3.ts", "src/module-4.ts", "src/missing.ts",
        "src/module-5.ts", "src/module-6.ts", "src/module-7.ts", "src/module-0.ts"];
      const input = { cwd: fixture.cwd, repoFiles: [...files, "tests/zero.test.ts", "tests/one.test.ts"],
        stories: files.map((file) => ({ id: file, files: [file] })) };
      const impacts = await analyzeImpact(input);
      expect(impacts.get("src/module-1.ts")).toMatchObject({ tests: ["tests/one.test.ts"], untested: 0 });
      expect(impacts.get("src/module-0.ts")).toMatchObject({ tests: ["tests/zero.test.ts", "tests/one.test.ts"], untested: 0 });
      expect(impacts.get("src/missing.ts")).toMatchObject({ tests: [], untested: 1, source: "smarttest" });
    } finally { fixture.cleanup(); }
  });

  it("matches the installed SmartTest CLI on the benchmark fixture", async () => {
    const fixture = await createFixture();
    try {
      enableSmarttest(fixture.cwd);
      mkdirSync(join(fixture.cwd, "tests"));
      writeFileSync(join(fixture.cwd, "tests/zero.test.ts"), 'import "../src/module-0.js";');
      writeFileSync(join(fixture.cwd, "tests/one.test.ts"), 'import "../src/module-1.js";');
      const files = ["src/module-0.ts", "src/module-1.ts"];
      const impacts = await analyzeImpact({ cwd: fixture.cwd, repoFiles: [...files, "tests/zero.test.ts", "tests/one.test.ts"],
        stories: files.map((file) => ({ id: file, files: [file] })) });
      for (const file of files) {
        // Through node, as Concerto runs it: a .js symlink is not something Windows can start.
        const { stdout } = await run(process.execPath, [join(fixture.cwd, "node_modules/.bin/smarttest"), "explain", file, "--json"], { cwd: fixture.cwd, env: childEnv() });
        const expected = JSON.parse(stdout).tests.map((test: { test: string }) => test.test);
        expect(expected.length).toBeGreaterThan(0);
        expect(impacts.get(file)?.tests).toEqual(expected);
      }
    } finally { fixture.cleanup(); }
  });
});
