import { relative } from "node:path";
import { notify, type RunEvent } from "#src/engine/notify.js";
import type { Concert } from "#src/orchestrator/concert.js";

const CENTS = 2;

async function send(c: Concert, event: RunEvent): Promise<void> {
  if (c.config.notify.length === 0) return;
  const failures = await notify(c.config.notify, event);
  failures.forEach((detail) => c.store.log({ role: "conductor", label: "Notify", detail, result: "failed" }));
}

const headline = (c: Concert) => c.store.get().plan?.summary || c.store.get().prompt.split("\n")[0] || "Concerto run";

/** Tells the team how a run ended: stories passed, the cost, where the report is. */
export function announceEnd(c: Concert, report: string): Promise<void> {
  const s = c.store.get();
  const passed = s.order.filter((id) => s.stories[id]?.status === "passed").length;
  const on = s.phase === "done" ? "done" : "failed";
  const text = `${passed}/${s.order.length} stories passed${s.error ? ` · ${s.error}` : ""} · $${s.ledger.usage.cost.toFixed(CENTS)} · report ${relative(c.cwd, report)}`;
  const stories = s.order.map((id) => ({ id, status: s.stories[id]?.status, merged: s.stories[id]?.merged ?? [] }));
  return send(c, { on, title: `Concerto ${on === "done" ? "finished" : "failed"}: ${headline(c)}`, text, details: { phase: s.phase, costUsd: s.ledger.usage.cost, stories } });
}

/** A plan waits for someone to press Enter: worth a ping when the run was started and left. */
export function announcePlan(c: Concert): Promise<void> {
  const s = c.store.get();
  const estimate = s.order.reduce((sum, id) => sum + (s.stories[id]?.estimate ?? 0), 0);
  const text = `${s.order.length} stories, about $${estimate.toFixed(CENTS)}: open Concerto and press Enter to build, or edit the plan first.`;
  return send(c, { on: "plan", title: `Concerto plan ready: ${headline(c)}`, text, details: { stories: s.order, estimateUsd: estimate } });
}
