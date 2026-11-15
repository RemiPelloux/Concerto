import { spawnSync } from "node:child_process";
import { chmodSync, closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HOOK = `
import { registerHooks } from 'node:module';
import { writeFileSync } from 'node:fs';
const loaded = new Set();
registerHooks({ load(url, context, nextLoad) {
  loaded.add(url);
  return nextLoad(url, context);
} });
process.on('exit', () => writeFileSync(process.env.STARTUP_MODULES, JSON.stringify([...loaded])));
`;

function command(args: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "concerto-startup-test-"));
  const fd = openSync(join(dir, "output"), "w");
  try {
    writeFileSync(join(dir, "hooks.mjs"), HOOK);
    const backend = join(dir, "claude");
    writeFileSync(backend, `#!${process.execPath}\nprocess.stdin.resume(); process.stdin.on("end", () => { process.stdout.write(JSON.stringify({type: "result", result: "invalid plan"}) + "\\n"); });\n`);
    chmodSync(backend, 0o700);
    const result = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--import", join(dir, "hooks.mjs"),
      "--conditions=source", resolve("src/cli.ts"), ...args], {
      cwd: dir, timeout: 10_000, stdio: ["ignore", fd, fd],
      env: { ...process.env, PATH: dir, CONCERTO_CONFIG: resolve("concerto.config.json"),
        CONCERTO_CLAUDE_BIN: backend, CONCERTO_CODEX_BIN: "missing-codex", CONCERTO_PI_BIN: "missing-pi",
        PI_AGENT_DIR: dir, XDG_CONFIG_HOME: dir, XDG_CACHE_HOME: dir, STARTUP_MODULES: join(dir, "modules.json") },
    });
    if (result.error) throw result.error;
    return { status: result.status, output: readFileSync(join(dir, "output"), "utf8"),
      modules: JSON.parse(readFileSync(join(dir, "modules.json"), "utf8")) as string[] };
  } finally {
    closeSync(fd);
    rmSync(dir, { recursive: true, force: true });
  }
}

const BACKEND = /\/runner\/(?:index|claude|codex|pi)\.ts/;
const UI = /\/(?:src\/ui|node_modules\/(?:ink|react))\//;

describe("CLI startup imports", () => {
  it.each(["--help", "--doctor", "--models", "--clear-cache"])("keeps %s free of UI and backend modules", (flag) => {
    const result = command([flag]);
    expect(result.status, result.output).toBe(0);
    expect(result.output).not.toBe("");
    expect(result.modules.filter((url) => BACKEND.test(url) || UI.test(url))).toEqual([]);
  });

  it("rejects a missing request before loading the runner", () => {
    const result = command(["--plan"]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("need a request");
    expect(result.modules.filter((url) => BACKEND.test(url) || UI.test(url))).toEqual([]);
  });

  it.each(["--plan", "--run"])("loads the runner for %s and rejects an invalid scorer plan", (flag) => {
    const result = command([flag, "Add a health endpoint"]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("The scorer did not return a JSON plan.");
    expect(result.modules.some((url) => /\/runner\/index\.ts/.test(url))).toBe(true);
    expect(result.modules.some((url) => UI.test(url))).toBe(false);
  });
});
