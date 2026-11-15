import type { Concert } from "./concert.js";

const CENTS = 2;

/**
 * True once the run has spent its budget (API-equivalent dollars). The story is marked skipped
 * and logged; calls already running finish, nothing new starts.
 */
export function overBudget(c: Concert, storyId: string): boolean {
  const budget = c.config.budgetUsd;
  const spent = c.store.get().ledger.usage.cost;
  if (budget === undefined || spent < budget) return false;
  c.store.story(storyId, { status: "skipped" });
  const detail = `$${spent.toFixed(CENTS)} of $${budget.toFixed(CENTS)} spent, ${storyId} not started`;
  c.store.log({ role: "conductor", label: "Budget", detail, result: "skipped" });
  return true;
}

/** Why a run did not finish cleanly, or "" when it did. */
export function runOutcome(c: Concert, conductorFinding: string): string {
  const stories = Object.values(c.store.get().stories);
  const skipped = stories.filter((s) => s.status === "skipped").length;
  const failed = stories.filter((s) => s.status === "failed").length;
  if (skipped > 0) return `budget of $${(c.config.budgetUsd ?? 0).toFixed(CENTS)} reached, ${skipped} stories not started`;
  if (failed > 0) return `${failed} stories failed review`;
  return conductorFinding ? `Conductor: ${conductorFinding}` : "";
}
