import { listSessions, readSession, resumable, searchSessions, type SessionSummary } from "#src/engine/history.js";
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
  const from = s.parent ? `  (from ${s.parent})` : "";
  return `${String(n).padStart(2)}  ${s.id.padEnd(ID)} ${when}  ${s.phase.padEnd(PHASE)} ${progress.padEnd(PROGRESS)} ${prompt}${from}`;
}

/** `/history 2` or `/history s-…`: the n-th listed session, or the one with that id. */
function pick(arg: string, sessions: SessionSummary[]): string | null {
  const n = Number(arg);
  if (Number.isInteger(n) && n >= 1) return sessions[n - 1]?.id ?? null;
  return arg;
}

const HINT = "/history 2 or /history <id> reopens a session · /history <words> searches requests, files, models and results";

function listed(sessions: SessionSummary[], ctx: SlashContext, query = ""): void {
  const title = query ? `History matching "${query}"` : "History";
  const none = query ? `No saved session "${query}", and none whose request, files, models or result match it.` : "No saved sessions in this project yet.";
  const lines = sessions.length ? sessions.map((s, i) => line(s, i + 1)) : [none];
  ctx.show({ title, lines: [...lines, "", HINT] });
}

/**
 * Lists this project's saved sessions, searches them, or reopens one: the reopened session
 * continues as a new one that remembers where it came from, a branch of the history.
 */
export function history(arg: string, ctx: SlashContext): void {
  const sessions = listSessions(ctx.cwd);
  if (!arg) return listed(sessions, ctx);
  const id = pick(arg, sessions);
  const saved = id ? readSession(ctx.cwd, id) : null;
  if (!saved) return listed(searchSessions(ctx.cwd, arg), ctx, arg);
  const state = { ...resumable(saved), parent: id ?? undefined };
  ctx.resume(state);
  const left = state.order.filter((s) => state.stories[s]?.status !== "passed").length;
  const next = state.phase === "planned" ? `${left} of ${state.order.length} stories to build · enter builds them, esc drops the plan` : "nothing left to build";
  ctx.log.write("command", `resumed ${id}`);
  ctx.show({ title: `Session ${id}`, lines: [state.prompt || "(no request)", next] });
}
