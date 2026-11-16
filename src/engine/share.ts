import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scrub } from "#src/engine/secrets.js";
import type { State } from "#src/state/types.js";

export { scrub };

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const AGENT_TAIL = 12;

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
