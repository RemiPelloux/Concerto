import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionLog } from "#src/engine/session-log.js";
import { gitEnv } from "#src/runner/env.js";
import { Store } from "#src/state/store.js";
import { savingsLabel } from "#src/ui/CostBar.js";
import { meter } from "#src/ui/meter.js";
import { expectOwnerOnly, tempDir } from "#tests/fixtures.js";

describe("meter", () => {
  it("never draws a negative or oversized bar, whatever the numbers", () => {
    expect(meter(53, 44, 44)).toEqual({ filled: 44, empty: 0 });
    expect(meter(1.17, 0.76, 44)).toEqual({ filled: 44, empty: 0 });
    expect(meter(-3, 10, 44)).toEqual({ filled: 0, empty: 44 });
    expect(meter(5, 0, 44)).toEqual({ filled: 0, empty: 44 });
    expect(meter(Number.NaN, 10, 44)).toEqual({ filled: 0, empty: 44 });
    expect(meter(5, 10, 44)).toEqual({ filled: 22, empty: 22 });
  });

  it("says cheaper or more, honestly", () => {
    expect(savingsLabel(1.17, 0.76)).toBe("1.5x cheaper");
    expect(savingsLabel(0.76, 1.17)).toBe("1.5x more");
    expect(savingsLabel(0, 0)).toBe("");
  });
});

describe("session log", () => {
  it("writes an owner-only log with every phase, entry, agent line and error", () => {
    const cwd = tempDir();
    const log = new SessionLog(cwd);
    const store = new Store((kind, text) => log.write(kind, text));
    store.update(() => ({ phase: "scoring" }));
    store.log({ role: "scorer", label: "Score", detail: "plan", result: "3 pts" });
    store.agentStart({ id: "soloist:a", role: "soloist", model: "x/m", label: "story a" });
    store.agentLines("soloist:a", ["▸ bash npm test"]);
    store.agentEnd("soloist:a", "failed");
    log.error(new Error("Invalid count value: -9"), "crash");
    const text = readFileSync(log.path, "utf8");
    expect(log.id).toMatch(/^s-[0-9a-z]+-[0-9a-f]{4}$/);
    expect(log.shownPath).toBe(join(".concerto", "logs", `${log.id}.log`));
    expect(text).toMatch(/\[phase\] scoring/);
    expect(text).toMatch(/\[log scorer\] Score: plan -> 3 pts/);
    expect(text).toMatch(/\[agent soloist:a\] start · x\/m · story a/);
    expect(text).toMatch(/\[agent soloist:a\] ▸ bash npm test/);
    expect(text).toMatch(/\[error crash\] Invalid count value: -9\nError: Invalid count value: -9\n {4}at /);
    expectOwnerOnly(log.path);
  });

  it("keeps Concerto's state out of commits through the local git exclude", () => {
    const cwd = tempDir();
    execFileSync("git", ["init", "-q"], { cwd, env: gitEnv() });
    new SessionLog(cwd);
    new SessionLog(cwd);
    const exclude = readFileSync(join(cwd, ".git", "info", "exclude"), "utf8");
    expect(exclude.split("\n").filter((l) => l === ".concerto/")).toHaveLength(1);
  });
});
