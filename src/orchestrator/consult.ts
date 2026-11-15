import type { Checkpoint } from "../state/types.js";
import { headline, logBrief, planBrief, readTag } from "./briefs.js";
import { callRole } from "./call.js";
import type { Concert } from "./concert.js";

const QUESTIONS: Record<Checkpoint, string> = {
  "plan-lock": "Checkpoint: before the plan locks. What did the plan miss?",
  "repeat-error": "Checkpoint: the same story failed review twice. Root cause or rabbit hole?",
  "before-done": "Checkpoint: before calling done. Did the diff break anything? Run nothing; read the files.",
};

export type Consult = { verdict: string; finding: string };

/** Wakes the conductor at one of its three checkpoints. It reads; it never writes. */
export async function consult(c: Concert, checkpoint: Checkpoint, extra = ""): Promise<Consult> {
  const s = c.store.get();
  const prompt = [QUESTIONS[checkpoint], s.plan ? planBrief(s.plan) : "", logBrief(s.log), extra]
    .filter(Boolean)
    .join("\n\n");
  c.store.role("conductor", { activity: "working", note: checkpoint });
  const reply = await callRole(c, { role: "conductor", prompt, sessionKey: "conductor" });
  const result = { verdict: readTag(reply.text, "VERDICT") || "ok", finding: headline(reply.text, "VERDICT") };
  c.store.update((st) => ({ checkpoints: { ...st.checkpoints, [checkpoint]: result.verdict } }));
  c.store.role("conductor", { activity: "waiting", note: "on call" });
  c.store.log({ role: "conductor", label: "Advisor", detail: `${checkpoint}: ${result.finding}`, result: "Reviewed" });
  return result;
}
