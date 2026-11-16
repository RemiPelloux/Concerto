import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { childEnv } from "#src/runner/env.js";

const POLL_MS = 250;
const MS_PER_SECOND = 1000;
const SHORT_HASH = 12;

/** As in the config: the command that starts the server (it must read PORT), and the routes to ask. */
export type Serve = { serve: string; routes: string[]; readySeconds: number };
export type RouteAnswer = { route: string; status: number; length: number; hash: string };
export type RouteChange = { route: string; before: RouteAnswer | null; after: RouteAnswer | null };

/** A port nothing listens on right now, from the system. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

/** Stops the server and what it started (dev servers spawn children): its process group, or the tree on Windows. */
function stop(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") return void spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

async function answer(port: number, route: string): Promise<RouteAnswer | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${route}`, { redirect: "manual" });
    const body = Buffer.from(await res.arrayBuffer());
    return { route, status: res.status, length: body.length, hash: createHash("sha256").update(body).digest("hex").slice(0, SHORT_HASH) };
  } catch {
    return null;
  }
}

async function ready(port: number, serve: Serve, child: ChildProcess): Promise<boolean> {
  const deadline = Date.now() + serve.readySeconds * MS_PER_SECOND;
  while (Date.now() < deadline && child.exitCode === null) {
    if (await answer(port, serve.routes[0] ?? "/")) return true;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return false;
}

/** Starts the server in `cwd` with PORT set, asks each route once, and stops it. Null: it never answered. */
export async function observe(cwd: string, serve: Serve): Promise<RouteAnswer[] | null> {
  const port = await freePort();
  const child = spawn(serve.serve, { cwd, shell: true, detached: process.platform !== "win32", env: { ...childEnv(), PORT: String(port) }, stdio: "ignore" });
  try {
    if (!(await ready(port, serve, child))) return null;
    return await Promise.all(serve.routes.map(async (route) => (await answer(port, route)) ?? { route, status: 0, length: 0, hash: "" }));
  } finally {
    stop(child);
  }
}

/** The routes whose status or body differ between the two runs. */
export function compareRoutes(before: RouteAnswer[], after: RouteAnswer[]): RouteChange[] {
  const old = new Map(before.map((a) => [a.route, a]));
  return after.flatMap((a) => {
    const b = old.get(a.route) ?? null;
    return b && b.status === a.status && b.hash === a.hash ? [] : [{ route: a.route, before: b, after: a }];
  });
}
