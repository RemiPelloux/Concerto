import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { gitEnv } from "#src/runner/env.js";
import { tempDir } from "#tests/fixtures.js";

/** The Action's script with `concerto` and `gh` stood in by scripts that record what they got. */
function runIssue(env: Record<string, string>, concertoOutput: string) {
  const bin = tempDir();
  const work = tempDir();
  spawnSync("git", ["init", "-q"], { cwd: work, env: gitEnv() });
  writeFileSync(join(bin, "concerto"), `#!/bin/sh\nfor a in "$@"; do printf '%s\\n---\\n' "$a"; done > "${bin}/concerto-args"\nprintf '%s\\n' '${concertoOutput}'\n`, { mode: 0o700 });
  writeFileSync(join(bin, "gh"), `#!/bin/sh\nprintf '%s ' "$@" > "${bin}/gh-args"\n`, { mode: 0o700 });
  const result = spawnSync("sh", [resolve("scripts/ci/run-issue.sh")], {
    cwd: work, encoding: "utf8",
    env: { PATH: `${bin}:${process.env.PATH ?? ""}`, HOME: work, EVENTS: join(bin, "events.jsonl"), GITHUB_OUTPUT: join(bin, "output"), ...env },
  });
  const read = (f: string) => (existsSync(join(bin, f)) ? readFileSync(join(bin, f), "utf8") : "");
  return { status: result.status, args: read("concerto-args").split("\n---\n").filter(Boolean), gh: read("gh-args"), output: read("output"), work };
}

const OPENED = '{"type":"done","phase":"done","stories":[]}\n{"type":"pr","url":"https://github.com/o/r/pull/7"}';

describe.skipIf(process.platform === "win32")("the GitHub Action's script", () => {
  it("builds the issue plus the comment's instructions, and links the pull request on the issue", () => {
    const run = runIssue({ TITLE: "Add a dark mode", BODY: "Use the system setting.", COMMENT: "/concerto keep the toggle in settings", ISSUE: "12", BUDGET: "3" }, OPENED);
    expect(run.status).toBe(0);
    expect(run.args.slice(0, 5)).toEqual(["--run", "--pr", "--json", "--budget", "3"]);
    expect(run.args[5]).toBe("Add a dark mode\n\nUse the system setting.\n\nkeep the toggle in settings");
    expect(run.output).toBe("pr=https://github.com/o/r/pull/7\n");
    expect(run.gh).toBe("issue comment 12 --body Concerto opened https://github.com/o/r/pull/7 (run done). ");
  });

  it("never runs what an issue contains, and says so when nothing was merged", () => {
    const run = runIssue({ TITLE: "x $(touch pwned) `touch pwned2`", BODY: "", ISSUE: "3" }, '{"type":"done","phase":"failed","stories":[]}');
    expect(existsSync(join(run.work, "pwned")) || existsSync(join(run.work, "pwned2"))).toBe(false);
    expect(run.args[5]?.startsWith("x $(touch pwned) `touch pwned2`")).toBe(true);
    expect(run.gh).toContain("merged nothing, so there is no pull request");
    expect(runIssue({ TITLE: "", BODY: " " }, OPENED).status).toBe(1);
  });
});
