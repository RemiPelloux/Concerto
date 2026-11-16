import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { RunEvent } from "#src/runner/events.js";
import { asArray, asRecord, num, oneLine, str, type Json } from "#src/runner/json.js";
import { withSkillNote, writes } from "#src/runner/skill-note.js";
import { parseRef, type Runner, type RunRequest, type RunResult } from "#src/runner/types.js";
import { addUsage, ZERO_USAGE, type Usage } from "#src/runner/usage.js";

const MAX_STEPS = 24;
const MAX_FILE_CHARS = 60_000;
const LIST_LIMIT = 200;
const ERROR_TAIL = 300;
const LIST_TIMEOUT_MS = 1500;

/** Where each local server listens: Ollama on 11434 (or OLLAMA_HOST), LM Studio on 1234. */
export function localBase(prefix: string): string {
  if (prefix === "lmstudio") return (process.env.LMSTUDIO_HOST || "http://127.0.0.1:1234").replace(/\/$/, "");
  const host = process.env.OLLAMA_HOST || "127.0.0.1:11434";
  return (/^https?:\/\//.test(host) ? host : `http://${host}`).replace(/\/$/, "");
}

/** Models the local server has, by id; empty when it is not running. */
export async function localModels(prefix: string): Promise<string[]> {
  try {
    const response = await fetch(`${localBase(prefix)}/v1/models`, { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
    return response.ok ? asArray(asRecord(await response.json()).data).map((m) => str(asRecord(m).id)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

const fn = (name: string, description: string, properties: Json) => ({ type: "function", function: { name, description, parameters: { type: "object", properties, required: Object.keys(properties) } } });
const PATH = { path: { type: "string", description: "Path relative to the project folder" } };

/** The tools a local model gets: read and list for everyone, write for builders. No shell. */
function toolsFor(req: RunRequest): object[] {
  if (req.tools.length === 0) return [];
  const read = [fn("read_file", "Read a text file", PATH), fn("list_files", "List a folder", PATH)];
  return writes(req) ? [...read, fn("write_file", "Write a whole file", { ...PATH, content: { type: "string", description: "The complete new content" } })] : read;
}

/** A path inside the story's folder, or null for one that leaves it. */
function inside(cwd: string, path: string): string | null {
  const full = resolve(cwd, path);
  const rel = relative(cwd, full);
  return rel.startsWith("..") || isAbsolute(rel) ? null : full;
}

function useTool(cwd: string, name: string, args: Json): string {
  const path = inside(cwd, str(args.path) || ".");
  if (!path) return "Refused: that path is outside the project folder.";
  if (name === "list_files") return existsSync(path) ? readdirSync(path).slice(0, LIST_LIMIT).join("\n") : "No such folder.";
  if (name === "read_file") return existsSync(path) ? readFileSync(path, "utf8").slice(0, MAX_FILE_CHARS) : "No such file.";
  if (name !== "write_file") return `Unknown tool ${name}.`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, str(args.content));
  return "Written.";
}

function usageOf(body: Json): Usage {
  const u = asRecord(body.usage);
  const cached = num(asRecord(u.prompt_tokens_details).cached_tokens);
  return { input: num(u.prompt_tokens) - cached, output: num(u.completion_tokens), cacheRead: cached, cacheWrite: 0, cost: 0 };
}

async function complete(req: RunRequest, messages: Json[]): Promise<Json> {
  const ref = parseRef(req.model);
  const tools = toolsFor(req);
  const response = await fetch(`${localBase(ref.prefix)}/v1/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json" }, signal: req.signal,
    body: JSON.stringify({ model: ref.id, messages, stream: false, ...(tools.length ? { tools } : {}) }),
  });
  if (!response.ok) throw new Error(`${ref.prefix} answered ${response.status}: ${(await response.text()).slice(0, ERROR_TAIL)}`);
  return asRecord(await response.json());
}

/** Runs the model's tool calls and appends their results; true when there were any. */
function answerTools(req: RunRequest, message: Json, step: { messages: Json[]; onEvent: (e: RunEvent) => void }): boolean {
  const calls = asArray(message.tool_calls).map(asRecord);
  calls.forEach((call) => {
    const f = asRecord(call.function);
    const args = asRecord(typeof f.arguments === "string" ? safeJson(f.arguments) : f.arguments);
    step.onEvent({ kind: "tool", name: str(f.name).replace(/_file$|_files$/, ""), detail: oneLine(args.path ?? "") });
    step.messages.push({ role: "tool", tool_call_id: str(call.id), content: useTool(req.cwd, str(f.name), args) });
  });
  return calls.length > 0;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/**
 * A model served by Ollama or LM Studio on this machine, through their OpenAI-compatible API:
 * `ollama/qwen3:8b`, `lmstudio/qwen3-coder-30b`. Free, private, and small: fit for scoring,
 * reviews of a diff and small stories, with tools to read, list and (for builders) write files.
 */
export const runLocal: Runner = async (req, onEvent) => {
  const messages: Json[] = [{ role: "system", content: readFileSync(req.systemFile, "utf8") }, { role: "user", content: withSkillNote(req.prompt, req.skills) }];
  const result: RunResult = { text: "", usage: ZERO_USAGE, turns: 0 };
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const body = await complete(req, messages);
    const message = asRecord(asRecord(asArray(body.choices)[0]).message);
    result.usage = addUsage(result.usage, usageOf(body));
    result.turns += 1;
    messages.push(message);
    if (answerTools(req, message, { messages, onEvent })) continue;
    result.text = str(message.content);
    onEvent({ kind: "text", delta: result.text });
    return result;
  }
  throw new Error(`${req.model} was still calling tools after ${MAX_STEPS} steps.`);
};
