import { existsSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { ConcertoConfig } from "#src/config/types.js";
import { listSessions, readSession, resumable, saveSession, searchSessions } from "#src/engine/history.js";
import { SessionLog } from "#src/engine/session-log.js";
import type { Catalog } from "#src/models/catalog.js";
import type { Progress, Tool } from "#src/mcp/server.js";
import { createConcert, type Concert } from "#src/orchestrator/concert.js";
import { perform } from "#src/orchestrator/perform.js";
import { planRequest } from "#src/orchestrator/rewrite.js";
import { str, type Json } from "#src/runner/json.js";
import type { Runner } from "#src/runner/types.js";
import { Store } from "#src/state/store.js";
import type { State } from "#src/state/types.js";

/** What a tool needs to start a run in a folder: the folder's config, its models, a runner. */
export type Opener = (cwd: string) => Promise<{ config: ConcertoConfig; catalog: Catalog; runner: Runner }>;

const CENTS = 2;
const CWD = { cwd: { type: "string", description: "Absolute path of the project. Default: the folder the server runs in." } };
const SESSION = { session: { type: "string", description: "A session id from concerto_plan, concerto_build or concerto_sessions." } };
const schema = (properties: Json, required: string[]) => ({ type: "object", properties, required });

function folder(args: Json): string {
  const cwd = str(args.cwd) || process.cwd();
  if (!isAbsolute(cwd) || !existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error(`"${cwd}" is not an absolute path to a folder.`);
  return cwd;
}

/** A run in `cwd` with its own session log, its log lines reported as progress. */
async function open(opener: Opener, cwd: string, progress: Progress): Promise<{ concert: Concert; id: string }> {
  const log = new SessionLog(cwd);
  const store = new Store((kind, text) => log.write(kind, text));
  let shown = 0;
  store.subscribe(() => {
    const lines = store.get().log;
    lines.slice(shown).forEach((e) => progress(`${e.label}: ${e.detail} -> ${e.result}`));
    shown = lines.length;
  });
  return { concert: await createConcert({ ...(await opener(cwd)), store, cwd }), id: log.id };
}

/** A plan as an agent reads it: each story with its score, builder, reviewer and estimate. */
function planView(id: string, s: State): string {
  const stories = s.order.map((sid) => s.stories[sid]).filter((v) => v !== undefined)
    .map((v) => ({ id: v.id, title: s.plan?.stories.find((p) => p.id === v.id)?.title ?? v.id, score: v.score, builder: v.model, reviewer: v.critics[0] ?? null, estimateUsd: Number(v.estimate.toFixed(CENTS)) }));
  const estimate = stories.reduce((sum, v) => sum + v.estimateUsd, 0);
  return JSON.stringify({ session: id, summary: s.plan?.summary ?? "", stories, estimateUsd: Number(estimate.toFixed(CENTS)), next: `concerto_build with session "${id}"` }, null, 2);
}

/** A finished run: per story its status, merged files and why it failed; the cost and the report. */
function outcome(id: string, s: State, cwd: string): string {
  const stories = s.order.map((sid) => s.stories[sid]).filter((v) => v !== undefined)
    .map((v) => ({ id: v.id, status: v.status, merged: v.merged ?? [], ...(v.status === "passed" ? {} : { finding: v.finding }) }));
  const reports = join(cwd, ".concerto", "runs");
  return JSON.stringify({ session: id, phase: s.phase, error: s.error || undefined, stories, costUsd: Number(s.ledger.usage.cost.toFixed(CENTS)), reports }, null, 2);
}

async function plan(opener: Opener, args: Json, progress: Progress): Promise<string> {
  const cwd = folder(args);
  const { concert, id } = await open(opener, cwd, progress);
  await planRequest(concert, str(args.request));
  saveSession(cwd, id, concert.store.get());
  return planView(id, concert.store.get());
}

/** Builds what a saved plan has left, as a new session that remembers the plan it came from. */
async function build(opener: Opener, args: Json, progress: Progress): Promise<string> {
  const cwd = folder(args);
  const saved = readSession(cwd, str(args.session));
  if (!saved?.plan) throw new Error(`No saved plan "${str(args.session)}" in ${cwd}. concerto_sessions lists them.`);
  const { concert, id } = await open(opener, cwd, progress);
  concert.store.update(() => ({ ...resumable(saved), parent: str(args.session) }));
  if (concert.store.get().phase !== "planned") return `Nothing left to build in ${str(args.session)}.`;
  await perform(concert);
  saveSession(cwd, id, concert.store.get());
  return outcome(id, concert.store.get(), cwd);
}

async function run(opener: Opener, args: Json, progress: Progress): Promise<string> {
  const planned = JSON.parse(await plan(opener, args, progress)) as { session: string };
  return build(opener, { ...args, session: planned.session }, progress);
}

function status(args: Json): string {
  const cwd = folder(args);
  const saved = readSession(cwd, str(args.session));
  if (!saved) throw new Error(`No saved session "${str(args.session)}" in ${cwd}.`);
  return saved.phase === "planned" ? planView(str(args.session), saved) : outcome(str(args.session), saved, cwd);
}

function sessions(args: Json): string {
  const cwd = folder(args);
  const found = str(args.query) ? searchSessions(cwd, str(args.query)) : listSessions(cwd);
  return JSON.stringify(found.map((s) => ({ id: s.id, at: new Date(s.at).toISOString(), prompt: s.prompt, phase: s.phase, passed: s.passed, total: s.total, parent: s.parent })), null, 2);
}

/** Concerto as MCP tools: plan, build, run, status and sessions, all in the given project folder. */
export function concertoTools(opener: Opener): Tool[] {
  const request = { request: { type: "string", description: "What to build, in plain words." } };
  return [
    { name: "concerto_plan", description: "Split a coding request into scored user stories and pick a model to build and one to review each. Changes no file. Returns a session id for concerto_build.", inputSchema: schema({ ...request, ...CWD }, ["request"]), run: (a, p) => plan(opener, a, p) },
    { name: "concerto_build", description: "Build a planned session: each story in its own git worktree, checked by the project's tests and a critic, then merged into the folder. Long: minutes per story.", inputSchema: schema({ ...SESSION, ...CWD }, ["session"]), run: (a, p) => build(opener, a, p) },
    { name: "concerto_run", description: "concerto_plan then concerto_build in one call.", inputSchema: schema({ ...request, ...CWD }, ["request"]), run: (a, p) => run(opener, a, p) },
    { name: "concerto_status", description: "A saved session: its plan if it waits to be built, otherwise each story's result and the cost.", inputSchema: schema({ ...SESSION, ...CWD }, ["session"]), run: async (a) => status(a) },
    { name: "concerto_sessions", description: "This project's saved sessions, newest first, or those whose request, files, models or result match the query.", inputSchema: schema({ query: { type: "string" }, ...CWD }, []), run: async (a) => sessions(a) },
  ];
}
