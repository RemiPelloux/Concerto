/**
 * Takes the README's screenshots from the real TUI: a demo run is driven key by key and each screen
 * is written to docs/assets/screens/<name>.svg. Nothing calls a model.
 *
 *   node --import tsx --conditions=source scripts/screens/capture.ts
 */
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ROLES } from "#src/config/types.js";
import { firstOf } from "#src/models/router.js";
import { frameToSvg } from "#scripts/screens/ansi-svg.js";
import { CATALOG, demoConfig, demoRepo, demoRunner, REQUEST } from "#scripts/screens/demo.js";

// Colours on, as in a real terminal, before Ink and chalk load.
process.env.FORCE_COLOR = "3";
process.env.CONCERTO_NO_UPDATE_CHECK = "1";

const OUT = resolve("docs/assets/screens");
const SIZE = { columns: 150, rows: 46 };
const WAIT_MS = 15_000;
const POLL_MS = 50;
const KEYS = { enter: "\r", tab: "\t", down: "\u001b[B" };
const ESC = "\u001b";
/** Ink reads a lone Escape on its next tick; a pause keeps two of them apart. */
const KEY_GAP_MS = 400;
const LOGIN_BUILDER_ROW = 4;

class Terminal extends EventEmitter {
  columns = SIZE.columns;
  rows = SIZE.rows;
  isTTY = true;
  frame = "";
  write(frame: string): boolean {
    if (frame.trim()) [this.frame, lastFrame] = [frame, frame];
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

let lastFrame = "";
const CSI = new RegExp(`${ESC}\\[[0-9;?]*[a-zA-Z]`, "g");
const plainText = (frame: string) => frame.replace(CSI, "");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Ink redraws in a few ticks after the text first shows; the shot waits for it to settle. */
const SETTLE_MS = 200;

async function until(check: () => boolean, what: string): Promise<void> {
  const end = Date.now() + WAIT_MS;
  while (!check()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}. The screen:\n${plainText(lastFrame)}`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/** Waits for `text` on screen, then saves the screen. */
async function shot(t: Terminal, name: string, at: { text: string; title: string }): Promise<void> {
  await until(() => plainText(t.frame).includes(at.text), `"${at.text}" for ${name}`);
  await wait(SETTLE_MS);
  writeFileSync(join(OUT, `${name}.svg`), frameToSvg(t.frame, { title: at.title, columns: SIZE.columns }));
  process.stdout.write(`${name}.svg\n`);
}

/** Presses a key until `text` shows, for keys a slow first frame could miss. */
async function pressUntil(at: { t: Terminal; k: Keyboard }, key: string, text: string): Promise<void> {
  await until(() => {
    if (!plainText(at.t.frame).includes(text)) at.k.press(key);
    return plainText(at.t.frame).includes(text);
  }, text);
}

type Rig = { t: Terminal; k: Keyboard; title: string };

/** Presses a key `times` times, a pause apart, so Ink reads each one. */
async function pressTimes(k: Keyboard, key: string, times: number): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    k.press(key);
    await wait(KEY_GAP_MS);
  }
}

/** The plan, then one story's score; back to the prompt. */
async function plan({ t, k, title }: Rig): Promise<void> {
  const { WELCOME_MS } = await import("#src/ui/Banner.js");
  // The welcome greets a new session for a few seconds; the screenshots show Concerto at work.
  await wait(WELCOME_MS + KEY_GAP_MS);
  await shot(t, "plan", { text: "enter to build", title });
  await pressUntil({ t, k }, KEYS.tab, "why this score");
  k.press(KEYS.enter);
  await shot(t, "story", { text: "Why this score", title });
  // Esc closes the view, a second Esc goes back to the prompt.
  await pressTimes(k, ESC, 2);
  await until(() => plainText(t.frame).includes("enter to build"), "the prompt");
}

/** The build, one agent's live view, the finished run and a diff. */
async function build({ t, k, title }: Rig, finish: () => Promise<void>): Promise<void> {
  await pressUntil({ t, k }, KEYS.enter, "Working");
  await shot(t, "building", { text: "bash pnpm test", title });
  await pressUntil({ t, k }, KEYS.tab, "enter live output");
  // The scorer and the plan check come first in the list; the login story's builder is the fifth.
  await pressTimes(k, KEYS.down, LOGIN_BUILDER_ROW);
  k.press(KEYS.enter);
  await shot(t, "agent", { text: "Wrote src/auth/login.ts", title });
  await pressUntil({ t, k }, "q", "agents ·");
  await finish();
  await shot(t, "finished", { text: "passed", title });
  await pressUntil({ t, k }, KEYS.tab, "enter diff");
  k.press(KEYS.enter);
  await shot(t, "diff", { text: "esc back", title: "concerto — diff, side by side" });
}

async function main(): Promise<void> {
  const [{ render }, { createElement }, { App }, { Store }, { SessionLog }] = await Promise.all([import("ink"), import("react"), import("#src/ui/App.js"), import("#src/state/store.js"), import("#src/engine/session-log.js")]);
  mkdirSync(OUT, { recursive: true });
  let release = () => undefined as void;
  const hold = new Promise<void>((r) => (release = r));
  const cwd = demoRepo();
  const [t, k, store] = [new Terminal(), new Keyboard(), new Store()];
  ROLES.forEach((role) => store.role(role, { model: firstOf(CATALOG, demoConfig(), role)?.ref ?? "" }));
  const deps = { config: demoConfig(), catalog: CATALOG, store, runner: demoRunner(hold), cwd, autoPerform: false, initialRequest: REQUEST, showTour: false, onExit: () => undefined, log: new SessionLog(cwd) };
  const app = render(createElement(App, deps), { stdout: t as never, stdin: k as never, debug: true, patchConsole: false, exitOnCtrlC: false });
  const rig = { t, k, title: "concerto — ~/shop" };
  await plan(rig);
  await build(rig, async () => {
    release();
    await until(() => store.get().phase === "done" || store.get().phase === "failed", "the run to end");
  });
  app.unmount();
}

await main();
