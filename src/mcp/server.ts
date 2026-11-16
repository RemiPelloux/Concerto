import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { asRecord, str, type Json } from "#src/runner/json.js";

/** The newest MCP revision this server speaks; a client asking for another gets this one. */
const PROTOCOL = "2025-06-18";
const METHOD_NOT_FOUND = -32601;
const PARSE_ERROR = -32700;

/** `progress` reports a step of a long call to the client, when it asked for progress. */
export type Progress = (message: string) => void;
export type Tool = {
  name: string;
  description: string;
  inputSchema: Json;
  run: (args: Json, progress: Progress) => Promise<string>;
};
export type Server = { name: string; version: string; tools: readonly Tool[]; input: Readable; output: Writable };

type Message = { id?: string | number | null; method?: string; params?: Json };

function send(out: Writable, message: object): void {
  out.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

/** One `tools/call`: the tool's text, or its error as a tool result the calling agent can read. */
async function callTool(server: Server, params: Json): Promise<object> {
  const tool = server.tools.find((t) => t.name === params.name);
  if (!tool) return { content: [{ type: "text", text: `No tool named ${str(params.name)}.` }], isError: true };
  const token = asRecord(params._meta).progressToken;
  let step = 0;
  const progress: Progress = (message) => {
    if (token !== undefined) send(server.output, { method: "notifications/progress", params: { progressToken: token, progress: (step += 1), message } });
  };
  try {
    return { content: [{ type: "text", text: await tool.run(asRecord(params.arguments), progress) }] };
  } catch (error) {
    return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
}

async function answer(server: Server, m: Message): Promise<object | null> {
  if (m.method === "initialize") {
    return { protocolVersion: str(asRecord(m.params).protocolVersion) || PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: server.name, version: server.version } };
  }
  if (m.method === "ping") return {};
  if (m.method === "tools/list") return { tools: server.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
  if (m.method === "tools/call") return callTool(server, asRecord(m.params));
  return null;
}

/**
 * A Model Context Protocol server on stdio: newline-delimited JSON-RPC 2.0, tools only. Requests
 * are answered as they finish, so a long build does not hold up a status call. Resolves when the
 * client closes stdin.
 */
export function serve(server: Server): Promise<void> {
  return new Promise((resolve) => {
    const lines = createInterface({ input: server.input });
    lines.on("line", (line) => {
      if (!line.trim()) return;
      let m: Message;
      try {
        m = JSON.parse(line) as Message;
      } catch {
        return send(server.output, { id: null, error: { code: PARSE_ERROR, message: "Parse error" } });
      }
      if (m.id === undefined) return;
      void answer(server, m).then((result) => send(server.output, result ? { id: m.id, result } : { id: m.id, error: { code: METHOD_NOT_FOUND, message: `Unknown method ${m.method ?? ""}` } }));
    });
    lines.on("close", resolve);
  });
}
