import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { State } from "#src/state/types.js";

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const AGENT_TAIL = 12;

/** What a secret usually looks like in a log: provider keys, tokens, private keys, `password=` pairs. */
const SECRETS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
];
/** `password=…`, `api_key: …`: the name stays, the value goes. */
const ASSIGNED = /\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|passwd|token)["']?\s*[:=]\s*["']?)[^\s"',;]{4,}/gi;

/** The text with anything shaped like a secret replaced by [redacted]. */
export function scrub(text: string): string {
  return SECRETS.reduce((t, pattern) => t.replace(pattern, "[redacted]"), text).replace(ASSIGNED, "$1[redacted]");
}

const escape = (text: string) => scrub(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function storyRows(state: State): string {
  return (state.plan?.stories ?? []).map((story) => {
    const v = state.stories[story.id];
    const cells = [story.title, v?.status ?? "", v?.model ?? "", String(v?.score ?? ""), (v?.merged ?? []).join(", "), (v?.checks ?? []).map((c) => `${c.command}: ${c.ok ? "ok" : "failed"}`).join("; "), v?.finding ?? ""];
    return `<tr>${cells.map((c) => `<td>${escape(c)}</td>`).join("")}</tr>`;
  }).join("\n");
}

function agents(state: State): string {
  return state.agentOrder.map((id) => state.agents[id]).filter((a) => a !== undefined)
    .map((a) => `<details><summary>${escape(`${a.label} · ${a.role} · ${a.model} · ${a.status}`)}</summary><pre>${escape(a.lines.slice(-AGENT_TAIL).join("\n"))}</pre></details>`).join("\n");
}

/** The run as one self-contained HTML page: request, stories, log and agent output, secrets redacted. */
export function renderShare(id: string, state: State): string {
  const style = "body{font:14px/1.5 system-ui,sans-serif;max-width:72rem;margin:2rem auto;padding:0 1rem;color:#1d1f24}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.3rem .5rem;text-align:left;vertical-align:top}pre{white-space:pre-wrap;background:#f6f6f4;padding:.5rem}";
  return [
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Concerto run ${escape(id)}</title><style>${style}</style></head><body>`,
    `<h1>${escape(state.plan?.summary ?? state.prompt)}</h1><p>Session ${escape(id)} · ${escape(state.phase)}${state.error ? ` · ${escape(state.error)}` : ""} · $${state.ledger.usage.cost.toFixed(2)} API-equivalent</p>`,
    `<blockquote><pre>${escape(state.prompt)}</pre></blockquote>`,
    `<table><tr><th>Story</th><th>Status</th><th>Built by</th><th>Score</th><th>Merged</th><th>Checks</th><th>Finding</th></tr>${storyRows(state)}</table>`,
    `<h2>Log</h2><pre>${escape(state.log.map((e) => `${e.label} (${e.role}) ${e.detail}: ${e.result}`).join("\n"))}</pre>`,
    `<h2>Agents</h2>${agents(state)}`,
    "</body></html>",
  ].join("\n");
}

/** Writes `.concerto/share/<id>.html`, owner-only; the person decides whom to send it to. */
export function writeShare(cwd: string, id: string, state: State): string {
  const dir = join(cwd, ".concerto", "share");
  const file = join(dir, `${id}.html`);
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  writeFileSync(file, renderShare(id, state), { mode: FILE_MODE });
  chmodSync(file, FILE_MODE);
  return file;
}
