import { runGate, type Check, type CheckResult } from "#src/engine/checks.js";
import { packageTest } from "#src/engine/package-tests.js";
import type { Concert } from "#src/orchestrator/concert.js";
import type { Story } from "#src/orchestrator/plan.js";

const MS_PER_MINUTE = 60_000;
const MS_PER_SECOND = 1000;

const seconds = (ms: number) => `${(ms / MS_PER_SECOND).toFixed(1)}s`;

function summary(results: CheckResult[]): string {
  return results.map((r) => `${r.name} ${r.ok ? "ok" : "failed"} ${seconds(r.ms)}${r.flaky ? " (flaky)" : ""}`).join(" · ");
}

/** What the builder reads on its next attempt: the failing command and the end of its output. */
function redFeedback(failed: CheckResult): string {
  return `## Concerto ran \`${failed.command}\` and it failed\nFix this first. The end of its output:\n\`\`\`\n${failed.output.trim()}\n\`\`\``;
}

/** For the critic: what already ran and passed, so it does not run it again. */
export function checksBrief(c: Concert, storyId: string): string {
  const ran = c.store.view(storyId).checks ?? [];
  if (ran.length === 0) return "";
  return `## Checks Concerto ran on this change\n${ran.map((r) => `- \`${r.command}\`: ${r.ok ? "passed" : "failed"}${r.flaky ? " after a rerun (flaky)" : ""}`).join("\n")}`;
}

/** The detected test command, narrowed to the package a monorepo story stays in; set commands stay. */
function scoped(c: Concert, story: Story): Check[] {
  if (c.config.checks.test !== undefined) return c.checks;
  const narrow = packageTest(c.cwd, story.files);
  return narrow ? c.checks.map((check) => (check.name === "test" ? { ...check, command: narrow } : check)) : c.checks;
}

/**
 * Runs the project's checks and the configured gates, then the story's acceptance checks, in the story's folder after a
 * build, before the critic. Returns "" when they pass (or there are none), otherwise the
 * feedback for the builder's next attempt.
 */
export async function gate(c: Concert, job: { story: Story; cwd: string }): Promise<string> {
  const acceptance = job.story.checks.map((command): Check => ({ name: "acceptance", command }));
  const gates = c.config.gates.map((command): Check => ({ name: "gate", command }));
  const checks = [...scoped(c, job.story), ...gates, ...acceptance];
  if (checks.length === 0) return "";
  c.store.story(job.story.id, { status: "checking" });
  const timeoutMs = c.config.checks.timeoutMinutes * MS_PER_MINUTE;
  const sandbox = c.config.sandbox.enabled ? { hide: c.config.sandbox.hide } : undefined;
  const { ok, results } = await runGate(checks, { cwd: job.cwd, timeoutMs, signal: c.signal, sandbox });
  c.store.story(job.story.id, { checks: results.map((r) => ({ name: r.name, command: r.command, ok: r.ok, ms: r.ms, flaky: r.flaky })) });
  c.store.log({ role: "critic", label: "Checks", detail: `${job.story.title}: ${summary(results)}`, result: ok ? "passed" : "failed" });
  const failed = results.find((r) => !r.ok);
  return failed ? redFeedback(failed) : "";
}
