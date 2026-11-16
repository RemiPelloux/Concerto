import { connect, createServer, type Server, type Socket } from "node:net";

const HEADER_END = "\r\n\r\n";
const MAX_HEADER = 16_384;
const HTTPS_PORT = 443;
const HTTP_PORT = 80;

/** The model providers' own hosts: agents reach their models, and nothing else, unless allowed. */
export const PROVIDER_HOSTS = [
  "api.anthropic.com", "*.anthropic.com", "claude.ai", "*.claude.ai",
  "api.openai.com", "*.openai.com", "chatgpt.com", "*.chatgpt.com",
  "*.googleapis.com", "accounts.google.com",
  "*.cursor.sh", "*.cursor.com", "opencode.ai", "*.opencode.ai", "openrouter.ai",
  "api.deepseek.com", "api.x.ai", "api.mistral.ai", "api.groq.com", "models.dev",
];

/** `*.example.com` matches example.com's subdomains; anything else matches itself. */
export function allowed(host: string, patterns: readonly string[]): boolean {
  const h = host.toLowerCase();
  return patterns.some((p) => (p.startsWith("*.") ? h.endsWith(p.slice(1)) : h === p.toLowerCase()));
}

/** `CONNECT host:443 HTTP/1.1`, or `GET http://host/path HTTP/1.1`: where the client wants to go. */
export function target(head: string): { host: string; port: number; tunnel: boolean } | null {
  const [method = "", url = ""] = head.split("\r\n")[0]?.split(" ") ?? [];
  if (method === "CONNECT") {
    const [host = "", port = String(HTTPS_PORT)] = url.split(/:(?=\d+$)/);
    return host ? { host: host.replace(/^\[|\]$/g, ""), port: Number(port), tunnel: true } : null;
  }
  try {
    const u = new URL(url);
    return { host: u.hostname, port: Number(u.port || HTTP_PORT), tunnel: false };
  } catch {
    return null;
  }
}

function relay(client: Socket, head: Buffer, rule: { patterns: readonly string[]; blocked: (host: string) => void }): void {
  const to = target(head.toString("latin1"));
  if (!to || !allowed(to.host, rule.patterns)) {
    rule.blocked(to?.host ?? "(unreadable request)");
    return void client.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
  }
  const upstream = connect(to.port, to.host, () => {
    if (to.tunnel) client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    else upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  const close = () => [client, upstream].forEach((s) => s.destroy());
  upstream.on("error", close);
  client.on("error", close);
}

/**
 * An HTTP proxy that lets an agent reach its model provider and refuses every other host, telling
 * `blocked` which. Listens on a Unix socket (Linux: reached from inside the sandbox) or a local port.
 */
export function startProxy(listen: string | 0, rule: { patterns: readonly string[]; blocked: (host: string) => void }): Promise<{ server: Server; port: number }> {
  const server = createServer((client) => {
    let head = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);
      if (head.includes(HEADER_END)) {
        client.off("data", onData);
        relay(client, head, rule);
      } else if (head.length > MAX_HEADER) client.destroy();
    };
    client.on("data", onData);
    client.on("error", () => client.destroy());
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    const ready = () => resolve({ server, port: typeof listen === "string" ? 0 : (server.address() as { port: number }).port });
    if (typeof listen === "string") server.listen(listen, ready);
    else server.listen(0, "127.0.0.1", ready);
  });
}
