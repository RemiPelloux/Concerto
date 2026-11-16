import { EventEmitter } from "node:events";
import { render } from "ink";
import { expect, it, vi } from "vitest";
import { SessionLog } from "#src/engine/session-log.js";
import { Store } from "#src/state/store.js";
import { App } from "#src/ui/App.js";
import { TUI_RENDER } from "#src/ui/launch.js";
import { CATALOG, PLAN_REPLY, scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

// Colours on, as in a real terminal: without them every frame of the wave looks the same.
vi.hoisted(() => {
  process.env.FORCE_COLOR = "3";
});

const CLEAR_SCROLLBACK = "\u001b[3J";
const WATCH_MS = 1500;
const SETTLE_MS = 300;
/** Bytes a second a waiting plan may write; the 1.0.2 call-out wrote about 190 KB. */
const BUDGET_PER_SECOND = 40 * 1024;

/** A short pane, as in Orca: the full screen does not fit in it. */
class ShortTerminal extends EventEmitter {
  columns = 220;
  rows = 60;
  isTTY = true;
  bytes = 0;
  clears = 0;
  write(frame: string): boolean {
    this.bytes += Buffer.byteLength(frame);
    if (frame.includes(CLEAR_SCROLLBACK)) this.clears++;
    return true;
  }
}

class Keyboard extends EventEmitter {
  isTTY = true;
  setRawMode(): void {}
  setEncoding(): void {}
  ref(): void {}
  unref(): void {}
  read(): null {
    return null;
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

it("a plan waiting in a short, shrinking terminal never clears the screen and writes little", async () => {
  const store = new Store();
  const cwd = tempDir();
  const terminal = new ShortTerminal();
  const deps = { config: testConfig(), catalog: CATALOG, store, runner: scriptedRunner(() => PLAN_REPLY).runner, cwd, autoPerform: false, initialRequest: "add health and auth", showTour: false, onExit: () => undefined, log: new SessionLog(cwd) };
  const app = render(<App {...deps} />, { ...TUI_RENDER, stdout: terminal as never, stdin: new Keyboard() as never, patchConsole: false, exitOnCtrlC: false });
  await vi.waitFor(() => expect(store.get().phase).toBe("planned"), { timeout: 5000 });
  // The pane shrinks: the screen must follow, or the flood comes back.
  terminal.rows = 30;
  terminal.emit("resize");
  await wait(SETTLE_MS);
  terminal.bytes = 0;
  terminal.clears = 0;
  await wait(WATCH_MS);
  app.unmount();
  expect(terminal.clears).toBe(0);
  expect((terminal.bytes * 1000) / WATCH_MS).toBeLessThan(BUDGET_PER_SECOND);
}, 15000);
