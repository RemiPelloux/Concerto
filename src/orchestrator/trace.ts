import { packageVersion } from "#src/config/root.js";
import { Tracer, tracesEndpoint, type Span } from "#src/engine/telemetry.js";
import type { ModelInfo } from "#src/models/types.js";
import { promptTokens } from "#src/runner/usage.js";
import type { RunResult } from "#src/runner/types.js";
import type { Concert } from "#src/orchestrator/concert.js";
import type { Story } from "#src/orchestrator/plan.js";

const tracers = new WeakMap<Concert, Tracer | null>();
/** The request, shortened: a span attribute, not a transcript. */
const REQUEST_CHARS = 200;

/** This run's tracer, made on first use when an OTLP endpoint is set; null otherwise. */
function tracerOf(c: Concert): Tracer | null {
  if (!tracers.has(c)) tracers.set(c, tracesEndpoint() ? new Tracer() : null);
  return tracers.get(c) ?? null;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "failed";

/** A model call as a client span under its story, with the GenAI semantic-convention attributes. */
export async function traced<T extends RunResult>(c: Concert, call: { role: string; storyId?: string; model: ModelInfo }, work: () => Promise<T>): Promise<T> {
  const t = tracerOf(c);
  if (!t) return work();
  const { model } = call;
  const parent = (call.storyId ? t.byStory.get(call.storyId) : undefined) ?? t.root;
  const span = t.start(`chat ${model.parsed.id}`, { "gen_ai.operation.name": "chat", "gen_ai.system": model.parsed.provider, "gen_ai.request.model": model.parsed.id, "concerto.model": model.ref, "concerto.role": call.role, ...(call.storyId ? { "concerto.story.id": call.storyId } : {}) }, { parent, client: true });
  try {
    const r = await work();
    t.end(span, { "gen_ai.usage.input_tokens": promptTokens(r.usage), "gen_ai.usage.output_tokens": r.usage.output, "concerto.cache_read_tokens": r.usage.cacheRead, "concerto.cost_usd": r.usage.cost });
    return r;
  } catch (error) {
    t.end(span, { "error.type": message(error) }, false);
    throw error;
  }
}

/** The run's span, opened when building starts. */
export function traceRun(c: Concert): void {
  const t = tracerOf(c);
  if (t) t.root = t.start("concerto.run", { "concerto.run.id": c.runId, "concerto.request": c.store.get().prompt.slice(0, REQUEST_CHARS), "concerto.stories": c.store.get().order.length });
}

/** A story's span under the run, ended by the function it returns. */
export function traceStory(c: Concert, story: Story): (pass: boolean) => void {
  const t = tracerOf(c);
  if (!t) return () => undefined;
  const span: Span = t.start("concerto.story", { "concerto.story.id": story.id, "concerto.story.title": story.title, "concerto.story.score": c.store.view(story.id).score }, { parent: t.root });
  t.byStory.set(story.id, span);
  return (pass) => t.end(span, { "concerto.story.status": pass ? "passed" : "failed", "concerto.cost_usd": c.store.view(story.id).spent ?? 0 }, pass);
}

/** Ends the run's span and sends the trace; a collector that is down is logged, never thrown. */
export async function sendTrace(c: Concert): Promise<void> {
  const t = tracerOf(c);
  const endpoint = tracesEndpoint();
  if (!t || !endpoint) return;
  const s = c.store.get();
  if (t.root) t.end(t.root, { "concerto.phase": s.phase, "concerto.cost_usd": s.ledger.usage.cost }, s.phase === "done");
  const failure = await t.send(endpoint, packageVersion());
  c.store.log({ role: "conductor", label: "Trace", detail: failure || `${t.spans.length} spans to ${endpoint}`, result: failure ? "failed" : "sent" });
}
