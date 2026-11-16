import type { Concert } from "#src/orchestrator/concert.js";

const CENTS = 2;
const WARN_AT = 0.8;
const PERCENT = 100;

type Kind = "run" | "story" | "day" | "repo";
type Cap = { kind: Kind; limit: number; spent: number };

const warned = new WeakMap<Concert, Set<Kind>>();
const reached = new WeakMap<Concert, Set<Kind>>();
const NAME: Record<Kind, string> = { run: "run budget", story: "story budget", day: "daily budget", repo: "repository budget" };

/** Every cap set in the config, with what has been spent against it so far. */
function caps(c: Concert, storyId: string): Cap[] {
  const run = c.store.get().ledger.usage.cost;
  const { story, day, repo } = c.config.budgets;
  const all: (Cap | null)[] = [
    c.config.budgetUsd ? { kind: "run", limit: c.config.budgetUsd, spent: run } : null,
    story ? { kind: "story", limit: story, spent: c.store.get().stories[storyId]?.spent ?? 0 } : null,
    day ? { kind: "day", limit: day, spent: c.spentBefore.today + run } : null,
    repo ? { kind: "repo", limit: repo, spent: c.spentBefore.total + run } : null,
  ];
  return all.filter((cap): cap is Cap => cap !== null);
}

const money = (cap: Cap) => `$${cap.spent.toFixed(CENTS)} of the $${cap.limit.toFixed(CENTS)} ${NAME[cap.kind]}`;

function warnOnce(c: Concert, cap: Cap): void {
  const seen = warned.get(c) ?? new Set<Kind>();
  warned.set(c, seen);
  if (seen.has(cap.kind) || cap.spent < cap.limit * WARN_AT) return;
  seen.add(cap.kind);
  c.store.log({ role: "conductor", label: "Budget", detail: `${Math.round((cap.spent / cap.limit) * PERCENT)}%: ${money(cap)} spent`, result: "warning" });
}

/**
 * True once a budget is spent (API-equivalent dollars): the run's, the story's, today's or the
 * repository's. The story is marked skipped; calls already running finish, nothing new starts.
 * Each budget warns once at 80%.
 */
export function overBudget(c: Concert, storyId: string): boolean {
  const all = caps(c, storyId);
  all.forEach((cap) => warnOnce(c, cap));
  const over = all.find((cap) => cap.spent >= cap.limit);
  if (!over) return false;
  reached.set(c, (reached.get(c) ?? new Set<Kind>()).add(over.kind));
  c.store.story(storyId, { status: "skipped" });
  c.store.log({ role: "conductor", label: "Budget", detail: `${money(over)} spent, ${storyId} not started`, result: "skipped" });
  return true;
}

/** Why a run did not finish cleanly, or "" when it did. */
export function runOutcome(c: Concert, conductorFinding: string): string {
  const stories = Object.values(c.store.get().stories);
  const skipped = stories.filter((s) => s.status === "skipped").length;
  const failed = stories.filter((s) => s.status === "failed").length;
  const kinds = [...(reached.get(c) ?? [])].map((k) => NAME[k]).join(" and ");
  if (skipped > 0) return `${kinds || "budget"} reached, ${skipped} stories not started`;
  if (failed > 0) return `${failed} stories failed review`;
  return conductorFinding ? `Conductor: ${conductorFinding}` : "";
}
