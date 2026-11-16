import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { printCosts } from "#src/commands/costs.js";
import { runInOrca } from "#src/commands/orca.js";
import { parseRouting } from "#src/commands/setup.js";
import { parseConfig } from "#src/config/load.js";
import { startBranch } from "#src/engine/publish.js";
import { rejectHunk, rejectStory } from "#src/engine/review-work.js";
import { templateBrief } from "#src/engine/templates.js";
import { concertoTools } from "#src/mcp/tools.js";
import { catalogFor } from "#src/models/brain.js";
import { Catalog } from "#src/models/catalog.js";
import { updatePriceBook } from "#src/models/price-book.js";
import { roleChain } from "#src/models/router.js";
import { createConcert, type Concert } from "#src/orchestrator/concert.js";
import { editPlan } from "#src/orchestrator/edit.js";
import { askBuilder } from "#src/orchestrator/follow-up.js";
import { perform } from "#src/orchestrator/perform.js";
import { parsePlan } from "#src/orchestrator/plan.js";
import { parseRewrite } from "#src/orchestrator/rewrite.js";
import { applyEdit } from "#src/orchestrator/replan.js";
import { scoreRequest } from "#src/orchestrator/score.js";
import { gitEnv } from "#src/runner/env.js";
import { runLocal } from "#src/runner/local.js";
import { sandboxCommand, sandboxed } from "#src/runner/sandbox.js";
import { parseRef, type RunRequest } from "#src/runner/types.js";
import { Store } from "#src/state/store.js";
import { REVIEW_COMMANDS } from "#src/ui/review-commands.js";
import { CATALOG, PLAN_REPLY, scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

type Case = { doc: string; trigger: () => unknown; match: RegExp };

const DOCS = resolve("docs/failures.md");
const SRC = resolve("src");
const THROW = "throw new Error(";
const CLI_TIMEOUT_MS = 20_000;

afterEach(() => vi.unstubAllEnvs());

/** Our environment without PATH under any spelling (Windows also has Path), so the PATH we pass wins. */
function baseEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH"));
}

/** Runs the real CLI in an empty folder with no agent CLI installed; its error line becomes a thrown Error. */
function cli(...args: string[]): void {
  const dir = tempDir();
  const result = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--conditions=source", resolve("src/cli.ts"), ...args], {
    cwd: dir, timeout: CLI_TIMEOUT_MS, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...baseEnv(), PATH: dir, CONCERTO_CONFIG: resolve("concerto.config.json"), CONCERTO_CLAUDE_BIN: "missing-claude",
      CONCERTO_CODEX_BIN: "missing-codex", CONCERTO_PI_BIN: "missing-pi", PI_AGENT_DIR: dir, XDG_CONFIG_HOME: dir, XDG_CACHE_HOME: dir },
  });
  if (result.error) throw result.error;
  if (result.status === 0) return;
  throw new Error((result.stderr.split("\n")[0] ?? "").replace(/^concerto: /, ""));
}

/** A stand-in for a third-party CLI: a Node script, started directly or through a .cmd shim on Windows. */
function fakeBin(name: string, script: string): string {
  const dir = tempDir();
  const js = join(dir, `${name}.js`);
  writeFileSync(js, script);
  if (process.platform === "win32") {
    writeFileSync(join(dir, `${name}.cmd`), `@"${process.execPath}" "${js}" %*\r\n`);
    return join(dir, `${name}.cmd`);
  }
  writeFileSync(join(dir, name), `#!${process.execPath}\n${script}`);
  chmodSync(join(dir, name), 0o700);
  return join(dir, name);
}

/** A fake Orca CLI that answers every command with this JSON line. */
function orcaAnswering(reply: object): Promise<void> {
  vi.stubEnv("ORCA_CLI_COMMAND", fakeBin("orca", `process.stdout.write(${JSON.stringify(JSON.stringify(reply))} + "\\n");\n`));
  return runInOrca("add a health endpoint");
}

/** Runs `use` against a local HTTP server standing in for Ollama, then closes it. */
async function withOllama(handler: RequestListener, use: () => Promise<unknown>): Promise<unknown> {
  const server = createServer(handler);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  vi.stubEnv("OLLAMA_HOST", `127.0.0.1:${(server.address() as AddressInfo).port}`);
  try {
    return await use();
  } finally {
    server.close();
  }
}

function localRequest(): RunRequest {
  const cwd = tempDir();
  writeFileSync(join(cwd, "system.md"), "You build.");
  return { model: "ollama/qwen3:8b", prompt: "Build it", systemFile: join(cwd, "system.md"), tools: ["read"], effort: "low", skills: [], cwd };
}

const callingTools: RequestListener = (req, res) => {
  req.resume();
  req.on("end", () => res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "list_files", arguments: "{\"path\":\".\"}" } }] } }] })));
};

/** Pretends to be another OS for one call: the sandbox chooses its tool by process.platform. */
async function onPlatform(platform: NodeJS.Platform, use: () => unknown): Promise<unknown> {
  const real = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  try {
    return await use();
  } finally {
    if (real) Object.defineProperty(process, "platform", real);
  }
}

/** Linux with no bwrap on PATH: the bubblewrap probe fails the way it does on a machine without it. */
function withoutBubblewrap(use: () => unknown): Promise<unknown> {
  vi.stubEnv("PATH", tempDir());
  return onPlatform("linux", use);
}

const noBlock = { allowHosts: [], hide: [], writable: [], blocked: () => undefined };

function concert(): Promise<Concert> {
  return createConcert({ config: testConfig(), catalog: CATALOG, store: new Store(), runner: scriptedRunner(() => PLAN_REPLY).runner, cwd: tempDir() });
}

async function planned(): Promise<Concert> {
  const c = await concert();
  await scoreRequest(c, "add a health endpoint");
  return c;
}

async function finished(): Promise<Concert> {
  const c = await concert();
  c.store.update(() => ({ phase: "done" }));
  return c;
}

function dirtyRepo(): string {
  const cwd = tempDir();
  execFileSync("git", ["init", "-q"], { cwd, env: gitEnv() });
  writeFileSync(join(cwd, "notes.txt"), "lying around");
  return cwd;
}

const onePlan = () => parsePlan(PLAN_REPLY);
const single = () => {
  const plan = onePlan();
  return { ...plan, stories: plan.stories.slice(0, 1) };
};
const tool = (name: string) => {
  const found = concertoTools(async () => Promise.reject(new Error("no run is opened in these cases"))).find((t) => t.name === name);
  if (!found) throw new Error(`no MCP tool ${name}`);
  return found;
};
const review = (name: string) => REVIEW_COMMANDS.find((c) => c.name === name)?.run("route", { concert: () => null, show: () => undefined });

const CASES: Case[] = [
  // Command line
  { doc: "--budget takes a positive number of dollars.", trigger: () => cli("--budget", "0"), match: /^--budget takes a positive number of dollars\.$/ },
  { doc: "--plan, --run and --plain need a request.", trigger: () => cli("--plan"), match: /^--plan, --run and --plain need a request\.$/ },
  { doc: "No saved session \"<id>\" in this project.", trigger: () => cli("--share", "s-nope"), match: /^No saved session "s-nope" in this project\.$/ },
  { doc: "--since takes a number of days.", trigger: () => printCosts({ since: "a week" }), match: /^--since takes a number of days\.$/ },
  { doc: "--routing must be one of: <choices>.", trigger: () => parseRouting("cheapest"), match: /^--routing must be one of: subscriptions, proxy, api\.$/ },
  { doc: "orca <command> <subcommand> failed: <error>", trigger: () => orcaAnswering({ ok: false, error: "not a repository" }), match: /^orca worktree create failed: "not a repository"$/ },
  { doc: "Orca did not return a worktree id.", trigger: () => orcaAnswering({ ok: true, result: { worktree: {} } }), match: /^Orca did not return a worktree id\.$/ },
  // Configuration
  { doc: "<file> was written by a newer Concerto (config version <n>; this one reads up to <max>). Update Concerto: concerto --update.", trigger: () => parseConfig({ ...testConfig(), version: 9 }, "new.json"), match: /^new\.json was written by a newer Concerto \(config version 9; this one reads up to 1\)\. Update Concerto: concerto --update\.$/ },
  { doc: "<file>: \"version\" must be a whole number, the config format it was written in.", trigger: () => parseConfig({ ...testConfig(), version: 1.5 }, "odd.json"), match: /^odd\.json: "version" must be a whole number/ },
  { doc: "invalid config in <file>: <field>: <problem>", trigger: () => parseConfig({ ...testConfig(), timeoutMinutes: "soon" }, "bad.json"), match: /^invalid config in bad\.json:\n {2}timeoutMinutes: / },
  { doc: "invalid config in <file>: policy.requireReview: no custom review role named <role> in customRoles", trigger: () => parseConfig({ ...testConfig(), policy: { protectedPaths: [], blockedModels: [], requireReview: [{ role: "security", paths: ["src/**"] }] } }, "team.json"), match: /^invalid config in team\.json:\n {2}policy\.requireReview: no custom review role named security in customRoles$/ },
  // Plans and edits
  { doc: "The rewriter did not return JSON.", trigger: () => parseRewrite("Sure, here is a better prompt."), match: /^The rewriter did not return JSON\.$/ },
  { doc: "The scorer did not return a JSON plan.", trigger: () => parsePlan("I would rather not."), match: /^The scorer did not return a JSON plan\.$/ },
  { doc: "Template names are lowercase letters, digits and dashes, 48 at most.", trigger: () => templateBrief("My Template"), match: /^Template names are lowercase letters, digits and dashes, 48 at most\.$/ },
  { doc: "No template \"<name>\". Saved: <templates>.", trigger: () => templateBrief("api-endpoint"), match: /^No template "api-endpoint"\. Saved: none\.$/ },
  { doc: "Edits change a plan waiting for Enter; there is none right now.", trigger: async () => applyEdit(await concert(), { kind: "drop", id: "route" }), match: /^Edits change a plan waiting for Enter; there is none right now\.$/ },
  { doc: "No story \"<id>\" in the plan. Ids: <ids>.", trigger: () => editPlan(onePlan(), { kind: "drop", id: "nope" }), match: /^No story "nope" in the plan\. Ids: route, auth\.$/ },
  { doc: "No story \"<id>\" in the plan.", trigger: async () => applyEdit(await planned(), { kind: "route", id: "nope", model: "a/brain" }), match: /^No story "nope" in the plan\.$/ },
  { doc: "A story cannot be merged into itself.", trigger: () => editPlan(onePlan(), { kind: "merge", id: "route", into: "route" }), match: /^A story cannot be merged into itself\.$/ },
  { doc: "\"<id>\" has one acceptance item: nothing to split it on.", trigger: () => editPlan(onePlan(), { kind: "split", id: "route" }), match: /^"route" has one acceptance item: nothing to split it on\.$/ },
  { doc: "A plan needs at least one story. Press Esc to discard it instead.", trigger: () => editPlan(single(), { kind: "drop", id: "route" }), match: /^A plan needs at least one story\. Press Esc to discard it instead\.$/ },
  { doc: "\"<model>\" is not a reachable model. /models lists them.", trigger: async () => applyEdit(await planned(), { kind: "route", id: "route", model: "x/nowhere" }), match: /^"x\/nowhere" is not a reachable model\. \/models lists them\.$/ },
  // Runs and reviews
  { doc: "Nothing to perform: score a request first.", trigger: async () => perform(await concert()), match: /^Nothing to perform: score a request first\.$/ },
  { doc: "--commit and --pr need a git repository with isolation on: a commit holds one story's merged files.", trigger: () => createConcert({ config: testConfig(), catalog: CATALOG, store: new Store(), runner: scriptedRunner(() => "").runner, cwd: tempDir(), commit: true }), match: /^--commit and --pr need a git repository with isolation on: a commit holds one story's merged files\.$/ },
  { doc: "--commit and --pr need a clean working tree; commit or stash first: <changed files>", trigger: () => startBranch(dirtyRepo(), "concerto/x"), match: /^--commit and --pr need a clean working tree; commit or stash first:\n\?\? notes\.txt$/ },
  { doc: "/ask sends a story back after a run; wait for this one to end.", trigger: async () => askBuilder(await planned(), "route", "use 204"), match: /^\/ask sends a story back after a run; wait for this one to end\.$/ },
  { doc: "No story \"<id>\" in this run.", trigger: async () => askBuilder(await finished(), "nope", "use 204"), match: /^No story "nope" in this run\.$/ },
  { doc: "There is no run in this session yet.", trigger: () => review("hunks"), match: /^There is no run in this session yet\.$/ },
  { doc: "Nothing merged for \"<story>\" in this run to take back.", trigger: () => rejectStory(tempDir(), { runId: "run-1", storyId: "route" }), match: /^Nothing merged for "route" in this run to take back\.$/ },
  { doc: "No hunk <n> in \"<story>\". /hunks <story> lists them.", trigger: () => rejectHunk(tempDir(), { runId: "run-1", storyId: "route", index: 3 }), match: /^No hunk 3 in "route"\. \/hunks route lists them\.$/ },
  { doc: "Unknown story \"<id>\".", trigger: () => new Store().view("ghost"), match: /^Unknown story "ghost"\.$/ },
  // Models and backends
  { doc: "The <role> needs a premium model (Claude Fable, Opus or Sonnet, GPT Astra or Sol) and none is reachable. Run /config auto.", trigger: () => catalogFor(new Catalog([{ ref: "x/claude-haiku-5-5", parsed: parseRef("x/claude-haiku-5-5"), tier: 2, price: null, costFactor: 1 }]), "critic"), match: /^The critic needs a premium model \(Claude Fable, Opus or Sonnet, GPT Astra or Sol\) and none is reachable\. Run \/config auto\.$/ },
  { doc: "No configured model is reachable. Run `concerto --models`.", trigger: () => roleChain(new Catalog([]), testConfig(), "conductor"), match: /^No configured model is reachable\. Run `concerto --models`\.$/ },
  { doc: "Model \"<ref>\" must look like <backend>/<model>.", trigger: () => parseRef("opus"), match: /^Model "opus" must look like <backend>\/<model>\.$/ },
  { doc: "<url> answered <status>.", trigger: () => updatePriceBook(async () => new Response("busy", { status: 503 }), join(tempDir(), "prices.json")), match: /^https:\/\/models\.dev\/api\.json answered 503\.$/ },
  { doc: "<backend> answered <status>: <body>", trigger: () => withOllama((_req, res) => res.writeHead(404).end("model \"qwen3:8b\" not found"), () => runLocal(localRequest(), () => undefined)), match: /^ollama answered 404: model "qwen3:8b" not found$/ },
  { doc: "<model> was still calling tools after 24 steps.", trigger: () => withOllama(callingTools, () => runLocal(localRequest(), () => undefined)), match: /^ollama\/qwen3:8b was still calling tools after 24 steps\.$/ },
  // Sandbox
  { doc: "The sandbox needs bubblewrap (bwrap) with user namespaces; install it, or set sandbox.enabled to false.", trigger: () => withoutBubblewrap(() => sandboxed({ bin: "pi", args: [], cwd: tempDir() }, noBlock)), match: /^The sandbox needs bubblewrap \(bwrap\) with user namespaces; install it, or set sandbox\.enabled to false\.$/ },
  { doc: "The sandbox runs on Linux (bubblewrap) and macOS (sandbox-exec); on this system set sandbox.enabled to false or run Concerto in its Docker image.", trigger: () => onPlatform("freebsd", () => sandboxed({ bin: "pi", args: [], cwd: tempDir() }, noBlock)), match: /^The sandbox runs on Linux \(bubblewrap\) and macOS \(sandbox-exec\); on this system set sandbox\.enabled to false or run Concerto in its Docker image\.$/ },
  { doc: "The sandbox runs on Linux (bubblewrap) and macOS (sandbox-exec).", trigger: () => onPlatform("freebsd", () => sandboxCommand("npm test", { cwd: tempDir(), hide: [] })), match: /^The sandbox runs on Linux \(bubblewrap\) and macOS \(sandbox-exec\)\.$/ },
  // MCP
  { doc: "\"<cwd>\" is not an absolute path to a folder.", trigger: () => tool("concerto_sessions").run({ cwd: "relative/path" }, () => undefined), match: /^"relative\/path" is not an absolute path to a folder\.$/ },
  { doc: "No saved plan \"<session>\" in <cwd>. concerto_sessions lists them.", trigger: () => tool("concerto_build").run({ session: "s-nope", cwd: tempDir() }, () => undefined), match: /^No saved plan "s-nope" in .+\. concerto_sessions lists them\.$/ },
  { doc: "No saved session \"<session>\" in <cwd>.", trigger: () => tool("concerto_status").run({ session: "s-nope", cwd: tempDir() }, () => undefined), match: /^No saved session "s-nope" in .+\.$/ },
];

/** The message of each row of docs/failures.md, without the code span around it. */
function documented(): string[] {
  return readFileSync(DOCS, "utf8").split(/\r?\n/).filter((line) => line.startsWith("| `")).map((line) => {
    const cell = line.slice("| ".length, line.indexOf(" | ", "| ".length));
    return cell.replace(/^(`+) ?(.*?) ?\1$/, "$2");
  });
}

/** Reads one `${…}` from `i` (just past the `${`), counting braces; returns where it ends. */
function skipExpression(text: string, i: number): number {
  let depth = 1;
  let at = i;
  for (; depth > 0 && at < text.length; at += 1) depth += text[at] === "{" ? 1 : text[at] === "}" ? -1 : 0;
  return at;
}

/** The literal parts of the string a throw starts with: quotes or a template, `${…}` and `\n` as breaks. */
function literalParts(text: string, start: number): string[] {
  const quote = text[start];
  if (quote !== "\"" && quote !== "`") return [];
  const parts = [""];
  for (let i = start + 1; i < text.length && text[i] !== quote; i += 1) {
    if (text[i] === "\\") {
      i += 1;
      parts.push(text[i] === "n" ? "" : `${parts.pop() ?? ""}${text[i] ?? ""}`);
    } else if (quote === "`" && text.startsWith("${", i)) {
      i = skipExpression(text, i + 2) - 1;
      parts.push("");
    } else parts.push(`${parts.pop() ?? ""}${text[i]}`);
  }
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Every `throw new Error(` in src/, with where it is and the literal parts of its message. */
function throwSites(): { at: string; parts: string[] }[] {
  const files = readdirSync(SRC, { recursive: true, encoding: "utf8" }).filter((f) => /\.tsx?$/.test(f));
  return files.flatMap((file) => {
    const text = readFileSync(join(SRC, file), "utf8");
    const sites: { at: string; parts: string[] }[] = [];
    for (let i = text.indexOf(THROW); i >= 0; i = text.indexOf(THROW, i + 1)) {
      sites.push({ at: `${file}:${text.slice(0, i).split("\n").length}`, parts: literalParts(text, i + THROW.length) });
    }
    return sites;
  });
}

/** Whether the row holds every part, in order. */
function holds(row: string, parts: string[]): boolean {
  let from = 0;
  for (const part of parts) {
    const at = row.indexOf(part, from);
    if (at < 0) return false;
    from = at + part.length;
  }
  return true;
}

describe("documented failure messages", () => {
  it.each(CASES)("$doc", async ({ trigger, match }) => {
    await expect(Promise.resolve().then(trigger)).rejects.toThrow(match);
  });

  it("has exactly one case for every row of docs/failures.md, and a row for every case", () => {
    const rows = documented();
    const docs = CASES.map((c) => c.doc);
    expect(new Set(rows).size).toBe(rows.length);
    expect(new Set(docs).size).toBe(docs.length);
    expect([...docs].sort()).toEqual([...rows].sort());
  });

  it("documents every error thrown in src/", () => {
    const rows = documented();
    const sites = throwSites();
    expect(sites.length).toBeGreaterThan(0);
    const undocumented = sites.filter((s) => s.parts.length === 0 || !rows.some((row) => holds(row, s.parts)));
    expect(undocumented).toEqual([]);
  });
});
