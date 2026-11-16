import { z } from "zod";
import { EffortSchema } from "#src/config/types.js";
import type { State } from "#src/state/types.js";
import { callRole } from "#src/orchestrator/call.js";
import type { Concert } from "#src/orchestrator/concert.js";
import { scoreRequest } from "#src/orchestrator/score.js";

const MAX_QUESTIONS = 4;
const ASK = "## Mode\nThe person is at the terminal: you may ask questions when the request needs answers.";
const ASSUME = "## Mode\nNobody can answer questions in this run: leave `questions` empty and list your choices under `assumptions`.";

const RewriteSchema = z.object({
  request: z.string().min(1),
  questions: z.array(z.string().min(1)).max(MAX_QUESTIONS).default([]),
  assumptions: z.array(z.string().min(1)).default([]),
  brief: z.string().default(""),
  effort: EffortSchema.default("off"),
});
export type Rewrite = z.infer<typeof RewriteSchema>;

/** Pulls the first JSON object out of the rewriter's reply, fenced or not, and validates it. */
export function parseRewrite(reply: string): Rewrite {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The rewriter did not return JSON.");
  return RewriteSchema.parse(JSON.parse(reply.slice(start, end + 1)));
}

const asIs = (request: string): Rewrite => ({ request, questions: [], assumptions: [], brief: "", effort: "off" });

/**
 * The request made precise, by the rewriter role. A reply it cannot read keeps the person's own
 * words: the rewriter sharpens a run, it never stops one.
 */
export async function rewriteRequest(c: Concert, request: string, ask: boolean): Promise<Rewrite> {
  if (!c.config.rewrite) return asIs(request);
  const segments = [
    { name: "repository snapshot", text: c.repo.text },
    { name: "mode", text: ask ? ASK : ASSUME },
    { name: "request", text: `## Request\n${request}` },
  ];
  const reply = await callRole(c, { role: "rewriter", segments, cacheable: true, label: "rewriting the request" });
  try {
    const rewrite = parseRewrite(reply.text);
    return ask ? rewrite : { ...rewrite, questions: [] };
  } catch {
    c.store.log({ role: "rewriter", label: "Rewrite", detail: "the reply was not readable JSON", result: "kept your words" });
    return asIs(request);
  }
}

/** Keeps the brief and the effort floor for the run, logs what changed, and returns the request to score. */
function adopt(c: Concert, rewrite: Rewrite): string {
  c.store.update(() => ({ brief: rewrite.brief, floor: rewrite.effort, questions: [] }));
  c.store.role("rewriter", { activity: "done", note: rewrite.brief ? "brief written" : "" });
  if (c.config.rewrite) {
    const detail = rewrite.request.split("\n")[0] ?? "";
    c.store.log({ role: "rewriter", label: "Rewrite", detail, result: rewrite.brief ? `brief · effort ≥ ${rewrite.effort}` : `effort ≥ ${rewrite.effort}` });
  }
  rewrite.assumptions.forEach((a) => c.store.log({ role: "rewriter", label: "Assume", detail: a, result: "assumed" }));
  if (rewrite.assumptions.length === 0) return rewrite.request;
  return `${rewrite.request}\n\n## Assumptions\n${rewrite.assumptions.map((a) => `- ${a}`).join("\n")}`;
}

/**
 * Rewrites the request, then scores it. With `ask`, questions the rewriter has go on screen and
 * the run waits in "clarifying": returns false, and the answers come back through withAnswers.
 */
export async function planRequest(c: Concert, request: string, ask = false): Promise<boolean> {
  c.store.update(() => ({ phase: "scoring", prompt: request, error: "" }));
  const rewrite = await rewriteRequest(c, request, ask);
  if (rewrite.questions.length > 0) {
    c.store.update(() => ({ phase: "clarifying", questions: rewrite.questions }));
    c.store.role("rewriter", { activity: "waiting", note: "waiting for your answers" });
    rewrite.questions.forEach((q) => c.store.log({ role: "rewriter", label: "Question", detail: q, result: "waiting" }));
    return false;
  }
  await scoreRequest(c, adopt(c, rewrite));
  return true;
}

/** The request again with the rewriter's questions and the person's answers; no answer lets it decide. */
export function withAnswers(state: State, answers: string): string {
  const questions = (state.questions ?? []).map((q) => `- ${q}`).join("\n");
  if (!answers.trim()) return `${state.prompt}\n\n## Questions you may decide yourself\n${questions}`;
  return `${state.prompt}\n\n## Your questions\n${questions}\n\n## The person's answers\n${answers.trim()}`;
}
