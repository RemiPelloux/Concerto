import { randomBytes } from "node:crypto";

const TRACE_BYTES = 16;
const SPAN_BYTES = 8;
const NS_PER_MS = 1_000_000n;
const TIMEOUT_MS = 10_000;
const STATUS = { ok: 1, error: 2 };
const KIND = { internal: 1, client: 3 };

type Value = string | number | boolean;
export type Span = { spanId: string; parentSpanId?: string; name: string; kind: number; start: number; end: number; attributes: Record<string, Value>; ok: boolean };

/** The OTLP endpoint for traces, from the standard environment variables; null when none is set. */
export function tracesEndpoint(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) return env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  return env.OTEL_EXPORTER_OTLP_ENDPOINT ? `${env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, "")}/v1/traces` : null;
}

/** `OTEL_EXPORTER_OTLP_HEADERS=api-key=abc,x-team=core` as fetch headers. */
function otlpHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const pairs = (env.OTEL_EXPORTER_OTLP_HEADERS ?? "").split(",").map((p) => p.split("=")).filter(([k, v]) => k && v);
  return Object.fromEntries(pairs.map(([k = "", ...v]) => [decodeURIComponent(k.trim()), decodeURIComponent(v.join("=").trim())]));
}

const attr = ([key, v]: [string, Value]) => ({ key, value: typeof v === "boolean" ? { boolValue: v } : typeof v === "number" ? (Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v }) : { stringValue: v } });
const nanos = (ms: number) => String(BigInt(Math.round(ms)) * NS_PER_MS);

/**
 * One run's spans: the run, each story under it, each model call under its story. Kept in memory
 * and sent once, as OTLP/HTTP JSON, when the run ends.
 */
export class Tracer {
  readonly traceId = randomBytes(TRACE_BYTES).toString("hex");
  readonly spans: Span[] = [];
  readonly byStory = new Map<string, Span>();
  root: Span | null = null;

  /** `client`: a call out to a model, as opposed to Concerto's own work. */
  start(name: string, attributes: Record<string, Value>, at: { parent?: Span | null; client?: boolean } = {}): Span {
    const span = { spanId: randomBytes(SPAN_BYTES).toString("hex"), parentSpanId: at.parent?.spanId, name, kind: at.client ? KIND.client : KIND.internal, start: Date.now(), end: 0, attributes, ok: true };
    this.spans.push(span);
    return span;
  }

  end(span: Span, attributes: Record<string, Value> = {}, ok = true): void {
    Object.assign(span.attributes, attributes);
    span.end = Date.now();
    span.ok = ok;
  }

  otlp(version: string): object {
    const spans = this.spans.map((s) => ({ traceId: this.traceId, spanId: s.spanId, ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}), name: s.name, kind: s.kind, startTimeUnixNano: nanos(s.start), endTimeUnixNano: nanos(s.end || s.start), attributes: Object.entries(s.attributes).map(attr), status: { code: s.ok ? STATUS.ok : STATUS.error } }));
    return { resourceSpans: [{ resource: { attributes: [attr(["service.name", "concerto"]), attr(["service.version", version])] }, scopeSpans: [{ scope: { name: "concerto", version }, spans }] }] };
  }

  /** Sends the spans; returns why it could not, or "" when the collector took them. */
  async send(endpoint: string, version: string): Promise<string> {
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", ...otlpHeaders() }, body: JSON.stringify(this.otlp(version)), signal: AbortSignal.timeout(TIMEOUT_MS) });
      return res.ok ? "" : `${endpoint} answered ${res.status}`;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
}
