import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { childEnv } from "#src/runner/env.js";

const OUTPUT_TAIL = 4000;
const NPM_PLACEHOLDER = /no test specified/;

export type CheckName = "test" | "typecheck" | "lint" | "acceptance";
export type Check = { name: CheckName; command: string };
export type CheckResult = Check & { ok: boolean; ms: number; output: string; flaky?: boolean };
/** A command, `false` to turn the check off, or absent to let Concerto detect it. */
export type CheckSettings = { test?: string | false; typecheck?: string | false; lint?: string | false };

const has = (cwd: string, file: string) => existsSync(join(cwd, file));

function packageScripts(cwd: string): Record<string, string> {
  try {
    return (JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as { scripts?: Record<string, string> }).scripts ?? {};
  } catch {
    return {};
  }
}

function packageManager(cwd: string): string {
  if (has(cwd, "pnpm-lock.yaml")) return "pnpm";
  if (has(cwd, "yarn.lock")) return "yarn";
  if (has(cwd, "bun.lockb") || has(cwd, "bun.lock")) return "bun";
  return "npm";
}

function smarttest(cwd: string): string | null {
  const configured = readdirSync(cwd).some((f) => f.startsWith("smarttest.config."));
  if (!configured || !has(cwd, join("node_modules", ".bin", "smarttest"))) return null;
  return `${packageManager(cwd) === "npm" ? "npx" : `${packageManager(cwd)} exec`} smarttest run --affected`;
}

function pythonTests(cwd: string): string | null {
  const pyproject = has(cwd, "pyproject.toml") ? readFileSync(join(cwd, "pyproject.toml"), "utf8") : "";
  return /pytest/.test(pyproject) || has(cwd, "pytest.ini") || has(cwd, "conftest.py") ? "python -m pytest -q" : null;
}

function jvmTests(cwd: string): string | null {
  if (has(cwd, "pom.xml")) return "mvn -q test";
  if (!has(cwd, "build.gradle") && !has(cwd, "build.gradle.kts")) return null;
  if (!has(cwd, "gradlew")) return "gradle test";
  return process.platform === "win32" ? "gradlew.bat test" : "./gradlew test";
}

/** The project's test command, from what the repository holds; null when nothing is recognised. */
export function detectTest(cwd: string): string | null {
  const script = packageScripts(cwd).test;
  const node = script && !NPM_PLACEHOLDER.test(script) ? `${packageManager(cwd)} test` : null;
  const php = has(cwd, "composer.json") && (has(cwd, "phpunit.xml") || has(cwd, "phpunit.xml.dist")) ? "vendor/bin/phpunit" : null;
  const go = has(cwd, "go.mod") ? "go test ./..." : null;
  const rust = has(cwd, "Cargo.toml") ? "cargo test" : null;
  return smarttest(cwd) ?? node ?? pythonTests(cwd) ?? go ?? rust ?? php ?? jvmTests(cwd);
}

function pick(name: Exclude<CheckName, "acceptance">, setting: string | false | undefined, detected: string | null): Check[] {
  if (setting === false) return [];
  const command = setting ?? detected;
  return command ? [{ name, command }] : [];
}

/** The checks every story must pass before review: the test command first, then type check and lint. */
export function detectChecks(cwd: string, settings: CheckSettings = {}): Check[] {
  const scripts = packageScripts(cwd);
  const run = (script: string) => (scripts[script] ? `${packageManager(cwd)} run ${script}` : null);
  return [
    ...pick("test", settings.test, detectTest(cwd)),
    ...pick("typecheck", settings.typecheck, run("typecheck")),
    ...pick("lint", settings.lint, run("lint")),
  ];
}

export type RunOptions = { cwd: string; timeoutMs: number; signal?: AbortSignal };

/** Runs one check through the shell; output is kept to its tail, which is where failures are. */
export function runCheck(check: Check, opts: RunOptions): Promise<CheckResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(check.command, { cwd: opts.cwd, env: childEnv(), shell: true, timeout: opts.timeoutMs, signal: opts.signal, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const keep = (chunk: Buffer) => (output = (output + chunk.toString()).slice(-OUTPUT_TAIL));
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", (error) => resolve({ ...check, ok: false, ms: Date.now() - started, output: `${output}\n${error.message}` }));
    child.on("close", (code) => resolve({ ...check, ok: code === 0, ms: Date.now() - started, output }));
  });
}

/**
 * Runs the checks in order and stops at the first that fails. A failing test command runs once
 * more: passing then means a flaky test, which is reported but does not fail the story.
 */
export async function runGate(checks: Check[], opts: RunOptions): Promise<{ ok: boolean; results: CheckResult[] }> {
  const results: CheckResult[] = [];
  for (const check of checks) {
    let result = await runCheck(check, opts);
    if (!result.ok && check.name === "test" && !opts.signal?.aborted) {
      const again = await runCheck(check, opts);
      result = again.ok ? { ...again, flaky: true } : again;
    }
    results.push(result);
    if (!result.ok) return { ok: false, results };
  }
  return { ok: true, results };
}
