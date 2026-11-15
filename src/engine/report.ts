import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheHitRatio } from "./ledger.js";
import type { State } from "../state/types.js";

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const PERCENT = 100;
const CENTS = 2;

function storyRows(s: State): string[] {
  const rows = (s.plan?.stories ?? []).flatMap((story) => {
    const v = s.stories[story.id];
    if (!v) return [];
    return [`| ${story.title} | ${story.points} | ${v.score} | ${v.model} | ${v.critics[0] ?? "-"} | ${v.status} |`];
  });
  return ["| Story | Points | Score | Built by | Reviewed by | Status |", "|---|---|---|---|---|---|", ...rows];
}

function totals(s: State): string[] {
  const { usage, soloCost, cacheSaved, localHits, condensedTokens, dedupedTokens, fallbacks } = s.ledger;
  return [
    `- Cost: $${usage.cost.toFixed(CENTS)} API-equivalent, $${soloCost.toFixed(CENTS)} on the conductor model alone`,
    `- Provider cache: ${Math.round(cacheHitRatio(usage) * PERCENT)}% of prompt tokens read from cache, $${cacheSaved.toFixed(CENTS)} saved`,
    `- Engine: ${localHits} local cache hits, ${condensedTokens} tokens condensed, ${dedupedTokens} tokens not resent, ${fallbacks} fallbacks`,
  ];
}

function render(s: State): string {
  return [
    `# ${s.plan?.summary ?? "Concerto run"}`,
    "",
    `> ${s.prompt.replace(/\n/g, "\n> ")}`,
    "",
    `Result: **${s.phase}**${s.error ? `: ${s.error}` : ""}`,
    "",
    ...storyRows(s),
    "",
    ...(s.notes.length > 0 ? ["## Conductor notes", "", ...s.notes, ""] : []),
    "## Totals",
    "",
    ...totals(s),
    "",
    "## Log",
    "",
    ...s.log.map((e) => `- **${e.label}** (${e.role}) ${e.detail}: ${e.result}`),
    "",
  ].join("\n");
}

/** Writes `.concerto/runs/<run id>.md`: what was asked, who built what, the verdicts and the cost. */
export function writeReport(s: State, opts: { cwd: string; runId: string }): string {
  const dir = join(opts.cwd, ".concerto", "runs");
  const file = join(dir, `${opts.runId}.md`);
  const body = render(s);
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  writeFileSync(file, body, { mode: FILE_MODE });
  chmodSync(file, FILE_MODE);
  return file;
}
