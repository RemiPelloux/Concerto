import type { Checkpoint } from "#src/state/types.js";
import { details, headline, logBrief, readTag, runSegments } from "#src/orchestrator/briefs.js";
import { callRole } from "#src/orchestrator/call.js";
import type { Concert } from "#src/orchestrator/concert.js";

const QUESTIONS: Record<Checkpoint, string> = {
  "plan-lock": "Checkpoint: before the plan locks. What did the plan miss?",
  "repeat-error": "Checkpoint: the same story failed review twice. Root cause or rabbit hole? Give the one change that unblocks it.",
  "before-done": "Checkpoint: before calling done. Did the diff break anything? Read the files; run nothing.",
};

export type Consult = { verdict: "ok" | "revise" | "stop"; finding: string; guidance: string };

function verdictOf(reply: string): Consult["verdict"] {
  const tag = readTag(reply, "VERDICT");
  return tag === "revise" || tag === "stop" ? tag : "ok";
}

/**
 * Wakes the conductor at one of its three checkpoints. It reads; it never writes. Its session
 * is warm across checkpoints, so the snapshot and plan are only sent the first time.
 */
export async function consult(c: Concert, checkpoint: Checkpoint, extra = ""): Promise<Consult> {
  const s = c.store.get();
  const segments = [
    ...runSegments(s, c.repo.text),
    { name: "log", text: logBrief(s.log) },
    { name: "question", text: [`## ${QUESTIONS[checkpoint]}`, extra].filter(Boolean).join("\n\n") },
  ];
  c.store.role("conductor", { activity: "working", note: checkpoint });
  const reply = await callRole(c, { role: "conductor", segments, sessionKey: "conductor", label: checkpoint });
  const result = { verdict: verdictOf(reply.text), finding: headline(reply.text, "VERDICT"), guidance: details(reply.text, "VERDICT") };
  c.store.update((st) => ({ checkpoints: { ...st.checkpoints, [checkpoint]: result.verdict } }));
  c.store.role("conductor", { activity: "waiting", note: "on call" });
  c.store.log({ role: "conductor", label: "Advisor", detail: `${checkpoint}: ${result.finding}`, result: result.verdict });
  return result;
}
