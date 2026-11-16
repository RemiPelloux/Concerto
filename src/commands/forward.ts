import { spawn } from "node:child_process";
import { connect, createServer } from "node:net";

/**
 * `concerto --sandbox-forward <port> <socket> -- <agent> <args…>`, run by the Linux sandbox: the
 * sandbox has no network, so a local port relays to Concerto's proxy socket, then the agent starts
 * with stdio passed through. Exits with the agent's code.
 */
export async function forward(argv: string[]): Promise<void> {
  const [port = "", socket = "", , bin = "", ...args] = argv;
  const server = createServer((client) => {
    const upstream = connect(socket);
    const close = () => [client, upstream].forEach((s) => s.destroy());
    client.pipe(upstream).on("error", close);
    upstream.pipe(client).on("error", close);
    client.on("error", close);
    upstream.on("error", close);
  });
  await new Promise<void>((ready) => server.listen(Number(port), "127.0.0.1", ready));
  const child = spawn(bin, args, { stdio: "inherit" });
  child.on("error", (error) => {
    process.stderr.write(`concerto sandbox: ${error.message}\n`);
    process.exit(1);
  });
  child.on("exit", (code) => process.exit(code ?? 1));
}
