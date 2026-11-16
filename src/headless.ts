import { join } from "node:path";
import { EVENT_FORMAT } from "#src/events.js";
import type { Concert } from "#src/orchestrator/concert.js";
import { perform } from "#src/orchestrator/perform.js";
import { planRequest } from "#src/orchestrator/rewrite.js";

const LABEL = 12;
const DOLLAR_DIGITS = 3;
const write = (line: string) => process.stdout.write(`${line}\n`);

/** `--json`: one JSON object per line, `type` first: session, log, story, done (and pr); see src/events.ts. */
export const emit = (type: string, fields: object) => write(JSON.stringify({ type, ...fields }));

function follow(concert: Concert, json: boolean): () => void {
  let printed = 0;
  const statuses = new Map<string, string>();
  return concert.store.subscribe(() => {
    const { log, stories } = concert.store.get();
    log.slice(printed).forEach((e) => (json ? emit("log", { label: e.label, role: e.role, detail: e.detail, result: e.result }) : write(`${e.label.padEnd(LABEL)} [${e.role}] ${e.detail} -> ${e.result}`)));
    printed = log.length;
    if (!json) return;
    Object.values(stories).filter((s) => statuses.get(s.id) !== s.status).forEach((s) => {
      statuses.set(s.id, s.status);
      emit("story", { id: s.id, status: s.status, model: s.model });
    });
  });
}

function summary(concert: Concert, json: boolean): void {
  const { phase, error, ledger, order, stories } = concert.store.get();
  if (json) {
    const report = join(concert.cwd, ".concerto", "runs", `${concert.runId}.md`);
    emit("done", { phase, error: error || undefined, costUsd: ledger.usage.cost, report, stories: order.map((id) => ({ id, status: stories[id]?.status, merged: stories[id]?.merged ?? [] })) });
    return;
  }
  order.forEach((id) => {
    const s = stories[id];
    if (s) write(`story  ${s.id}: ${s.status} (${s.rule}, ${s.model}, reviewed by ${s.critics[0] ?? "-"})`);
  });
  const savings = `cache read ${ledger.usage.cacheRead} · condensed ${ledger.condensedTokens} · deduped ${ledger.dedupedTokens}`;
  write(`${phase}${error ? `: ${error}` : ""} · $${ledger.usage.cost.toFixed(DOLLAR_DIGITS)} · ${savings} tokens`);
}

/** Rewrites, scores and performs without the TUI, printing the log as it grows. Exit code 1 on failure. */
export async function runHeadless(concert: Concert, request: string, opts: { log: { id: string; shownPath: string }; json: boolean }): Promise<void> {
  if (opts.json) emit("session", { format: EVENT_FORMAT, session: opts.log.id, log: opts.log.shownPath });
  else write(`session ${opts.log.id} · log ${opts.log.shownPath}`);
  const unsubscribe = follow(concert, opts.json);
  try {
    await planRequest(concert, request);
    await perform(concert);
  } finally {
    unsubscribe();
  }
  summary(concert, opts.json);
  if (concert.store.get().phase !== "done") process.exitCode = 1;
}
