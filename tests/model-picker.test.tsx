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
  c.roles.critic.models = ["a/brain", "a/builder"];
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
    const c = { ...config(), reviews: [{ tags: ["ui"], minScore: 0, maxScore: 101, models: ["a/brain"] }] };
    expect(slots(c).map((s) => s.label)).toEqual(["conductor", "scorer", "soloist", "critic", "section", "build: complex-build", "review 1"]);
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

const RIGHT = "\u001b[C";
const TAB = "\t";
const HOME = "\u001b[H";

/** The App on a fake terminal, opened on `/config`. */
async function openConfig(cwd: string) {
  const [terminal, keyboard, store] = [new Terminal(), new Keyboard(), new Store()];
  const deps = { config: config(), catalog: CATALOG, store, runner: scriptedRunner(() => "").runner, cwd, autoPerform: false, initialRequest: "", showTour: false, onExit: () => undefined, log: new SessionLog(cwd) };
  const app = render(<App {...deps} />, { stdout: terminal as never, stdin: keyboard as never, debug: true, patchConsole: false, exitOnCtrlC: false });
  const screen = () => terminal.frames.at(-1) ?? "";
  const press = async (key: string, see: string) => {
    keyboard.press(key);
    await vi.waitFor(() => expect(screen()).toContain(see));
  };
  keyboard.press("/config");
  await press(ENTER, "CONDUCTOR");
  return { app, store, keyboard, screen, press };
}

const saved = (cwd: string) => JSON.parse(readFileSync(join(cwd, "concerto.config.json"), "utf8"));

describe("/config screen", () => {
  it("draws the organigram and changes a role's model with the arrows and enter, applies it now and saves it", async () => {
    const cwd = project();
    const { app, store, keyboard, screen, press } = await openConfig(cwd);
    expect(screen()).toContain("Organigram");
    ["SCORER", "SOLOIST", "SECTION", "CRITIC", "complex-build"].forEach((box) => expect(screen()).toContain(box));
    await press(DOWN, "scorer · scores each story");
    await press(ENTER, "› model");
    await press(ENTER, "Pick the model for scorer");
    expect(screen()).not.toContain("x/deepseek-v4-pro");
    for (let i = 0; i < EXTRA.length + MODELS.length; i++) keyboard.press(UP);
    await vi.waitFor(() => expect(screen()).toMatch(/› (?:● )?\s*a\/brain/));
    await press(ENTER, "scorer → a/brain · saved to");
    expect(store.get().roles.scorer.model).toBe("a/brain");
    expect(saved(cwd).roles.scorer.models[0]).toBe("a/brain");
    await press(ESCAPE, "enter to edit");
    keyboard.press(ESCAPE);
    await vi.waitFor(() => expect(screen()).not.toContain("Organigram"));
    app.unmount();
  });

  it("moves a build route from the soloist to the section", async () => {
    const cwd = project();
    const { app, press } = await openConfig(cwd);
    await press(DOWN, "scorer · scores each story");
    await press(RIGHT, "soloist · builds the hard stories");
    await press(DOWN, "build: complex-build");
    await press(ENTER, "› model");
    await press(DOWN, "› chain");
    await press(DOWN, "› name");
    await press(DOWN, "› builder");
    await press(RIGHT, "builder → section · saved to");
    expect(saved(cwd).routes[0].role).toBe("section");
    app.unmount();
  });

  it("edits the budget with the arrows and the gates by typing, and refuses an invalid value", async () => {
    const cwd = project();
    const { app, keyboard, press } = await openConfig(cwd);
    keyboard.press(TAB);
    await press(TAB, "› budget per run ($)");
    await press(RIGHT, "budget per run ($) → 1 · saved to");
    expect(saved(cwd).budgetUsd).toBe(1);
    await press(DOWN, "› providers tried first");
    await press(ENTER, "enter save · esc cancel");
    keyboard.press("bad value!");
    await press(ENTER, "prefer.0");
    expect(saved(cwd).prefer).toEqual([]);
    await press(DOWN, "› gates");
    await press(ENTER, "enter save · esc cancel");
    keyboard.press("pnpm test, pnpm lint");
    await press(ENTER, "gates → pnpm test, pnpm lint · saved to");
    expect(saved(cwd)).toMatchObject({ $comment: "mine", gates: ["pnpm test", "pnpm lint"] });
    app.unmount();
  });

  it("adds a route under the section, renames it with the caret, reorders it and undoes step by step", async () => {
    const cwd = project();
    const { app, keyboard, press } = await openConfig(cwd);
    await press(DOWN, "scorer · scores each story");
    await press(RIGHT, "soloist · builds the hard stories");
    await press("a", 'added route-2 for stories tagged "new"');
    expect(saved(cwd).routes.map((r: { name: string }) => r.name)).toEqual(["route-2", "complex-build"]);
    await press(ENTER, "enter save · esc cancel");
    keyboard.press("x");
    await press(HOME, "home end move");
    keyboard.press("my-");
    await press(ENTER, "name → my-route-2x · saved to");
    expect(saved(cwd).routes[0]).toMatchObject({ name: "my-route-2x", role: "soloist", tags: ["new"] });
    await press("]", "moved to position 2");
    expect(saved(cwd).routes.map((r: { name: string }) => r.name)).toEqual(["complex-build", "my-route-2x"]);
    await press("u", "Undone");
    expect(saved(cwd).routes[0].name).toBe("my-route-2x");
    keyboard.press("u");
    keyboard.press("u");
    await vi.waitFor(() => expect(saved(cwd).routes.map((r: { name: string }) => r.name)).toEqual(["complex-build"]));
    app.unmount();
  });

  it("deletes a route only after y", async () => {
    const cwd = project();
    const { app, press } = await openConfig(cwd);
    await press(DOWN, "scorer · scores each story");
    await press(RIGHT, "soloist · builds the hard stories");
    await press(DOWN, "build: complex-build");
    await press("d", "Delete build: complex-build? y to delete");
    await press("n", "Kept.");
    expect(saved(cwd).routes).toHaveLength(1);
    await press("d", "Delete build: complex-build?");
    await press("y", "deleted route 1");
    expect(saved(cwd).routes).toEqual([]);
    app.unmount();
  });

  it("reorders, extends and trims a role's chain", async () => {
    const cwd = project();
    const { app, press } = await openConfig(cwd);
    await press(DOWN, "scorer · scores each story");
    for (const duty of ["soloist · builds", "section · builds", "critic · reviews every story"]) await press(RIGHT, duty);
    await press(ENTER, "› model");
    await press(DOWN, "› chain");
    await press(ENTER, "Chain for critic");
    await press("]", "chain of critic: a/builder › a/brain");
    expect(saved(cwd).roles.critic.models).toEqual(["a/builder", "a/brain"]);
    await press("a", "Add a fallback for critic");
    await press(DOWN, "› ");
    await press(ENTER, "chain of critic: a/builder › a/brain › ");
    expect(saved(cwd).roles.critic.models).toHaveLength(3);
    await press("d", "chain of critic: a/builder › ");
    expect(saved(cwd).roles.critic.models).toHaveLength(2);
    await press("u", "Undone");
    expect(saved(cwd).roles.critic.models).toHaveLength(3);
    app.unmount();
  });

  it("adds a model, sets its cost factor, and deletes another one", async () => {
    const cwd = project();
    const { app, keyboard, press } = await openConfig(cwd);
    await press(TAB, "› a/brain");
    await press("a", "New model:");
    keyboard.press("z/new-model");
    await press(ENTER, "added z/new-model at tier 3");
    expect(saved(cwd).models["z/new-model"]).toEqual({ tier: 3 });
    await press(DOWN, "←→ change · 0 = prepaid subscription");
    await press(RIGHT, "cost factor → 0 · saved to");
    expect(saved(cwd).models["a/brain"]).toEqual({ tier: 5, costFactor: 0 });
    await press("d", "Delete a/brain?");
    await press("y", "deleted a/brain");
    expect(saved(cwd).models["a/brain"]).toBeUndefined();
    app.unmount();
  });

  it("adds and deletes a skill rule", async () => {
    const cwd = project();
    const { app, keyboard, press } = await openConfig(cwd);
    const before = saved(cwd).skills.length;
    keyboard.press(TAB);
    keyboard.press(TAB);
    await press(TAB, " Skills ");
    await press("a", "added a skill rule");
    expect(saved(cwd).skills).toHaveLength(before + 1);
    await press("d", `Delete skill rule ${before + 1}?`);
    await press("y", "deleted skill");
    expect(saved(cwd).skills).toHaveLength(before);
    app.unmount();
  });
});
