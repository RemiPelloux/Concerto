import { bump, record } from "#src/engine/ledger.js";
import { assemble, normalizeForKey, type Segment } from "#src/engine/segments.js";
import type { Effort, Role } from "#src/config/types.js";
import { roleChain } from "#src/models/router.js";
import type { ModelInfo } from "#src/models/types.js";
import type { RunEvent } from "#src/runner/events.js";
import type { RunRequest, RunResult } from "#src/runner/types.js";
import { blocked, pauseOnLimit, recordSpend } from "#src/models/quota.js";
import { AgentFeed } from "#src/orchestrator/feed.js";
import { SessionLog } from "#src/engine/session-log.js";
import type { Concert } from "#src/orchestrator/concert.js";
import { traced } from "#src/orchestrator/trace.js";
import { audit } from "#src/orchestrator/audit-run.js";
import type { SandboxSpec } from "#src/runner/sandbox.js";

const MS_PER_MINUTE = 60_000;

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type Call = {
  role: Role;
  /** Most stable first; see runSegments. */
  segments: Segment[];
  /** Models to try in order. Default: the role's chain. */
  chain?: ModelInfo[];
  effort?: Effort;
  tags?: string[];
  /** Same key, same model: one warm session, and segments it already has are not resent. */
  sessionKey?: string;
  /** What the agent view calls this call: a story title, a checkpoint. */
  label?: string;
  /** The story this call works for: its cost and tokens are added to the story's account. */
  storyId?: string;
  /** Where the agent works: the story's worktree. Default: the run's folder. */
  cwd?: string;
  /** Read-only calls may be answered by the local response cache. */
  cacheable?: boolean;
  /** A custom role: its own system prompt and tools in place of the role's. */
  custom?: { systemFile: string; tools: string[] };
};

export type CallResult = RunResult & { model: ModelInfo };

/** Each tool call shows on the role's line and goes to the run's audit log, whole. */
function onEvent(c: Concert, call: Call, model: string) {
  return (e: RunEvent): void => {
    if (e.kind !== "tool") return;
    c.store.role(call.role, { note: `${e.name} ${e.detail}` });
    if (call.role === "section") c.store.tool(e.name);
    audit(c, { story: call.storyId, role: call.label ?? call.role, model, kind: e.name, detail: e.full ?? e.detail });
  };
}

/** Runs the call as a visible agent: started, fed line by line, ended done or failed. */
async function watched(c: Concert, call: Call, req: RunRequest): Promise<RunResult> {
  const id = `${call.role}:${call.sessionKey ?? call.role}`;
  const feed = new AgentFeed(c.store, id);
  const notes = onEvent(c, call, req.model);
  c.store.agentStart({ id, role: call.role, model: req.model, label: call.label ?? call.role });
  const record = (answer: string, ok: boolean) => SessionLog.current?.call({ at: started, role: call.role, label: call.label ?? call.role, model: req.model, prompt: req.prompt, answer, ms: Date.now() - started, ok });
  const started = Date.now();
  try {
    const result = await c.runner(req, (e) => {
      notes(e);
      feed.push(e);
    });
    feed.flush();
    c.store.agentEnd(id, "done");
    record(result.text, true);
    return result;
  } catch (error) {
    feed.push({ kind: "error", message: errorMessage(error).split("\n")[0] ?? "failed" });
    feed.flush();
    c.store.agentEnd(id, "failed");
    record(errorMessage(error), false);
    throw error;
  }
}

const quotaNoted = new WeakMap<Concert, Set<string>>();

/**
 * The chain without the accounts that are rate-limited or have spent their window, logged once
 * per account and run. When every way is blocked, the whole chain is tried anyway.
 */
function available(c: Concert, chain: ModelInfo[]): ModelInfo[] {
  const noted = quotaNoted.get(c) ?? new Set<string>();
  quotaNoted.set(c, noted);
  const open = chain.filter((m) => {
    const why = blocked(m.parsed.prefix, c.config.limits[m.parsed.prefix]);
    if (why && !noted.has(m.parsed.prefix)) {
      noted.add(m.parsed.prefix);
      c.store.log({ role: "conductor", label: "Quota", detail: `${m.parsed.prefix}: ${why}`, result: "skipped" });
    }
    return !why;
  });
  return open.length > 0 ? open : chain;
}

/** Adds one call's cost to its story, so runs can be learned from per story. */
function charge(c: Concert, storyId: string, cost: number): void {
  const spent = c.store.get().stories[storyId]?.spent ?? 0;
  c.store.story(storyId, { spent: spent + cost });
}

/** The sandbox for a call when the config asks for one; a host it refuses is logged and audited. */
function sandboxFor(c: Concert, call: Call, sessionDir: string | undefined): SandboxSpec | undefined {
  const box = c.config.sandbox;
  if (!box.enabled) return undefined;
  const blocked = (host: string) => {
    c.store.log({ role: call.role, label: "Sandbox", detail: `${call.label ?? call.role}: refused a connection to ${host}`, result: "blocked" });
    audit(c, { story: call.storyId, role: call.label ?? call.role, model: "-", kind: "network-blocked", detail: host });
  };
  return { allowHosts: box.allowHosts, hide: box.hide, writable: sessionDir ? [sessionDir] : [], blocked };
}

async function execute(c: Concert, call: Call, model: ModelInfo): Promise<RunResult> {
  const roleCfg = c.config.roles[call.role];
  const session = call.sessionKey ? c.sessions.open(call.sessionKey, model) : undefined;
  const assembled = assemble(call.segments, session?.sent);
  const timeout = AbortSignal.timeout(c.config.timeoutMinutes * MS_PER_MINUTE);
  const result = await watched(c, call, {
    model: model.ref,
    prompt: assembled.prompt,
    systemFile: call.custom?.systemFile ?? c.prompts.file(call.role),
    tools: call.custom?.tools ?? roleCfg.tools,
    effort: model.effort ?? call.effort ?? roleCfg.effort,
    skills: c.skills.for(call.tags ?? []), cwd: call.cwd ?? c.cwd,
    session, signal: AbortSignal.any([c.signal, timeout]),
    fullAccess: c.config.codexFullAccess, sandbox: sandboxFor(c, call, session?.dir),
  });
  if (session) c.sessions.record(session, assembled.hashes);
  const entry = { usage: result.usage, price: model.price, brain: c.brainPrice, role: call.role, model: model.ref };
  const before = c.store.get().ledger.usage.cost;
  c.store.update((s) => ({ ledger: bump(record(s.ledger, entry), "dedupedTokens", assembled.skippedTokens) }));
  const cost = c.store.get().ledger.usage.cost - before;
  if (call.storyId) charge(c, call.storyId, cost);
  recordSpend(model.parsed.prefix, cost);
  return result;
}

async function attempt(c: Concert, call: Call, model: ModelInfo): Promise<RunResult> {
  c.store.role(call.role, { model: model.ref, activity: "working", note: "" });
  if (!call.cacheable) return execute(c, call, model);
  const prompt = normalizeForKey(assemble(call.segments).prompt);
  const key = c.cache.key([model.ref, call.role, c.prompts.file(call.role), c.repo.key, prompt]);
  const { result, hit } = await c.cache.once(key, () => execute(c, call, model));
  if (hit !== "miss") c.store.update((s) => ({ ledger: bump(s.ledger, "localHits") }));
  return result;
}

/** One model call with fallbacks: a failure moves to the next model in the chain. */
export async function callRole(c: Concert, call: Call): Promise<CallResult> {
  const chain = available(c, call.chain ?? roleChain(c.catalog, c.config, call.role));
  let lastError: unknown = new Error(`No model to run the ${call.role}.`);
  for (const [i, model] of chain.entries()) {
    try {
      return { ...(await traced(c, { role: call.role, storyId: call.storyId, model }, () => attempt(c, call, model))), model };
    } catch (error) {
      if (c.signal.aborted) throw error;
      lastError = error;
      pauseOnLimit(model.parsed.prefix, errorMessage(error));
      const next = chain[i + 1];
      c.store.update((s) => ({ ledger: bump(s.ledger, "fallbacks") }));
      const detail = `${model.ref}: ${errorMessage(error).split("\n")[0]}`;
      c.store.log({ role: call.role, label: "Fallback", detail, result: next ? `-> ${next.ref}` : "no model left" });
    }
  }
  throw lastError;
}
