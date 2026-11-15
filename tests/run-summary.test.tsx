import { EventEmitter } from "node:events";
import { render } from "ink";
import { describe, expect, it, vi } from "vitest";
import { SessionLog } from "#src/engine/session-log.js";
import type { RunRequest } from "#src/runner/types.js";
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
const story = (id: string) => (r: RunRequest) => (r.session?.id ?? "").includes(id) || r.prompt.includes(`## Story ${id}:`);
const builds = (id: string) => (r: RunRequest) => !is("critic")(r) && !is("conductor")(r) && !is("scorer")(r) && story(id)(r);

describe("end of a run", () => {
  it("says what passed, why the rest failed, and retries only those on Enter", async () => {
    let authFails = true;
    const scripted = scriptedRunner((r) => {
      if (is("scorer")(r)) return PLAN_REPLY;
      if (is("critic")(r)) return authFails && story("auth")(r) ? "VERDICT: fail\nadmin routes still answer 200 without a token" : "VERDICT: pass\nchecked";
      if (is("conductor")(r)) return "VERDICT: ok\nfine";
      return "STATUS: done\nchanged it";
    });
    const store = new Store();
    const cwd = tempDir();
    const terminal = new Terminal();
    const keyboard = new Keyboard();
    const deps = { config: testConfig(), catalog: CATALOG, store, runner: scripted.runner, cwd, autoPerform: false, initialRequest: "add health and auth", showTour: false, onExit: () => undefined, log: new SessionLog(cwd) };
    const app = render(<App {...deps} />, { stdout: terminal as never, stdin: keyboard as never, debug: true, patchConsole: false, exitOnCtrlC: false });
    const screen = () => terminal.frames.at(-1) ?? "";
    await vi.waitFor(() => expect(store.get().phase).toBe("planned"), { timeout: 5000 });
    keyboard.press(ENTER);
    await vi.waitFor(() => expect(store.get().phase).toBe("failed"), { timeout: 5000 });
    await vi.waitFor(() => expect(screen()).toContain("Run finished · 1 of 2 stories passed · 1 did not"));
    expect(screen()).toContain("admin routes still answer 200 without a token");
    expect(screen()).toContain("enter retries the 1 story that did not pass");

    const routeBuilds = scripted.calls.filter(builds("route")).length;
    authFails = false;
    keyboard.press(ENTER);
    await vi.waitFor(() => expect(store.get().phase).toBe("done"), { timeout: 5000 });
    expect(scripted.calls.filter(builds("route"))).toHaveLength(routeBuilds);
    await vi.waitFor(() => expect(screen()).toContain("Run finished · all 2 stories passed"));
    app.unmount();
  });
});
