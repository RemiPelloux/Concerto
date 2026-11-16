import { EventEmitter } from "node:events";
import { render } from "ink";
import { describe, expect, it, vi } from "vitest";
import { explainLines } from "#src/commands/explain.js";
import { NO_CALIBRATION } from "#src/engine/calibrate.js";
import { SessionLog } from "#src/engine/session-log.js";
import { saveTemplate } from "#src/engine/templates.js";
import { editPlan } from "#src/orchestrator/edit.js";
import { createConcert } from "#src/orchestrator/concert.js";
import { parsePlan } from "#src/orchestrator/plan.js";
import { scoreRequest } from "#src/orchestrator/score.js";
import type { RunRequest } from "#src/runner/types.js";
import { Store } from "#src/state/store.js";
import { App } from "#src/ui/App.js";
import { CATALOG, scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

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
const story = (id: string, over: object = {}) => ({ id, title: `Story ${id}`, asA: "a user", iWant: id, soThat: "x", acceptance: [`${id} works`, `${id} is tested`], points: 2, complexity: 2, risk: 1, value: 2, tags: [], files: [], ...over });
const FIVE = { summary: "five", stories: [story("s1"), story("s2"), story("s3"), story("s4", { dependsOn: ["s3"] }), story("s5", { dependsOn: ["s4"] })] };

describe("editing a plan", () => {
  it("drops, merges and splits stories and keeps every dependency pointing somewhere real", () => {
    const plan = parsePlan(JSON.stringify(FIVE));
    const dropped = editPlan(plan, { kind: "drop", id: "s4" }).plan;
    expect(dropped.stories.find((s) => s.id === "s5")?.dependsOn).toEqual([]);
    const merged = editPlan(plan, { kind: "merge", id: "s4", into: "s3" });
    expect(merged.plan.stories.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s5"]);
    expect(merged.plan.stories.find((s) => s.id === "s3")).toMatchObject({ points: 5, acceptance: ["s3 works", "s3 is tested", "s4 works", "s4 is tested"], dependsOn: [] });
    expect(merged.plan.stories.find((s) => s.id === "s5")?.dependsOn).toEqual(["s3"]);
    expect(merged.changed).toEqual(["s3", "s5"]);
    const split = editPlan(plan, { kind: "split", id: "s4" }).plan;
    expect(split.stories.filter((s) => s.id.startsWith("s4-")).map((s) => s.acceptance)).toEqual([["s4 works"], ["s4 is tested"]]);
    expect(split.stories.find((s) => s.id === "s5")?.dependsOn).toEqual(["s4-1", "s4-2"]);
    expect(() => editPlan(plan, { kind: "drop", id: "nope" })).toThrow(/No story "nope"/);
    expect(() => editPlan(parsePlan(JSON.stringify({ summary: "x", stories: [story("a")] })), { kind: "drop", id: "a" })).toThrow(/at least one story/);
  });

  it("trims a five-story plan to three, reroutes one, and builds it without leaving the TUI", async () => {
    const scripted = scriptedRunner((r) => (is("scorer")(r) ? JSON.stringify(FIVE) : is("critic")(r) ? "VERDICT: pass\nok" : is("conductor")(r) ? "VERDICT: ok\nok" : "STATUS: done\nok"));
    const store = new Store();
    const cwd = tempDir();
    const [terminal, keyboard] = [new Terminal(), new Keyboard()];
    const deps = { config: testConfig(), catalog: CATALOG, store, runner: scripted.runner, cwd, autoPerform: false, initialRequest: "five stories", showTour: false, onExit: () => undefined, log: new SessionLog(cwd) };
    const app = render(<App {...deps} />, { stdout: terminal as never, stdin: keyboard as never, debug: true, patchConsole: false, exitOnCtrlC: false });
    await vi.waitFor(() => expect(store.get().phase).toBe("planned"), { timeout: 5000 });
    keyboard.press("/drop s5\r");
    await vi.waitFor(() => expect(store.get().order).toEqual(["s1", "s2", "s3", "s4"]));
    keyboard.press("/merge s4 s3\r");
    await vi.waitFor(() => expect(store.get().order).toEqual(["s1", "s2", "s3"]));
    keyboard.press("/route s1 a/brain\r");
    await vi.waitFor(() => expect(store.get().stories.s1?.model).toBe("a/brain"));
    keyboard.press("\r");
    await vi.waitFor(() => expect(store.get().phase).toBe("done"), { timeout: 5000 });
    expect(Object.values(store.get().stories).map((s) => [s.id, s.status])).toEqual([["s1", "passed"], ["s2", "passed"], ["s3", "passed"]]);
    const built = scripted.calls.filter((r) => !is("scorer")(r) && !is("critic")(r) && !is("conductor")(r));
    expect(built.find((r) => r.prompt.includes("## Story s1:"))?.model).toBe("a/brain");
    expect(built.some((r) => r.prompt.includes("## Story s3:") && r.prompt.includes("- s4 works"))).toBe(true);
    app.unmount();
  });

  it("plans a new request in the shape of a saved template", async () => {
    saveTemplate("api-endpoint", parsePlan(JSON.stringify(FIVE)));
    const scripted = scriptedRunner((r) => (is("scorer")(r) ? JSON.stringify(FIVE) : "VERDICT: ok\nok"));
    const c = await createConcert({ config: testConfig(), catalog: CATALOG, store: new Store(), runner: scripted.runner, cwd: tempDir(), template: "api-endpoint" });
    await scoreRequest(c, "add an orders endpoint");
    expect(scripted.calls[0]?.prompt).toContain("## Plan shape to follow: api-endpoint");
    expect(scripted.calls[0]?.prompt).toContain("- Story s1 (2 pts): s1 works; s1 is tested");
  });

  it("explains each story's score, routing and estimate in words", async () => {
    const store = new Store();
    const c = await createConcert({ config: testConfig(), catalog: CATALOG, store, runner: scriptedRunner(() => JSON.stringify(FIVE)).runner, cwd: tempDir() });
    await scoreRequest(c, "five stories");
    const text = explainLines(store.get(), NO_CALIBRATION).join("\n");
    expect(text).toMatch(/^five\n\ns1 +Story s1 +score \d+ · 2 pts/);
    expect(text).toMatch(/why: complexity 2\/5 \(0\.\d\d x 0\.25\)/);
    expect(text).toMatch(/built by \S+ \(rule cheapest-tier, \w+, effort \w+\)/);
    expect(text).toContain("estimate $");
    expect(text).toContain("list prices: one build and one review");
  });
});
