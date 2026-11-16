import { EventEmitter } from "node:events";
import { render } from "ink";
import { afterEach, describe, expect, it, vi } from "vitest";
import { planSentences, sentence } from "#src/commands/plain.js";
import { resolveLanguage, setLanguage, t } from "#src/i18n/index.js";
import { SessionLog } from "#src/engine/session-log.js";
import { createConcert } from "#src/orchestrator/concert.js";
import { scoreRequest } from "#src/orchestrator/score.js";
import type { RunRequest } from "#src/runner/types.js";
import { Store } from "#src/state/store.js";
import { App } from "#src/ui/App.js";
import { applyKeys, KEYS } from "#src/ui/keys.js";
import { move } from "#src/ui/useNavigation.js";
import { applyTheme, COLOR, ROLE_COLOR, THEMES } from "#src/ui/theme.js";
import { CATALOG, PLAN_REPLY, scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

const is = (r: RunRequest, role: string) => r.systemFile.includes(`${role}-`);

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

afterEach(() => {
  applyTheme("default", {});
  applyKeys({ drop: "d", split: "s", merge: "m", close: "q", next: "", up: "", down: "" });
  setLanguage("en");
});

describe("themes", () => {
  it("switches every colour, gives colour-blind safe pass and fail colours, and lets NO_COLOR win", () => {
    expect(applyTheme("colorblind", {})).toBe("colorblind");
    expect([COLOR.good, COLOR.bad]).toEqual(["#56B4E9", "#D55E00"]);
    expect(ROLE_COLOR.critic).toBe(THEMES.colorblind.roles.critic);
    applyTheme("high-contrast", {});
    expect(COLOR.dim).toBe("white");
    expect(applyTheme("colorblind", { NO_COLOR: "1" })).toBe("mono");
    expect(new Set(Object.values(COLOR).filter((c) => c !== "gray"))).toEqual(new Set(["white"]));
  });
});

describe("keys, language and plain sentences", () => {
  it("drops a story with a remapped key, and the hint shows that key, in French", async () => {
    applyKeys({ drop: "x", next: "n", down: "j" });
    setLanguage("fr");
    const store = new Store();
    const scripted = scriptedRunner((r) => (is(r, "scorer") ? PLAN_REPLY : "VERDICT: ok\nok"));
    const [terminal, keyboard] = [new Terminal(), new Keyboard()];
    const deps = { config: testConfig(), catalog: CATALOG, store, runner: scripted.runner, cwd: tempDir(), autoPerform: false, initialRequest: "add a health endpoint", showTour: false, onExit: () => undefined, log: new SessionLog(tempDir()) };
    const app = render(<App {...deps} />, { stdout: terminal as never, stdin: keyboard as never, debug: true, patchConsole: false, exitOnCtrlC: false });
    await vi.waitFor(() => expect(store.get().phase).toBe("planned"), { timeout: 5000 });
    await vi.waitFor(() => expect(terminal.frames.at(-1)).toContain("entrée pour construire"));
    // Tab leaves the prompt (which takes every letter); in the lists the remapped keys apply.
    await vi.waitFor(() => {
      if (!terminal.frames.at(-1)?.includes("x retirer")) keyboard.press("\t");
      expect(terminal.frames.at(-1)).toContain("x retirer");
    }, { timeout: 10_000, interval: 300 });
    keyboard.press("x");
    await vi.waitFor(() => expect(store.get().order).toEqual(["auth"]), { timeout: 5000 });
    expect(KEYS.drop).toBe("x");
    app.unmount();
  }, 30_000);

  it("moves with the extra keys as with the arrows", () => {
    applyKeys({ up: "k", down: "j" });
    const none = { upArrow: false, downArrow: false };
    expect([move(none, "j"), move(none, "k"), move(none, "x"), move({ upArrow: true, downArrow: false }, "")]).toEqual([1, -1, 0, -1]);
    applyKeys({ up: "", down: "" });
    expect(move(none, "j")).toBe(0);
  });

  it("reads the language from the locale when set to auto", () => {
    expect(resolveLanguage("auto", { LANG: "fr_FR.UTF-8" })).toBe("fr");
    expect(resolveLanguage("auto", { LANG: "de_DE.UTF-8" })).toBe("en");
    expect(resolveLanguage("auto", { LC_ALL: "fr_CA", LANG: "en_US" })).toBe("fr");
    expect(resolveLanguage("en", { LANG: "fr_FR" })).toBe("en");
    setLanguage("fr");
    expect(t().retry(1)).toContain("la story qui n'a pas réussi");
  });

  it("says the plan and the events as sentences", async () => {
    const scripted = scriptedRunner((r) => (is(r, "scorer") ? PLAN_REPLY : "VERDICT: ok\nok"));
    const c = await createConcert({ config: testConfig(), catalog: CATALOG, store: new Store(), runner: scripted.runner, cwd: tempDir() });
    await scoreRequest(c, "add a health endpoint");
    const plan = planSentences(c.store.get());
    expect(plan[0]).toMatch(/^The plan has 2 stories, about \$\d+\.\d\d in all\.$/);
    expect(plan[1]).toMatch(/^Story 1 of 2, Add \/health route: score \d+, built by \S+, reviewed by \S+, about \$\d+\.\d\d\.$/);
    expect(sentence({ role: "critic", label: "Critic", detail: "Add /health route · tested", result: "passed" })).toBe("The critic passed the story: Add /health route, tested.");
    expect(sentence({ role: "conductor", label: "Report", detail: ".concerto/runs/x.md", result: "written" })).toBe("Report: .concerto/runs/x.md. Result: written.");
  });
});
