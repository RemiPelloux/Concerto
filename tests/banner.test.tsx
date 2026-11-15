import { EventEmitter } from "node:events";
import { setImmediate as nextTask } from "node:timers/promises";
import { render } from "ink";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Banner, WELCOME_MS } from "#src/ui/Banner.js";

class Terminal extends EventEmitter {
  columns = 120;
  rows = 40;
  isTTY = true;
  frames: string[] = [];
  write(frame: string): boolean {
    this.frames.push(frame);
    return true;
  }
}

afterEach(() => vi.useRealTimers());

describe("banner", () => {
  it("greets on launch, then drops the welcome after a few seconds and keeps the logo", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stdout = new Terminal();
    const app = render(<Banner />, { stdout: stdout as unknown as NodeJS.WriteStream, patchConsole: false, debug: true });
    await nextTask();
    expect(stdout.frames.at(-1)).toContain("Welcome to Concerto");
    await vi.advanceTimersByTimeAsync(WELCOME_MS);
    await nextTask();
    expect(stdout.frames.at(-1)).not.toContain("Welcome to Concerto");
    expect(stdout.frames.at(-1)).toContain("████");
    app.unmount();
  });
});
