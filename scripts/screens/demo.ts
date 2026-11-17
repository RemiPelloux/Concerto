/**
 * The demo the screenshots are taken from: a small shop repository, a four-story request, models
 * across vendors, and stand-in agents that write real code. Nothing here calls a model.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ConcertoConfig } from "#src/config/types.js";
import { Catalog } from "#src/models/catalog.js";
import type { RunEvent } from "#src/runner/events.js";
import { parseRef, type RunRequest, type RunResult } from "#src/runner/types.js";
import { testConfig } from "#tests/fixtures.js";

export const REQUEST = "Rate-limit the login route, show the remaining quota on the account page, add a /health endpoint, and document the limits";

/** Each demo model's tier and price per million tokens, in and out. */
const MODELS: Record<string, { tier: number; input: number; output: number }> = JSON.parse(readFileSync(new URL("demo-models.json", import.meta.url), "utf8"));
const PRICE_SCALE = { cacheRead: 0.1, cacheWrite: 1.25 };
/** Subscription models cost a quarter of their API price; local ones cost what they cost. */
const SUBSCRIPTION_FACTOR = 0.25;
const TIER = { top: 4, mid: 3, local: 1 };
const MAX_COMPLEXITY = 5;

export const CATALOG = new Catalog(Object.entries(MODELS).map(([ref, { tier, input, output }]) => ({
  ref, parsed: parseRef(ref), tier, costFactor: ref.startsWith("ollama") ? 1 : SUBSCRIPTION_FACTOR,
  price: { input, output, cacheRead: input * PRICE_SCALE.cacheRead, cacheWrite: input * PRICE_SCALE.cacheWrite },
})));

export function demoConfig(): ConcertoConfig {
  const base = testConfig();
  const role = (minTier: number, models: string[], tools: string[] = ["read", "grep"]) => ({ minTier, effort: "medium" as const, tools, models });
  return {
    ...base,
    models: Object.fromEntries(Object.entries(MODELS).map(([ref, { tier }]) => [ref, { tier }])),
    roles: {
      conductor: role(TIER.top, ["claude-code/claude-opus-5-5"]), rewriter: role(TIER.mid, ["claude-code/claude-sonnet-5-5"]),
      scorer: role(TIER.mid, ["claude-code/claude-sonnet-5-5"]),
      soloist: role(TIER.top, ["codex/gpt-6.1-sol"], ["read", "edit", "write", "bash"]), critic: role(TIER.mid, ["gemini/gemini-3-pro", "claude-code/claude-sonnet-5-5"]),
      section: role(TIER.local, ["claude-code/claude-haiku-5-5"], ["read", "edit", "write", "bash"]),
    },
    routes: [
      { name: "security", tags: ["auth", "security"], minScore: 0, maxScore: 101, role: "soloist", models: ["codex/gpt-6.1-sol", "claude-code/claude-opus-5-5"], effort: "auto" },
      { name: "small", tags: [], minScore: 0, maxScore: 25, role: "section", models: ["ollama/qwen3:8b", "claude-code/claude-haiku-5-5"], effort: "auto" },
    ],
  };
}

const FILES: Record<string, string> = {
  "src/auth/login.ts": "import { verify } from './password.js';\n\nexport async function login(req: Request): Promise<Response> {\n  const { email, password } = await req.json();\n  if (!(await verify(email, password))) return new Response('no', { status: 401 });\n  return new Response('ok');\n}\n",
  "src/auth/password.ts": "export async function verify(email: string, password: string): Promise<boolean> {\n  return email.length > 0 && password.length >= 12;\n}\n",
  "src/account/page.tsx": "import { login } from '../auth/login.js';\n\nexport function AccountPage({ user }: { user: { email: string } }) {\n  return `<h1>${user.email}</h1>`;\n}\n",
  "src/server.ts": "import { login } from './auth/login.js';\n\nexport const routes = { '/login': login };\n",
  "tests/login.test.ts": "import { login } from '../src/auth/login.js';\n",
  "README.md": "# Shop\n",
};

/** The demo repository, committed, with its files and tests. */
export function demoRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), "concerto-demo-"));
  Object.entries(FILES).forEach(([path, text]) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  });
  const git = (...args: string[]) => execFileSync("git", args, { cwd, stdio: "ignore" });
  git("init", "-q");
  git("add", ".");
  git("-c", "user.email=demo@localhost", "-c", "user.name=demo", "commit", "-qm", "shop");
  return cwd;
}

const story = (id: string, title: string, s: { files: string[]; tags: string[]; points: number; risk: number; acceptance: string[] }) => ({ id, title, asA: "a shop owner", iWant: `to ${title[0]?.toLowerCase() ?? ""}${title.slice(1)}`, soThat: "the shop stays up and honest", complexity: Math.min(MAX_COMPLEXITY, s.points), value: 4, uncertainty: 2, ...s });

export const PLAN = JSON.stringify({
  summary: "Protect login, show quotas, add health checks and docs",
  stories: [
    story("limit", "Rate-limit the login route", { files: ["src/auth/login.ts", "src/server.ts"], tags: ["auth", "security"], points: 5, risk: 5, acceptance: ["5 failed logins in a minute return 429", "the counter resets after a minute", "a test covers both"] }),
    story("quota", "Show the remaining login quota", { files: ["src/account/page.tsx"], tags: ["ui"], points: 3, risk: 2, acceptance: ["the account page shows tries left", "it reads the same counter"] }),
    story("health", "Add a /health endpoint", { files: ["src/server.ts"], tags: ["backend"], points: 1, risk: 1, acceptance: ["GET /health returns 200 and the version"] }),
    story("docs", "Document the login limits", { files: ["README.md"], tags: ["docs"], points: 1, risk: 1, acceptance: ["README says how many tries and for how long"] }),
  ].map((s) => ({ ...s, dependsOn: s.id === "quota" ? ["limit"] : [] })),
});

/** What each story's builder writes: real code, so the diff and the changes table have something to show. */
const WORK: Record<string, [string, string]> = {
  limit: ["src/auth/login.ts", "import { verify } from './password.js';\nimport { hit, remaining } from './limiter.js';\n\nconst WINDOW_MS = 60_000;\nconst MAX_TRIES = 5;\n\nexport async function login(req: Request): Promise<Response> {\n  const { email, password } = await req.json();\n  if (remaining(email, { max: MAX_TRIES, windowMs: WINDOW_MS }) === 0) return new Response('too many tries', { status: 429 });\n  if (!(await verify(email, password))) {\n    hit(email);\n    return new Response('no', { status: 401 });\n  }\n  return new Response('ok');\n}\n"],
  quota: ["src/account/page.tsx", "import { remaining } from '../auth/limiter.js';\n\nexport function AccountPage({ user }: { user: { email: string } }) {\n  const left = remaining(user.email, { max: 5, windowMs: 60_000 });\n  return `<h1>${user.email}</h1><p>${left} login tries left this minute</p>`;\n}\n"],
  health: ["src/health.ts", "import { version } from '../package.json' with { type: 'json' };\n\nexport const health = () => Response.json({ ok: true, version });\n"],
  docs: ["README.md", "# Shop\n\n## Login limits\n\nFive failed logins in a minute lock the account for the rest of that minute.\n"],
};

/** What a builder does on screen, in order: read, search, write, test, and say what it found. */
function steps(file: string): [string, string][] {
  return [
    ["read", file], ["grep", "verify("], ["read", "tests/login.test.ts"],
    ["say", "The login route has no limit; I'll count failures per email in a small module."],
    ["write", "src/auth/limiter.ts"], ["edit", file], ["write", "tests/limiter.test.ts"],
    ["bash", "pnpm test -- login limiter"], ["say", "✓ 5 failed logins in a minute return 429"], ["say", "✓ the counter resets after 60 s"],
  ];
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const STEP_MS = 120;

/** Stand-in agents: each role answers in character, builders stream a few tool calls and write their story's file. */
export function demoRunner(hold: Promise<void>) {
  return async (req: RunRequest, onEvent: (e: RunEvent) => void): Promise<RunResult> => {
    const role = /(scorer|critic|conductor)-/.exec(req.systemFile)?.[1] ?? "builder";
    const usage = { input: 1800, output: 420, cacheRead: 14_000, cacheWrite: 0, cost: 0 };
    const say = (text: string) => (onEvent({ kind: "text", delta: `${text.split("\n").at(-1) ?? ""}\n` }), { text, usage, turns: 1 });
    if (role === "scorer") return say(`${PLAN}\nFour stories; the login limit first.`);
    if (role === "conductor") return say("VERDICT: ok\nThe plan covers the request; limit before quota.");
    if (role === "critic") return say("VERDICT: pass\nTests cover the 429 path and the reset.");
    const id = Object.keys(WORK).find((k) => req.prompt.includes(`## Story ${k}:`)) ?? "health";
    const [file, text] = WORK[id] ?? ["x", ""];
    for (const [name, detail] of steps(file)) {
      onEvent(name === "say" ? { kind: "text", delta: `${detail}\n` } : { kind: "tool", name, detail });
      await pause(STEP_MS);
    }
    onEvent({ kind: "text", delta: `Wrote ${file}; tests pass locally.\n` });
    await hold;
    mkdirSync(dirname(join(req.cwd, file)), { recursive: true });
    writeFileSync(join(req.cwd, file), text);
    return { text: "STATUS: done\nImplemented and tested.", usage, turns: 3 };
  };
}
