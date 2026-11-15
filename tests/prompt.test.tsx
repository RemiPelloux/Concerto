import { EventEmitter } from "node:events";
import { render } from "ink";
import { describe, expect, it, vi } from "vitest";
import { SessionLog } from "#src/engine/session-log.js";
import type { Runner, RunRequest } from "#src/runner/types.js";
import { Store } from "#src/state/store.js";
import { App } from "#src/ui/App.js";
import { CATALOG, PLAN_REPLY, scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

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

const ENTER = "\r";
const is = (role: string) => (r: RunRequest) => r.systemFile.includes(`${role}-`);

/** Builders wait until `release()`, so the test can type while a build is in progress. */
function gatedRunner() {
  let release = () => undefined as void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const scripted = scriptedRunner((r) => {
    if (is("scorer")(r)) return PLAN_REPLY;
    if (is("critic")(r)) return "VERDICT: pass\nchecked";
    if (is("conductor")(r)) return "VERDICT: ok\nfine";
    return "STATUS: done\nchanged it";
  });
  const runner: Runner = async (req, onEvent) => {
    if (!is("scorer")(req) && !is("critic")(req) && !is("conductor")(req)) await gate;
    return scripted.runner(req, onEvent);
  };
  return { calls: scripted.calls, runner, release };
}

function mount(runner: Runner) {
  const store = new Store();
  const cwd = tempDir();
  const terminal = new Terminal();
  const keyboard = new Keyboard();
  const deps = { config: testConfig(), catalog: CATALOG, store, runner, cwd, autoPerform: false, initialRequest: "add health and auth", showTour: false, onExit: () => undefined, log: new SessionLog(cwd) };
  const app = render(<App {...deps} />, { stdout: terminal as never, stdin: keyboard as never, debug: true, patchConsole: false, exitOnCtrlC: false });
  const type = (text: string) => {
    keyboard.press(text);
    keyboard.press(ENTER);
  };
  return { app, store, keyboard, type, screen: () => terminal.frames.at(-1) ?? "" };
}

describe("the prompt in every phase", () => {
  it("re-plans a waiting plan with a typed change; an empty Enter builds", async () => {
    const gated = gatedRunner();
    const { app, store, type, keyboard } = mount(gated.runner);
    await vi.waitFor(() => expect(store.get().phase).toBe("planned"), { timeout: 5000 });
    type("keep the routes public");
    await vi.waitFor(() => expect(gated.calls.filter(is("scorer"))).toHaveLength(2), { timeout: 5000 });
    await vi.waitFor(() => expect(store.get().phase).toBe("planned"), { timeout: 5000 });
    expect(store.get().prompt).toBe("add health and auth\n\nChange: keep the routes public");
    expect(gated.calls.filter(is("scorer")).at(-1)?.prompt).toContain("Change: keep the routes public");
    keyboard.press(ENTER);
    await vi.waitFor(() => expect(store.get().phase).toBe("running"), { timeout: 5000 });
    gated.release();
    await vi.waitFor(() => expect(store.get().phase).toBe("done"), { timeout: 5000 });
    app.unmount();
  });

  it("during a build, text becomes a note for the agents and commands still work, except the disruptive ones", async () => {
    const gated = gatedRunner();
    const { app, store, type, keyboard, screen } = mount(gated.runner);
    await vi.waitFor(() => expect(store.get().phase).toBe("planned"), { timeout: 5000 });
    keyboard.press(ENTER);
    await vi.waitFor(() => expect(store.get().phase).toBe("running"), { timeout: 5000 });
    type("prefer the existing router");
    await vi.waitFor(() => expect(store.get().notes).toContain("From the user, during the run: prefer the existing router"));
    expect(store.get().log.at(-1)).toMatchObject({ label: "You", detail: "prefer the existing router", result: "noted" });
    type("/clear");
    await vi.waitFor(() => expect(screen()).toContain("A run is going. Press Esc to stop it first"));
    expect(store.get().phase).toBe("running");
    type("/budget 5");
    await vi.waitFor(() => expect(screen()).toContain("Budget: $5.00 per run."));
    gated.release();
    await vi.waitFor(() => expect(store.get().phase).toBe("done"), { timeout: 5000 });
    expect(gated.calls.filter((r) => !is("scorer")(r) && !is("conductor")(r)).some((r) => r.prompt.includes("prefer the existing router"))).toBe(true);
    app.unmount();
  });
});

describe("typed text that carries its own Enter", () => {
  it("submits what comes before a newline in one chunk and keeps the rest", async () => {
    const { splitTyped } = await import("#src/ui/PromptBar.js");
    expect(splitTyped("also ", "export it\r")).toEqual({ keep: "", submit: "also export it" });
    expect(splitTyped("", "first line\nsecond line\r")).toEqual({ keep: "", submit: "first line second line" });
    expect(splitTyped("", "send this\rthen")).toEqual({ keep: "then", submit: "send this" });
    expect(splitTyped("", "\n")).toEqual({ keep: "", submit: "" });
    expect(splitTyped("abc", "d")).toEqual({ keep: "abcd", submit: null });
  });

  it("re-plans when the change and its Enter arrive in a single chunk, as when pasting", async () => {
    const gated = gatedRunner();
    const { app, store, keyboard } = mount(gated.runner);
    await vi.waitFor(() => expect(store.get().phase).toBe("planned"), { timeout: 5000 });
    keyboard.press("keep the routes public\r");
    await vi.waitFor(() => expect(store.get().prompt).toBe("add health and auth\n\nChange: keep the routes public"), { timeout: 5000 });
    app.unmount();
  });
});
