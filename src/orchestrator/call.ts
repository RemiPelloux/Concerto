import { bump, record } from "../engine/ledger.js";
import { assemble, normalizeForKey, type Segment } from "../engine/segments.js";
import type { Effort, Role } from "../config/types.js";
import { roleChain } from "../models/router.js";
import type { ModelInfo } from "../models/types.js";
import type { RunEvent } from "../runner/events.js";
import type { RunResult } from "../runner/types.js";
import type { Concert } from "./concert.js";

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
  /** Read-only calls may be answered by the local response cache. */
  cacheable?: boolean;
};

export type CallResult = RunResult & { model: ModelInfo };

function onEvent(c: Concert, role: Role) {
  return (e: RunEvent): void => {
    if (e.kind !== "tool") return;
    c.store.role(role, { note: `${e.name} ${e.detail}` });
    if (role === "section") c.store.tool(e.name);
  };
}

async function execute(c: Concert, call: Call, model: ModelInfo): Promise<RunResult> {
  const roleCfg = c.config.roles[call.role];
  const session = call.sessionKey ? c.sessions.open(call.sessionKey, model) : undefined;
  const assembled = assemble(call.segments, session?.sent);
  const timeout = AbortSignal.timeout(c.config.timeoutMinutes * MS_PER_MINUTE);
  const result = await c.runner(
    {
      model: model.ref,
      prompt: assembled.prompt,
      systemFile: c.prompts.file(call.role),
      tools: roleCfg.tools,
      effort: call.effort ?? roleCfg.effort,
      skills: c.skills.for(call.tags ?? []),
      cwd: c.cwd,
      session,
      signal: AbortSignal.any([c.signal, timeout]),
    },
    onEvent(c, call.role),
  );
  if (session) c.sessions.record(session, assembled.hashes);
  const entry = { usage: result.usage, price: model.price, brain: c.brainPrice };
  c.store.update((s) => ({ ledger: bump(record(s.ledger, entry), "dedupedTokens", assembled.skippedTokens) }));
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
  const chain = call.chain ?? roleChain(c.catalog, c.config, call.role);
  let lastError: unknown = new Error(`No model to run the ${call.role}.`);
  for (const [i, model] of chain.entries()) {
    try {
      return { ...(await attempt(c, call, model)), model };
    } catch (error) {
      if (c.signal.aborted) throw error;
      lastError = error;
      const next = chain[i + 1];
      c.store.update((s) => ({ ledger: bump(s.ledger, "fallbacks") }));
      const detail = `${model.ref}: ${errorMessage(error).split("\n")[0]}`;
      c.store.log({ role: call.role, label: "Fallback", detail, result: next ? `-> ${next.ref}` : "no model left" });
    }
  }
  throw lastError;
}
