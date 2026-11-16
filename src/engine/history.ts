import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "#src/state/store.js";
import type { State } from "#src/state/types.js";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const SAVE_EVERY_MS = 1000;
const LISTED = 15;
const LOGS = [".concerto", "logs"];

/** `parent`: the session this one was reopened from. `words`: what a search matches against. */
export type SessionSummary = { id: string; at: number; prompt: string; phase: State["phase"]; passed: number; total: number; parent?: string; words: string };

function dir(cwd: string): string {
  return join(cwd, ...LOGS);
}

/** Writes the state next to the session log, atomically, owner-only. Never throws. */
export function saveSession(cwd: string, id: string, state: State): void {
  const file = join(dir(cwd), `${id}.json`);
  try {
    mkdirSync(dir(cwd), { recursive: true, mode: DIR_MODE });
    writeFileSync(`${file}.tmp`, JSON.stringify(state), { mode: FILE_MODE });
    renameSync(`${file}.tmp`, file);
  } catch {
    // A session that cannot be saved still runs; it just cannot be resumed.
  }
}

/** Saves the session at most once a second while it changes, and once more on exit. */
export function keepSessions(store: Store, at: { cwd: string; id: string }): void {
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    timer = null;
    saveSession(at.cwd, at.id, store.get());
  };
  store.subscribe(() => {
    timer ??= setTimeout(save, SAVE_EVERY_MS);
  });
  process.on("exit", () => {
    if (timer) save();
  });
}

export function readSession(cwd: string, id: string): State | null {
  try {
    return JSON.parse(readFileSync(join(dir(cwd), `${id}.json`), "utf8")) as State;
  } catch {
    return null;
  }
}

function summary(cwd: string, id: string): SessionSummary | null {
  const state = readSession(cwd, id);
  if (!state) return null;
  const total = state.order?.length ?? 0;
  const passed = (state.order ?? []).filter((s) => state.stories[s]?.status === "passed").length;
  const views = Object.values(state.stories ?? {});
  const results: string[] = [...views.map((v) => v.status), state.phase, state.error ?? ""];
  const files = (state.plan?.stories ?? []).flatMap((s) => s.files).concat(views.flatMap((v) => v.merged ?? []));
  const words = [state.prompt ?? "", ...files, ...views.flatMap((v) => [v.model, ...v.critics]), ...results].join(" ").toLowerCase();
  return { id, at: statSync(join(dir(cwd), `${id}.json`)).mtimeMs, prompt: state.prompt ?? "", phase: state.phase, passed, total, parent: state.parent, words };
}

function allSessions(cwd: string): SessionSummary[] {
  if (!existsSync(dir(cwd))) return [];
  const ids = readdirSync(dir(cwd)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length));
  return ids.map((id) => summary(cwd, id)).filter((s): s is SessionSummary => s !== null).sort((a, b) => b.at - a.at);
}

/** Saved sessions of this project, newest first. */
export function listSessions(cwd: string): SessionSummary[] {
  return allSessions(cwd).slice(0, LISTED);
}

/**
 * Saved sessions whose request, files, models or result hold every one of the words, newest first:
 * `/history billing.ts failed` finds the failed run that touched billing.ts.
 */
export function searchSessions(cwd: string, query: string): SessionSummary[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return allSessions(cwd).filter((s) => words.every((w) => s.words.includes(w))).slice(0, LISTED);
}

/**
 * A saved session, ready to continue: stories that did not pass go back to the queue, agents
 * that were cut off read as failed, and a plan with work left waits for Enter again.
 */
export function resumable(saved: State): State {
  const stories = Object.fromEntries(Object.entries(saved.stories).map(([id, s]) => [id, s.status === "passed" ? s : { ...s, status: "queued" as const }]));
  const agents = Object.fromEntries(Object.entries(saved.agents).map(([id, a]) => [id, a.status === "working" ? { ...a, status: "failed" as const, endedAt: a.lastAt } : a]));
  const left = saved.order.some((id) => stories[id]?.status !== "passed");
  const phase = !saved.plan ? "idle" : left ? "planned" : "done";
  return { ...saved, stories, agents, phase, error: "" };
}
