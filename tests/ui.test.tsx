import { EventEmitter } from "node:events";
import { setImmediate as nextTask } from "node:timers/promises";
import { render } from "ink";
import { Profiler } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Store } from "#src/state/store.js";
import { App, FRAME_MS } from "#src/ui/App.js";
import { SessionLog } from "#src/engine/session-log.js";
import { CATALOG, scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

const TOOL_EVENTS = 30;
const ESCAPE = "\u001b";

/** A roomy terminal that keeps every frame Ink writes. */
class Terminal extends EventEmitter {
  columns = 160;
  rows = 80;
  isTTY = true;
  frames: string[] = [];
  write(frame: string): boolean {
    this.frames.push(frame);
    return true;
  }
}

/** A raw-mode keyboard that hands Ink one queued key per readable event. */
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

function mount(store: Store) {
  const terminal = new Terminal();
  const keyboard = new Keyboard();
  const deps = { config: testConfig(), catalog: CATALOG, store, runner: scriptedRunner(() => "").runner, cwd: process.cwd(), autoPerform: false, initialRequest: "", showTour: false, onExit: () => undefined, log: new SessionLog(tempDir()) };
  const counter = { commits: 0 };
  const app = render(
    <Profiler id="app" onRender={() => void (counter.commits += 1)}>
      <App {...deps} />
    </Profiler>,
    { stdout: terminal as never, stdin: keyboard as never, debug: true, patchConsole: false, exitOnCtrlC: false },
  );
  return { app, terminal, keyboard, counter };
}

/** What the orchestrator does per tool event (src/orchestrator/call.ts), one event per task. */
async function toolBurst(store: Store): Promise<void> {
  for (let i = 0; i < TOOL_EVENTS; i += 1) {
    store.role("section", { note: `read src/file${i}.ts` });
    store.tool("read");
    await nextTask();
  }
}

async function nextFrame(): Promise<void> {
  vi.advanceTimersByTime(FRAME_MS);
  await nextTask();
}

afterEach(() => vi.useRealTimers());

describe("app rendering", () => {
  it("renders a burst of tool events once per frame, showing the latest note", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const store = new Store();
    const { app, terminal, counter } = mount(store);
    await nextFrame();
    counter.commits = 0;
    await toolBurst(store);
    expect(counter.commits).toBe(0);
    await nextFrame();
    expect(counter.commits).toBe(1);
    expect(terminal.frames.at(-1)).toContain(`read src/file${TOOL_EVENTS - 1}.ts`);
    app.unmount();
  });

  it("still renders every change that lands in a later frame", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const store = new Store();
    const { app, terminal, counter } = mount(store);
    await nextFrame();
    counter.commits = 0;
    store.role("section", { note: "first" });
    await nextFrame();
    store.role("section", { note: "second" });
    await nextFrame();
    expect(counter.commits).toBe(2);
    expect(terminal.frames.at(-1)).toContain("second");
    app.unmount();
  });

  it("reads the store at keypress time: escape drops a plan written since the last frame", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const store = new Store();
    const { app, keyboard } = mount(store);
    await nextFrame();
    store.update(() => ({ phase: "planned" }));
    keyboard.press(ESCAPE);
    await nextFrame();
    expect(store.get().phase).toBe("idle");
    app.unmount();
  });
});

describe("store notifications", () => {
  it("skips writes that change nothing and notifies for real changes", () => {
    const store = new Store();
    let notified = 0;
    store.subscribe(() => void (notified += 1));
    for (let i = 0; i < TOOL_EVENTS; i += 1) store.role("section", { note: "same note" });
    store.story("missing", { status: "passed" });
    store.update((s) => ({ phase: s.phase }));
    expect(notified).toBe(1);
    store.role("section", { note: "next note" });
    store.update(() => ({ phase: "running" }));
    expect(notified).toBe(3);
    expect(store.get().roles.section.note).toBe("next note");
  });
});
