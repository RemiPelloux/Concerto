import { createInterface } from "node:readline/promises";
import type { Concert } from "#src/orchestrator/concert.js";
import { perform } from "#src/orchestrator/perform.js";
import { planRequest } from "#src/orchestrator/rewrite.js";
import type { State } from "#src/state/types.js";

const CENTS = 2;
type Entry = State["log"][number];
const say = (line: string) => process.stdout.write(`${line}\n`);
const title = (s: State, id: string) => s.plan?.stories.find((p) => p.id === id)?.title ?? id;

/** A log line as a sentence a screen reader can say: who, what, and how it went. */
export function sentence(e: Entry): string {
  const detail = e.detail.replace(/\s*·\s*/g, ", ");
  if (e.label === "Builder") return `The builder finished "${detail}" and reports ${e.result}.`;
  if (e.label === "Critic" || e.label === "2nd critic") return `The ${e.label === "Critic" ? "critic" : "second critic"} ${e.result} the story: ${detail}.`;
  if (e.label === "Checks") return `Checks ${e.result}: ${detail}.`;
  if (e.label === "Fallback") return `A model failed and Concerto moved on: ${detail}, ${e.result}.`;
  return `${e.label}: ${detail}. Result: ${e.result}.`;
}

/** The plan as sentences: how many stories, then each with its score, models and estimate. */
export function planSentences(s: State): string[] {
  const views = s.order.map((id) => s.stories[id]).filter((v) => v !== undefined);
  const total = views.reduce((sum, v) => sum + v.estimate, 0);
  const lines = views.map((v, i) => `Story ${i + 1} of ${views.length}, ${title(s, v.id)}: score ${v.score}, built by ${v.model}, reviewed by ${v.critics[0] ?? "nobody"}, about $${v.estimate.toFixed(CENTS)}.`);
  return [`The plan has ${views.length} ${views.length === 1 ? "story" : "stories"}, about $${total.toFixed(CENTS)} in all.`, ...lines];
}

/** Each new log line and each story that starts, passes or fails, as it happens. */
function follow(c: Concert): () => void {
  let said = 0;
  const statuses = new Map<string, string>();
  return c.store.subscribe(() => {
    const s = c.store.get();
    s.log.slice(said).forEach((e) => say(sentence(e)));
    said = s.log.length;
    Object.values(s.stories).filter((v) => statuses.get(v.id) !== v.status && ["building", "passed", "failed"].includes(v.status)).forEach((v) => {
      statuses.set(v.id, v.status);
      say(`Story "${title(s, v.id)}" is now ${v.status}.`);
    });
  });
}

async function confirmed(yes: boolean): Promise<boolean> {
  if (yes) return true;
  if (!process.stdin.isTTY) {
    say("Not building: add --yes to build without a question.");
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Build these stories? Type yes to build, anything else to stop: ");
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

/**
 * `--plain`: the whole run as sentences, one per line, nothing redrawn in place: for screen
 * readers, braille displays and logs. Asks before building unless --yes.
 */
export async function runPlain(c: Concert, request: string, yes: boolean): Promise<void> {
  say(`Planning: ${request}`);
  await planRequest(c, request);
  planSentences(c.store.get()).forEach(say);
  if (!(await confirmed(yes))) return;
  const stop = follow(c);
  await perform(c).finally(stop);
  const s = c.store.get();
  const passed = s.order.filter((id) => s.stories[id]?.status === "passed").length;
  say(`Finished: ${passed} of ${s.order.length} stories passed, $${s.ledger.usage.cost.toFixed(CENTS)} spent.${s.error ? ` ${s.error}` : ""}`);
  if (s.phase !== "done") process.exitCode = 1;
}
