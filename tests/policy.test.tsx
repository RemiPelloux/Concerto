import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { render } from "ink";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bundledConfigPath, loadConfig, userConfigPath } from "#src/config/load.js";
import { notify, payload } from "#src/engine/notify.js";
import { SessionLog } from "#src/engine/session-log.js";
import { runHeadless } from "#src/headless.js";
import { blockedBy } from "#src/models/catalog.js";
import { createConcert } from "#src/orchestrator/concert.js";
import { rolesFor } from "#src/orchestrator/custom-roles.js";
import { gitEnv } from "#src/runner/env.js";
import type { RunRequest } from "#src/runner/types.js";
import { Store } from "#src/state/store.js";
import { App } from "#src/ui/App.js";
import { CATALOG, scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: gitEnv(), encoding: "utf8" });
const is = (r: RunRequest, role: string) => r.systemFile.includes(`${role}-`);
const PLAN = JSON.stringify({ summary: "deploy", stories: [{ id: "deploy", title: "Add a deploy step", asA: "an operator", iWant: "a deploy", soThat: "x", acceptance: ["deploys"], points: 2, complexity: 2, risk: 2, value: 2, tags: [], files: ["scripts/deploy.sh"] }] });

function repo(): string {
  const cwd = tempDir();
  git(cwd, "init", "-q");
  mkdirSync(join(cwd, "infra"));
  writeFileSync(join(cwd, "infra", "main.tf"), "resource {}\n");
  git(cwd, "add", ".");
  git(cwd, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  return cwd;
}

/** A builder that always edits infra/main.tf, whatever it is told. */
const stubborn = () => scriptedRunner((r) => {
  if (is(r, "scorer")) return PLAN;
  if (is(r, "critic")) return "VERDICT: pass\nok";
  if (is(r, "conductor")) return "VERDICT: ok\nok";
  writeFileSync(join(r.cwd, "infra", "main.tf"), "resource { changed = true }\n");
  writeFileSync(join(r.cwd, "deploy.sh"), "echo deploy\n");
  return "STATUS: done\nok";
});

const policyConfig = () => ({ ...testConfig(), policy: { protectedPaths: ["infra/"], blockedModels: [], requireReview: [] } });

class Terminal extends EventEmitter {
  columns = 160;
  rows = 60;
  isTTY = true;
  frames: string[] = [];
  write(frame: string): boolean {
    this.frames.push(frame);
    return true;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("a policy that forbids edits under infra/", () => {
  it("stops a story that keeps changing infra/, never merges it, and says why (CI)", async () => {
    const cwd = repo();
    const scripted = stubborn();
    const concert = await createConcert({ config: policyConfig(), catalog: CATALOG, store: new Store(), runner: scripted.runner, cwd });
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((line) => out.push(String(line)) > 0);
    await runHeadless(concert, "deploy", { log: { id: "s-1", shownPath: "log" }, json: true });
    vi.restoreAllMocks();
    expect(readFileSync(join(cwd, "infra", "main.tf"), "utf8")).toBe("resource {}\n");
    expect(existsSync(join(cwd, "deploy.sh"))).toBe(false);
    expect(concert.store.get().stories.deploy?.status).toBe("failed");
    const refused = out.map((l) => JSON.parse(l) as { type: string; label?: string; detail?: string }).filter((e) => e.label === "Policy");
    expect(refused[0]?.detail).toBe("Add a deploy step: changed infra/main.tf, protected by infra/");
    const builds = scripted.calls.filter((r) => !is(r, "scorer") && !is(r, "conductor") && !is(r, "critic"));
    expect(builds[0]?.prompt).toContain("## Project policy\nNever create, change or delete files matching: `infra/`");
    expect(builds[1]?.prompt).toContain("## The project's policy refused this change");
    expect(scripted.calls.some((r) => is(r, "critic"))).toBe(false);
  });

  it("shows the refusal in the TUI", async () => {
    const cwd = repo();
    const store = new Store();
    const terminal = new Terminal();
    const keyboard = Object.assign(new EventEmitter(), { isTTY: true, setRawMode: () => undefined, setEncoding: () => undefined, ref: () => undefined, unref: () => undefined, read: () => null });
    const deps = { config: policyConfig(), catalog: CATALOG, store, runner: stubborn().runner, cwd, autoPerform: true, initialRequest: "deploy", showTour: false, onExit: () => undefined, log: new SessionLog(cwd) };
    const app = render(<App {...deps} />, { stdout: terminal as never, stdin: keyboard as never, debug: true, patchConsole: false, exitOnCtrlC: false });
    await vi.waitFor(() => expect(store.get().phase).toBe("failed"), { timeout: 20_000 });
    await vi.waitFor(() => expect(terminal.frames.at(-1)).toMatch(/policy: infra\/main\.tf may not be changed/));
    app.unmount();
  });
});

describe("shared configuration", () => {
  it("merges the project's config over the personal one, and caps any budget at the policy's", () => {
    const personal = JSON.parse(readFileSync(bundledConfigPath(), "utf8")) as Record<string, unknown>;
    mkdirSync(dirname(userConfigPath()), { recursive: true });
    writeFileSync(userConfigPath(), JSON.stringify({ ...personal, budgetUsd: 50, prefer: ["ce-*"] }));
    const cwd = tempDir();
    writeFileSync(join(cwd, "concerto.config.json"), JSON.stringify({ routes: [], policy: { maxRunUsd: 10, protectedPaths: ["infra/"] }, swarm: { maxParallel: 1 } }));
    const config = loadConfig(cwd);
    expect(config.prefer).toEqual(["ce-*"]);
    expect(config.models).toEqual((personal as { models: object }).models);
    expect(config.routes).toEqual([]);
    expect(config.swarm.maxParallel).toBe(1);
    expect(config.budgetUsd).toBe(10);
    expect(config.policy.protectedPaths).toEqual(["infra/"]);
    writeFileSync(join(cwd, "concerto.config.json"), JSON.stringify({ policy: { requireReview: [{ paths: ["src/auth/**"], role: "security" }] } }));
    expect(() => loadConfig(cwd)).toThrow(/no custom review role named security/);
  });

  it("blocks models by ref or prefix, and forces a required review on its paths", async () => {
    expect(["ollama/qwen3", "a/brain", "a/builder"].filter((r) => blockedBy(["ollama/*", "a/brain"], r))).toEqual(["ollama/qwen3", "a/brain"]);
    const security = { name: "security", kind: "review" as const, instructions: "x", tags: ["never"], paths: [], minScore: 100, models: [], minTier: 3, effort: "low" as const };
    const config = { ...testConfig(), customRoles: [security], policy: { protectedPaths: [], blockedModels: [], requireReview: [{ paths: ["src/auth/**"], role: "security" }] } };
    const c = await createConcert({ config, catalog: CATALOG, store: new Store(), runner: stubborn().runner, cwd: tempDir() });
    const story = (files: string[]) => ({ id: "s", title: "s", asA: "a", iWant: "b", soThat: "c", acceptance: [], points: 1, complexity: 1, risk: 1, value: 1, uncertainty: 1, tags: [], dependsOn: [], files, checks: [] });
    expect(rolesFor(c, story(["src/auth/login.ts"]), "review").map((r) => r.name)).toEqual(["security"]);
    expect(rolesFor(c, story(["src/ui/x.ts"]), "review")).toEqual([]);
  });
});

describe("notifications", () => {
  it("posts each service's own body, reads URLs from the environment, and never throws", async () => {
    const bodies: unknown[] = [];
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString()));
      req.on("end", () => {
        bodies.push(JSON.parse(raw));
        res.end("ok");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    vi.stubEnv("HOOK", `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`);
    const event = { on: "done" as const, title: "Concerto finished: deploy", text: "1/1 stories passed", details: { costUsd: 0.4 } };
    const failures = await notify([{ kind: "slack", url: "${HOOK}", on: ["done"] }, { kind: "webhook", url: "${HOOK}", on: ["done"] }, { kind: "discord", url: "${HOOK}", on: ["failed"] }, { kind: "webhook", url: "http://127.0.0.1:9/down", on: ["done"] }], event);
    server.close();
    expect(bodies).toContainEqual({ text: "*Concerto finished: deploy*\n1/1 stories passed" });
    expect(bodies).toContainEqual({ event: "done", title: "Concerto finished: deploy", text: "1/1 stories passed", costUsd: 0.4 });
    expect(bodies).toHaveLength(2);
    expect(failures).toHaveLength(1);
    expect(payload("discord", event)).toEqual({ content: "**Concerto finished: deploy**\n1/1 stories passed" });
  });
});
