import type { Concert } from "./orchestrator/concert.js";
import { perform } from "./orchestrator/perform.js";
import { scoreRequest } from "./orchestrator/score.js";

const LABEL = 12;
const DOLLAR_DIGITS = 3;
const write = (line: string) => process.stdout.write(`${line}\n`);

function follow(concert: Concert): () => void {
  let printed = 0;
  return concert.store.subscribe(() => {
    const { log } = concert.store.get();
    log.slice(printed).forEach((e) => write(`${e.label.padEnd(LABEL)} [${e.role}] ${e.detail} -> ${e.result}`));
    printed = log.length;
  });
}

/** Scores and performs without the TUI, printing the log as it grows. Exit code 1 on failure. */
export async function runHeadless(concert: Concert, request: string): Promise<void> {
  const unsubscribe = follow(concert);
  await scoreRequest(concert, request);
  await perform(concert);
  unsubscribe();
  const { phase, error, ledger, stories } = concert.store.get();
  stories.forEach((s) => write(`story  ${s.id}: ${s.status} (${s.rule}, ${s.model}, reviewed by ${s.critic})`));
  write(`${phase}${error ? `: ${error}` : ""} · $${ledger.usage.cost.toFixed(DOLLAR_DIGITS)} · cache read ${ledger.usage.cacheRead} tokens`);
  if (phase !== "done") process.exitCode = 1;
}
