import type { Concert } from "#src/orchestrator/concert.js";
import { perform } from "#src/orchestrator/perform.js";
import { scoreRequest } from "#src/orchestrator/score.js";

const LABEL = 12;
const DOLLAR_DIGITS = 3;
const write = (line: string) => process.stdout.write(`${line}\n`);

function follow(concert: Concert): () => void {
  let printed = 0;
  return concert.store.subscribe(() => {
    const { log } = concert.store.get();
    if (log.length === printed) return;
    log.slice(printed).forEach((e) => write(`${e.label.padEnd(LABEL)} [${e.role}] ${e.detail} -> ${e.result}`));
    printed = log.length;
  });
}

function summary(concert: Concert): void {
  const { phase, error, ledger, order, stories } = concert.store.get();
  order.forEach((id) => {
    const s = stories[id];
    if (s) write(`story  ${s.id}: ${s.status} (${s.rule}, ${s.model}, reviewed by ${s.critics[0] ?? "-"})`);
  });
  const savings = `cache read ${ledger.usage.cacheRead} · condensed ${ledger.condensedTokens} · deduped ${ledger.dedupedTokens}`;
  write(`${phase}${error ? `: ${error}` : ""} · $${ledger.usage.cost.toFixed(DOLLAR_DIGITS)} · ${savings} tokens`);
}

/** Scores and performs without the TUI, printing the log as it grows. Exit code 1 on failure. */
export async function runHeadless(concert: Concert, request: string): Promise<void> {
  const unsubscribe = follow(concert);
  try {
    await scoreRequest(concert, request);
    await perform(concert);
  } finally {
    unsubscribe();
  }
  summary(concert);
  if (concert.store.get().phase !== "done") process.exitCode = 1;
}
