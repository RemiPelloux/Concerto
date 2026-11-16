import { EventEmitter } from "node:events";
import { readFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { render } from "ink";
import { describe, expect, it, vi } from "vitest";
import { readSession, saveSession } from "#src/engine/history.js";
import { readCalls, SessionLog } from "#src/engine/session-log.js";
import { renderShare, scrub, writeShare } from "#src/engine/share.js";
import { createConcert } from "#src/orchestrator/concert.js";
import { perform } from "#src/orchestrator/perform.js";
import { scoreRequest } from "#src/orchestrator/score.js";
import type { RunRequest } from "#src/runner/types.js";
import { Store } from "#src/state/store.js";
import { App } from "#src/ui/App.js";
import { CATALOG, expectOwnerOnly, scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

class Terminal extends EventEmitter {
  columns = 200;
  rows = 80;
  isTTY = true;
  frames: string[] = [];
  write(frame: string): boolean {
    this.frames.push(frame);
    return true;
  }
}

class Keyboard extends EventEmitter {
  isTTY = true;
  private queue: string[] = [];
  setRawMode(): void {}
  setEncoding(): void {}
  ref(): void {}
  unref(): void {}
  read(): string | null {
    return this.queue.shift() ?? null;
  }
  press(key: string): void {
    this.queue.push(key);
    this.emit("readable");
  }
}

const is = (role: string) => (r: RunRequest) => r.systemFile.includes(`${role}-`);
const story = (id: string, file: string) => ({ id, title: `Fix ${file}`, asA: "a user", iWant: id, soThat: "x", acceptance: [`${file} works`], points: 1, complexity: 1, risk: 1, value: 1, tags: [], files: [file] });
const answers = (plan: string) => (r: RunRequest) => (is("scorer")(r) ? plan : is("critic")(r) ? "VERDICT: pass\nok" : is("conductor")(r) ? "VERDICT: ok\nok" : "STATUS: done\nok");
const WEEK_AGO = Date.now() / 1000 - 7 * 24 * 3600;

/** A finished run, saved like a real session, its story failed or passed. */
async function savedRun(cwd: string, id: string, opts: { file: string; failed: boolean }): Promise<void> {
  const plan = JSON.stringify({ summary: `fix ${opts.file}`, stories: [story("fix", opts.file)] });
  const runner = scriptedRunner((r) => (is("critic")(r) && opts.failed ? "VERDICT: fail\nstill broken" : answers(plan)(r))).runner;
  const store = new Store();
  const c = await createConcert({ config: testConfig(), catalog: CATALOG, store, runner, cwd });
  await scoreRequest(c, `fix ${opts.file}`);
  await perform(c);
  saveSession(cwd, id, store.get());
}

function mount(cwd: string, runner: ReturnType<typeof scriptedRunner>["runner"]) {
  const store = new Store();
  const [terminal, keyboard] = [new Terminal(), new Keyboard()];
  const deps = { config: testConfig(), catalog: CATALOG, store, runner, cwd, autoPerform: false, initialRequest: "", showTour: false, onExit: () => undefined, log: new SessionLog(cwd) };
  const app = render(<App {...deps} />, { stdout: terminal as never, stdin: keyboard as never, debug: true, patchConsole: false, exitOnCtrlC: false });
  return { app, store, keyboard, screen: () => terminal.frames.at(-1) ?? "", log: deps.log };
}

describe("history, replay and sharing", () => {
  it("finds last week's failed run by a file name, reopens it as a branch, and rebuilds it", async () => {
    const cwd = tempDir();
    await savedRun(cwd, "s-lastweek-0001", { file: "src/billing.ts", failed: true });
    utimesSync(join(cwd, ".concerto", "logs", "s-lastweek-0001.json"), WEEK_AGO, WEEK_AGO);
    await savedRun(cwd, "s-today-0002", { file: "src/auth.ts", failed: false });
    const plan = JSON.stringify({ summary: "fix src/billing.ts", stories: [story("fix", "src/billing.ts")] });
    const ui = mount(cwd, scriptedRunner(answers(plan)).runner);
    ui.keyboard.press("/history billing.ts failed\r");
    await vi.waitFor(() => expect(ui.screen()).toContain("History matching \"billing.ts failed\""));
    expect(ui.screen()).toContain("s-lastweek-0001");
    expect(ui.screen()).not.toContain("s-today-0002");
    ui.keyboard.press("/history s-lastweek-0001\r");
    await vi.waitFor(() => expect(ui.store.get().phase).toBe("planned"));
    expect(ui.store.get().parent).toBe("s-lastweek-0001");
    // A slow runner can still be drawing the reopened plan when Enter arrives: press until it builds.
    await vi.waitFor(() => {
      if (ui.store.get().phase === "planned") ui.keyboard.press("\r");
      expect(ui.store.get().phase).not.toBe("planned");
    }, { timeout: 10_000, interval: 500 });
    await vi.waitFor(() => expect(ui.store.get().phase).toBe("done"), { timeout: 20_000 });
    expect(ui.store.get().stories.fix?.status).toBe("passed");
    expect(readSession(cwd, "s-lastweek-0001")?.stories.fix?.status).toBe("failed");
    ui.app.unmount();
  });

  it("records every model call and replays them one by one", async () => {
    const cwd = tempDir();
    const plan = JSON.stringify({ summary: "x", stories: [story("fix", "a.ts")] });
    const ui = mount(cwd, scriptedRunner(answers(plan)).runner);
    ui.keyboard.press("fix a.ts\r");
    await vi.waitFor(() => expect(ui.store.get().phase).toBe("planned"), { timeout: 5000 });
    ui.keyboard.press("\r");
    await vi.waitFor(() => expect(ui.store.get().phase).toBe("done"), { timeout: 5000 });
    const calls = readCalls(ui.log.callsPath);
    expect(calls.map((c) => c.role)).toEqual(["scorer", "conductor", "section", "critic", "conductor"]);
    expect(calls[2]?.prompt).toContain("## Story fix:");
    expect(calls[3]?.answer).toBe("VERDICT: pass\nok");
    ui.keyboard.press("/replay\r");
    await vi.waitFor(() => expect(ui.screen()).toContain("call 1/5"));
    ui.keyboard.press("\u001b[C");
    await vi.waitFor(() => expect(ui.screen()).toContain("call 2/5"));
    ui.app.unmount();
  });

  it("shares a run as one HTML page with anything secret-shaped redacted", () => {
    expect(scrub("key sk-ant-api03-abcdefghijklmnopqrstuv and ghp_ABCDEFGHIJKLMNOPQRSTUVWX1234")).toBe("key [redacted] and [redacted]");
    expect(scrub("DB password=hunter2xyz, api_key: \"abcd1234efgh\"")).toBe("DB password=[redacted], api_key: \"[redacted]\"");
    expect(scrub("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload")).toBe("Authorization: [redacted]");
    const state = new Store().get();
    const page = renderShare("s-1", { ...state, prompt: "deploy with token=abcdef123456 <script>", phase: "done" });
    expect(page).toContain("token=[redacted] &lt;script&gt;");
    expect(page).not.toContain("abcdef123456");
    const file = writeShare(tempDir(), "s-1", state);
    expect(readFileSync(file, "utf8")).toMatch(/^<!doctype html>/);
    expectOwnerOnly(file);
  });
});
