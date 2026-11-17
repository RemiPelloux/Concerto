import { EventEmitter } from "node:events";
import { render } from "ink";
import { expect, it, vi } from "vitest";
import { SessionLog } from "#src/engine/session-log.js";
import { Store } from "#src/state/store.js";
import { App } from "#src/ui/App.js";
import { CATALOG, scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

const ROWS = 24;
const COLUMNS = 120;
const STEP_MS = 150;
const [DOWN, RIGHT, ENTER, ESCAPE, TAB] = ["\u001b[B", "\u001b[C", "\r", "\u001b", "\t"];
const TAB_BAR = /Organigram\s+Models\s+Settings\s+Skills/;

/** A short pane: a frame as tall as this makes Ink's redraw leave old lines on screen. */
class ShortTerminal extends EventEmitter {
  columns = COLUMNS;
  rows = ROWS;
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

/** Enough routes, reviews and models that no tab fits a short pane without scrolling or cutting. */
function crowded() {
  const config = testConfig();
  config.routes = Array.from({ length: 4 }, (_r, i) => ({ name: `route-${i}`, tags: [], minScore: 0, maxScore: 101, role: "soloist" as const, models: [], effort: "auto" as const }));
  config.reviews = Array.from({ length: 4 }, () => ({ tags: [], minScore: 0, maxScore: 101, models: [], effort: "auto" as const }));
  for (let i = 0; i < 30; i++) config.models[`z/model-${i}`] = { tier: 3 };
  return config;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

it("keeps every /config frame shorter than the terminal, tab bar shown once, on every tab", async () => {
  const [terminal, keyboard, cwd] = [new ShortTerminal(), new Keyboard(), tempDir()];
  const deps = { config: crowded(), catalog: CATALOG, store: new Store(), runner: scriptedRunner(() => "").runner, cwd, autoPerform: false, initialRequest: "", showTour: false, onExit: () => undefined, log: new SessionLog(cwd) };
  const app = render(<App {...deps} />, { stdout: terminal as never, stdin: keyboard as never, debug: true, patchConsole: false, exitOnCtrlC: false });
  await wait(STEP_MS);
  keyboard.press("/config");
  await wait(STEP_MS);
  keyboard.press(ENTER);
  await vi.waitFor(() => expect(terminal.frames.at(-1)).toMatch(TAB_BAR));
  await wait(STEP_MS);
  const opened = terminal.frames.length - 1;
  for (const key of [DOWN, RIGHT, RIGHT, ENTER, DOWN, DOWN, ESCAPE, DOWN, TAB, DOWN, DOWN, TAB, TAB, TAB, TAB, ENTER, DOWN]) {
    keyboard.press(key);
    await wait(STEP_MS);
  }
  app.unmount();
  // Frames only: on unmount Ink also writes the escape that shows the cursor again.
  const frames = terminal.frames.slice(opened).filter((f) => f.includes("\n"));
  expect(frames.length).toBeGreaterThan(10);
  for (const frame of frames) {
    expect(frame.split("\n").length).toBeLessThan(ROWS);
    expect(frame.split("\n").filter((l) => TAB_BAR.test(l))).toHaveLength(1);
  }
}, 30_000);
