import { EventEmitter } from "node:events";
import { setImmediate as nextTask } from "node:timers/promises";
import { render } from "ink";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Store } from "#src/state/store.js";
import { AgentList, clock } from "#src/ui/AgentList.js";

class Terminal extends EventEmitter {
  columns = 160;
  rows = 40;
  isTTY = true;
  frames: string[] = [];
  write(frame: string): boolean {
    this.frames.push(frame);
    return true;
  }
}

afterEach(() => vi.useRealTimers());

describe("agent list", () => {
  it("formats elapsed time for a fixed column", () => {
    expect(clock(0)).toBe("0s");
    expect(clock(45_400)).toBe("45s");
    expect(clock(407_000)).toBe("6m47s");
    expect(clock(-5)).toBe("0s");
  });

  it("ticks every second while an agent works, with no new output, and previews its last lines", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const store = new Store();
    store.agentStart({ id: "section:a", role: "section", model: "codex/gpt-6.1-sol", label: "Remove N+1 patterns" });
    store.agentLines("section:a", ["running the benchmark", "▸ edit files"]);
    const stdout = new Terminal();
    const app = render(<AgentList state={store.get()} focused={false} selected={0} />, { stdout: stdout as never, debug: true, patchConsole: false });
    await nextTask();
    expect(stdout.frames.at(-1)).toContain("last output 0s ago");
    await vi.advanceTimersByTimeAsync(31_000);
    await nextTask();
    const frame = stdout.frames.at(-1) ?? "";
    expect(frame).toContain("31s");
    expect(frame).toContain("last output 31s ago · probably running a command");
    expect(frame).toContain("running the benchmark");
    app.unmount();
  });
});
