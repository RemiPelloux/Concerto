import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { codexHome } from "#src/models/discover.js";
import { piAgentDir } from "#src/models/prices.js";
import type { Detection } from "#src/setup/detect.js";

const LABEL = 12;
/** Names only: a key's value is never read into Concerto. */
const KEY_NAME = /^(?:ANTHROPIC|OPENAI|DEEPSEEK|XAI|GEMINI|GOOGLE|OPENROUTER|GROQ|MISTRAL|CE)_\w*(?:KEY|TOKEN)$/;

function readJson(path: string): Record<string, unknown> {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** `name → host` for every `[model_providers.<name>]` in Codex's config.toml. */
function codexServers(): string[] {
  const file = join(codexHome(), "config.toml");
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8");
  const blocks = text.matchAll(/^\[model_providers\.([\w.-]+)\][^[]*?base_url\s*=\s*"([^"]+)"/gms);
  return [...blocks].map(([, name, url]) => `${name} → ${host(url ?? "")}`);
}

/** `name → host` for every pi provider with its own server. */
function piServers(): string[] {
  const providers = readJson(join(piAgentDir(), "models.json")).providers ?? {};
  return Object.entries(providers as Record<string, { baseUrl?: unknown }>).flatMap(([name, p]) =>
    typeof p.baseUrl === "string" ? [`${name} → ${host(p.baseUrl)}`] : [],
  );
}

function countVia(d: Detection, via: string): number {
  return d.linked.filter((m) => m.via === via).length;
}

function row(label: string, text: string): string {
  return `${label.padEnd(LABEL)} ${text}`;
}

/** What `/config auto` read on this machine: each CLI, its servers, and the API keys set. */
export function sourceLines(d: Detection, env: NodeJS.ProcessEnv = process.env): string[] {
  const claudeModel = readJson(join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "settings.json")).model;
  const keys = Object.keys(env).filter((k) => KEY_NAME.test(k)).sort();
  const codex = [`${countVia(d, "ChatGPT subscription (Codex)")} models`, ...codexServers()].join(" · ");
  const pi = [`${countVia(d, "pi")} models`, ...piServers()].join(" · ");
  return [
    row("Claude Code", d.claude ? `subscription · ${countVia(d, "Claude Code subscription")} models${typeof claudeModel === "string" ? ` · your default: ${claudeModel}` : ""}` : "not installed"),
    row("Codex", d.codex ? `${codex}${d.profiles.length ? ` · profiles ${d.profiles.join(", ")}` : ""}` : "not installed"),
    row("pi", d.pi ? pi : "not installed"),
    row("API keys", keys.length ? keys.join(", ") : "none in the environment"),
  ];
}
