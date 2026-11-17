import { spawnSync } from "node:child_process";
import { chmodSync, closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
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

const FAKE_CLAUDE = `process.stdin.resume(); process.stdin.on("end", () => { process.stdout.write(JSON.stringify({type: "result", result: "invalid plan"}) + "\\n"); });\n`;

/** A fake `claude` on PATH: a shebang script, or on Windows the .cmd shim npm would install. */
function fakeClaude(dir: string): string {
  const script = join(dir, "claude.js");
  writeFileSync(script, FAKE_CLAUDE);
  if (process.platform === "win32") {
    writeFileSync(join(dir, "claude.cmd"), `@"${process.execPath}" "${script}" %*\r\n`);
    return join(dir, "claude.cmd");
  }
  writeFileSync(join(dir, "claude"), `#!${process.execPath}\n${FAKE_CLAUDE}`);
  chmodSync(join(dir, "claude"), 0o700);
  return join(dir, "claude");
}

/** Our environment without PATH under any spelling (Windows also has Path), so PATH below wins. */
function baseEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH"));
}

function command(args: string[], extra: NodeJS.ProcessEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), "concerto-startup-test-"));
  const fd = openSync(join(dir, "output"), "w");
  try {
    writeFileSync(join(dir, "hooks.mjs"), HOOK);
    const backend = fakeClaude(dir);
    const result = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--import", pathToFileURL(join(dir, "hooks.mjs")).href,
      "--conditions=source", resolve("src/cli.ts"), ...args], {
      cwd: dir, timeout: 10_000, stdio: ["ignore", fd, fd],
      env: { ...baseEnv(), PATH: dir, CONCERTO_CONFIG: resolve("concerto.config.json"),
        CONCERTO_CLAUDE_BIN: backend, CONCERTO_CODEX_BIN: "missing-codex", CONCERTO_PI_BIN: "missing-pi",
        PI_AGENT_DIR: dir, XDG_CONFIG_HOME: dir, XDG_CACHE_HOME: dir, STARTUP_MODULES: join(dir, "modules.json"), ...extra },
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
const COMMAND = /\/src\/(?:main\.ts|orchestrator\/)/;

describe("CLI startup imports", () => {
  it.each(["--help", "-h", "--version", "-v"])("handles %s without loading command modules", (flag) => {
    const result = command([flag]);
    expect(result.status, result.output).toBe(0);
    const version = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { version: string };
    expect(result.output).toContain(flag === "--help" || flag === "-h" ? "concerto [options] [request]" : `concerto ${version.version}`);
    expect(result.modules.filter((url) => COMMAND.test(url) || BACKEND.test(url) || UI.test(url))).toEqual([]);
  });

  it("rejects an unknown option without loading command modules", () => {
    const result = command(["--unknown-option"]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("Unknown option '--unknown-option'");
    expect(result.modules.filter((url) => COMMAND.test(url) || BACKEND.test(url) || UI.test(url))).toEqual([]);
  });

  it.each(["--help", "--doctor", "--models", "--clear-cache"])("keeps %s free of UI and backend modules", (flag) => {
    const result = command([flag]);
    expect(result.status, result.output).toBe(0);
    expect(result.output).not.toBe("");
    expect(result.modules.filter((url) => BACKEND.test(url) || UI.test(url))).toEqual([]);
  });

  it("--doctor reports instead of failing when no agent CLI is installed", () => {
    const result = command(["--doctor"], { CONCERTO_CLAUDE_BIN: "missing-claude" });
    expect(result.status, result.output).toBe(0);
    expect(result.output).toMatch(/conductor\s+nothing reachable/);
    expect(result.output).toContain("Install and log into at least one of: claude, codex, pi.");
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
