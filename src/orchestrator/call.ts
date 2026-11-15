import { record } from "../cache/ledger.js";
import { systemPromptFile } from "../cache/prefix.js";
import type { Effort, Role } from "../config/types.js";
import { modelForRole } from "../models/router.js";
import type { ModelInfo } from "../models/types.js";
import type { RunEvent } from "../runner/events.js";
import type { RunResult } from "../runner/types.js";
import { sessionDir, type Concert } from "./concert.js";
import { skillsFor } from "./skills.js";

const SWARM_TRAIL = 6;

export type Call = {
  role: Role;
  prompt: string;
  model?: ModelInfo;
  effort?: Effort;
  tags?: string[];
  /** Same key, same pi session: later turns reuse the cached prefix of earlier ones. */
  sessionKey?: string;
  /** Read-only calls may be answered from the local response cache. */
  cacheable?: boolean;
};

function onEvent(c: Concert, role: Role) {
  return (e: RunEvent): void => {
    if (e.kind !== "tool") return;
    c.store.role(role, { note: `${e.name} ${e.detail}` });
    if (role === "section") c.store.update((s) => ({ swarm: [...s.swarm, e.name].slice(-SWARM_TRAIL) }));
  };
}

function brainModel(c: Concert): ModelInfo {
  return modelForRole(c.catalog, c.config, "conductor");
}

async function execute(c: Concert, call: Call, model: ModelInfo): Promise<RunResult> {
  const roleCfg = c.config.roles[call.role];
  return c.runner(
    {
      model: model.ref,
      prompt: call.prompt,
      systemFile: systemPromptFile(call.role, c.cwd),
      tools: roleCfg.tools,
      effort: call.effort ?? roleCfg.effort,
      skills: skillsFor(c.config.skills, call.tags ?? [], c.cwd),
      cwd: c.cwd,
      session: call.sessionKey ? { dir: sessionDir(c), id: `${c.runId}-${call.sessionKey}` } : undefined,
      signal: c.signal,
    },
    onEvent(c, call.role),
  );
}

/** One model call with routing, caching, cost accounting and UI updates. */
export async function callRole(c: Concert, call: Call): Promise<RunResult> {
  const model = call.model ?? modelForRole(c.catalog, c.config, call.role);
  const key = c.cache.key([model.ref, call.role, systemPromptFile(call.role, c.cwd), call.prompt]);
  const hit = call.cacheable ? c.cache.get(key) : null;
  c.store.role(call.role, { model: model.ref, activity: "working", note: hit ? "cache hit" : "" });
  if (hit) {
    c.store.update((s) => ({ ledger: { ...s.ledger, localHits: s.ledger.localHits + 1 } }));
    return hit;
  }
  const result = await execute(c, call, model);
  if (call.cacheable) c.cache.set(key, result);
  const entry = { usage: result.usage, price: model.price, brain: brainModel(c).price };
  c.store.update((s) => ({ ledger: record(s.ledger, entry) }));
  return result;
}
