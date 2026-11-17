import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkBudgets, startup, startupModules, workCounts } from "#scripts/perf-budgets.js";
import { tempDir } from "#tests/fixtures.js";

afterEach(() => vi.restoreAllMocks());

describe("performance budget enforcement", () => {
  it("accepts equality and zero count budgets", () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    expect(checkBudgets({ timing: 20, heavy: 0 }, { _about: "metadata", timing: 20, heavy: 0 })).toBe(0);
  });

  it.each(["timing", "git", "modules", "runner"])("rejects a regression in %s", (name) => {
    const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    expect(checkBudgets({ [name]: 2 }, { [name]: 1 })).toBe(1);
    expect(output).toHaveBeenCalledWith(expect.stringContaining(`OVER ${name}`));
  });

  it("fails closed for missing measurements and missing or invalid budgets", () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    expect(checkBudgets({ timing: 1 }, {})).toBe(1);
    expect(checkBudgets({}, { timing: 1 })).toBe(1);
    for (const value of [NaN, Infinity, -1, "20", undefined]) {
      expect(checkBudgets({ timing: 1 }, { timing: value })).toBe(1);
    }
    for (const value of [NaN, Infinity, -1]) expect(checkBudgets({ timing: value }, { timing: 20 })).toBe(1);
  });

  it("counts actual startup loads and rejects a heavy import", () => {
    const dir = tempDir();
    const cli = join(dir, "cli.mjs");
    writeFileSync(cli, "export {};\n");
    const light = startupModules(cli, "--help");
    expect(light).toEqual({ "startup --help modules": 1, "startup --help heavy modules": 0 });
    mkdirSync(join(dir, "orchestrator"));
    writeFileSync(join(dir, "orchestrator", "main.mjs"), "export {};\n");
    writeFileSync(cli, "import './orchestrator/main.mjs';\n");
    const heavy = startupModules(cli, "--help");
    expect(heavy).toEqual({ "startup --help modules": 2, "startup --help heavy modules": 1 });
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    expect(checkBudgets(heavy, { "startup --help modules": 2, "startup --help heavy modules": 0 })).toBe(1);
  });

  it("checks the exit status of timed startup processes", () => {
    const cli = join(tempDir(), "cli.mjs");
    writeFileSync(cli, "process.exitCode = 1;\n");
    expect(() => startup(cli, "--help")).toThrow(/--help exited 1/);
    writeFileSync(cli, "export {};\n");
    const elapsed = startup(cli, "--help");
    expect(Number.isFinite(elapsed)).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });

  it("rejects a failed startup module probe", () => {
    const cli = join(tempDir(), "cli.mjs");
    writeFileSync(cli, "process.exitCode = 1;\n");
    expect(() => startupModules(cli, "--help")).toThrow(/module probe exited 1/);
  });

  it("measures the real workingDiff and orchestration workloads and restores tracing", async () => {
    const previous = process.env.GIT_TRACE2_EVENT;
    expect(await workCounts()).toEqual({
      "workingDiff git processes": 26, "scoring runner calls": 1, "fan-out runner calls": 18,
    });
    expect(process.env.GIT_TRACE2_EVENT).toBe(previous);
  });
});
