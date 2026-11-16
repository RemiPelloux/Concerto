import type { SessionLog } from "#src/engine/session-log.js";
import type { Store } from "#src/state/store.js";
import type { Phase } from "#src/state/types.js";
import { parseSlash, type Panel } from "#src/ui/slash.js";
import { withAnswers } from "#src/orchestrator/rewrite.js";

const BUSY: ReadonlySet<Phase> = new Set(["scoring", "running"]);
/** Commands that would pull a run out from under its agents: they wait until it is stopped. */
const NEEDS_STOP: ReadonlySet<string> = new Set(["setup", "clear", "history", "ask", "reject"]);

export type PromptActions = {
  store: Store;
  log: SessionLog;
  request: (text: string) => void;
  slash: (text: string) => void;
  show: (panel: Panel) => void;
};

/** Typed during a build: every builder and critic reads it from their next step on. */
function note(a: PromptActions, text: string): void {
  a.log.write("command", `note ${text}`);
  a.store.update((s) => ({ notes: [...s.notes, `From the user, during the run: ${text}`] }));
  a.store.log({ role: "conductor", label: "You", detail: text, result: "noted" });
}

/**
 * Enter with text, by phase: a command in any phase (except the few that need the run stopped),
 * answers to the rewriter's questions, a change that re-plans a waiting plan, a note for the agents during a build, otherwise a new
 * request.
 */
export function submitPrompt(text: string, a: PromptActions): void {
  const state = a.store.get();
  if (text.startsWith("/")) {
    const name = parseSlash(text)?.name ?? "";
    if (BUSY.has(state.phase) && NEEDS_STOP.has(name)) return a.show({ title: `/${name}`, lines: ["A run is going. Press Esc to stop it first, then try again."] });
    return a.slash(text);
  }
  if (state.phase === "clarifying") return a.request(withAnswers(state, text));
  if (state.phase === "planned") return a.request(`${state.prompt}\n\nChange: ${text}`);
  if (state.phase === "running") return note(a, text);
  if (state.phase === "scoring") return a.show({ title: "Scoring", lines: ["Wait for the plan, then type your change: Enter re-plans with it."] });
  a.request(text);
}
