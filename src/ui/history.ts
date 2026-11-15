import { listSessions, readSession, resumable, type SessionSummary } from "#src/engine/history.js";
import type { SlashContext } from "#src/ui/slash.js";

const PROMPT = 60;
const ID = 18;
const ISO_MINUTES = 16;
const PHASE = 7;
const PROGRESS = 12;

function line(s: SessionSummary, n: number): string {
  const when = new Date(s.at).toISOString().slice(0, ISO_MINUTES).replace("T", " ");
  const progress = s.total ? `${s.passed}/${s.total} passed` : "no plan";
  const prompt = s.prompt.length > PROMPT ? `${s.prompt.slice(0, PROMPT - 1)}…` : s.prompt || "(no request)";
  return `${String(n).padStart(2)}  ${s.id.padEnd(ID)} ${when}  ${s.phase.padEnd(PHASE)} ${progress.padEnd(PROGRESS)} ${prompt}`;
}

/** `/history 2` or `/history s-…`: the n-th listed session, or the one with that id. */
function pick(arg: string, sessions: SessionSummary[]): string | null {
  const n = Number(arg);
  if (Number.isInteger(n) && n >= 1) return sessions[n - 1]?.id ?? null;
  return arg;
}

/** Lists this project's saved sessions, or reopens one so what did not pass can be built again. */
export function history(arg: string, ctx: SlashContext): void {
  const sessions = listSessions(ctx.cwd);
  if (!arg) {
    const lines = sessions.length ? sessions.map((s, i) => line(s, i + 1)) : ["No saved sessions in this project yet."];
    return ctx.show({ title: "History", lines: [...lines, "", "/history 2 or /history <id> reopens a session · concerto --resume <id> from the shell"] });
  }
  const id = pick(arg, sessions);
  const saved = id ? readSession(ctx.cwd, id) : null;
  if (!saved) return ctx.show({ title: "History", lines: [`No saved session "${arg}". Type /history to list them.`] });
  const state = resumable(saved);
  ctx.resume(state);
  const left = state.order.filter((s) => state.stories[s]?.status !== "passed").length;
  const next = state.phase === "planned" ? `${left} of ${state.order.length} stories to build · enter builds them, esc drops the plan` : "nothing left to build";
  ctx.log.write("command", `resumed ${id}`);
  ctx.show({ title: `Session ${id}`, lines: [state.prompt || "(no request)", next] });
}
