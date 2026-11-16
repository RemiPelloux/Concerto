import { EventEmitter } from "node:events";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "ink";
import { describe, expect, it, vi } from "vitest";
import { SessionLog } from "#src/engine/session-log.js";
import { Catalog } from "#src/models/catalog.js";
import type { ModelInfo } from "#src/models/types.js";
import { parseRef } from "#src/runner/types.js";
import { Store } from "#src/state/store.js";
import { App } from "#src/ui/App.js";
import { assign, choices, saveChoice, slots } from "#src/ui/model-slots.js";
import { MODELS, scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

const info = (ref: string, tier: number): ModelInfo => ({ ref, parsed: parseRef(ref), tier, price: null, costFactor: 1 });
const EXTRA = [info("x/gpt-6-sol", 4), info("x/claude-opus-5-5", 4), info("x/claude-haiku-5-5", 2), info("x/deepseek-v4-pro", 3)];
const CATALOG = new Catalog([...MODELS, ...EXTRA]);
const ENTER = "\r";
const UP = "\u001b[A";
const DOWN = "\u001b[B";
const ESCAPE = "\u001b";

function config() {
  const c = testConfig();
  EXTRA.forEach((m) => (c.models[m.ref] = { tier: m.tier }));
  c.routes = [{ name: "complex-build", tags: [], minScore: 55, maxScore: 101, role: "soloist", models: ["a/builder"], effort: "auto" }];
  return c;
}

/** A project directory whose config file has a comment and a budget the picker must keep. */
function project(): string {
  const cwd = tempDir();
  writeFileSync(join(cwd, "concerto.config.json"), JSON.stringify({ $comment: "mine", ...config(), budgetUsd: 7 }));
  return cwd;
}

describe("model slots", () => {
  it("lists every role, build route and review rule", () => {
    const c = { ...config(), reviews: [{ tags: ["ui"], minScore: 0, maxScore: 101, models: ["a/brain"], effort: "auto" as const }] };
    expect(slots(c).map((s) => s.label)).toEqual(["conductor", "rewriter", "scorer", "soloist", "critic", "section", "build: complex-build", "review 1"]);
    expect(slots(c).find((s) => s.label === "section")?.brain).toBe(false);
  });

  it("offers brain work only premium models, strongest first and Claude before GPT", () => {
    const critic = slots(config()).find((s) => s.key === "critic")!;
    const refs = choices(CATALOG, critic).map((m) => m.ref);
    expect(refs).not.toContain("x/deepseek-v4-pro");
    expect(refs).not.toContain("x/claude-haiku-5-5");
    expect(refs.indexOf("x/claude-opus-5-5")).toBeLessThan(refs.indexOf("x/gpt-6-sol"));
    expect(choices(CATALOG, slots(config()).find((s) => s.key === "section")!).map((m) => m.ref)).toContain("x/deepseek-v4-pro");
  });

  it("puts the chosen model first and keeps the rest as fallbacks, then edits only that slot in the file", () => {
    const cwd = project();
    const route = slots(config()).find((s) => s.kind === "routes")!;
    const next = assign(config(), route, "x/claude-opus-5-5");
    expect(next.routes[0]?.models).toEqual(["x/claude-opus-5-5", "a/builder"]);
    saveChoice(cwd, next, route);
    const saved = JSON.parse(readFileSync(join(cwd, "concerto.config.json"), "utf8"));
    expect(saved).toMatchObject({ $comment: "mine", budgetUsd: 7 });
    expect(saved.routes[0].models).toEqual(["x/claude-opus-5-5", "a/builder"]);
  });
});

class Terminal extends EventEmitter {
  columns = 200;
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

const SLOW_CI_MS = 5000;
const VIEW_SETTLE_MS = 100;

describe("/config picker", () => {
  it("changes a role's model with the arrows and enter, applies it now and saves it", async () => {
    const cwd = project();
    const [terminal, keyboard, store] = [new Terminal(), new Keyboard(), new Store()];
    const deps = { config: config(), catalog: CATALOG, store, runner: scriptedRunner(() => "").runner, cwd, autoPerform: false, initialRequest: "", showTour: false, onExit: () => undefined, log: new SessionLog(cwd) };
    const app = render(<App {...deps} />, { stdout: terminal as never, stdin: keyboard as never, debug: true, patchConsole: false, exitOnCtrlC: false });
    const screen = () => terminal.frames.at(-1) ?? "";
    // A new view listens for keys from its first effect, a moment after it first shows: wait that moment.
    const press = async (key: string, see: string) => {
      keyboard.press(key);
      await vi.waitFor(() => expect(screen()).toContain(see), { timeout: SLOW_CI_MS });
      await new Promise((r) => setTimeout(r, VIEW_SETTLE_MS));
    };
    keyboard.press("/config");
    await press(ENTER, "Who does what");
    await press(DOWN, "› rewriter");
    await press(DOWN, "› scorer");
    await press(ENTER, "Pick the model for scorer");
    expect(screen()).not.toContain("x/deepseek-v4-pro");
    for (let i = 0; i < EXTRA.length + MODELS.length; i++) keyboard.press(UP);
    await vi.waitFor(() => expect(screen()).toMatch(/› (?:● )?\s*a\/brain/));
    await press(ENTER, "scorer → a/brain · saved to");
    expect(store.get().roles.scorer.model).toBe("a/brain");
    expect(JSON.parse(readFileSync(join(cwd, "concerto.config.json"), "utf8")).roles.scorer.models[0]).toBe("a/brain");
    keyboard.press(ESCAPE);
    await vi.waitFor(() => expect(screen()).not.toContain("Who does what"));
    app.unmount();
  });
});
