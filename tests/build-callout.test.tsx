import { EventEmitter } from "node:events";
import { setImmediate as nextTask } from "node:timers/promises";
import { render } from "ink";
import { describe, expect, it } from "vitest";
import { BuildCallout, waveColor } from "#src/ui/BuildCallout.js";
import { glyphs, glyphWidth } from "#src/ui/glyphs.js";

class Terminal extends EventEmitter {
  rows = 40;
  isTTY = true;
  frames: string[] = [];
  constructor(public columns: number) {
    super();
  }
  write(frame: string): boolean {
    this.frames.push(frame);
    return true;
  }
}

async function draw(columns: number): Promise<string> {
  const stdout = new Terminal(columns);
  const app = render(<BuildCallout />, { stdout: stdout as unknown as NodeJS.WriteStream, patchConsole: false, debug: true });
  await nextTask();
  app.unmount();
  return stdout.frames.join("");
}

describe("build call-out", () => {
  it("draws ENTER TO BUILD in block letters when the terminal is wide enough", async () => {
    const frame = await draw(160);
    expect(frame).toContain("██████");
    expect(frame).not.toContain("ENTER TO BUILD");
  });

  it("falls back to one line in a narrow terminal", async () => {
    const frame = await draw(60);
    expect(frame).toContain("ENTER TO BUILD");
    expect(frame).not.toContain("██████");
  });

  it("rolls the colours along the letters as frames pass", () => {
    const now = [0, 1, 2].map((i) => waveColor(i, 0));
    const later = [0, 1, 2].map((i) => waveColor(i, 2));
    expect(later).not.toEqual(now);
    expect(later[1]).toBe(now[0]);
  });

  it("draws accented letters without their accent", () => {
    expect(glyphs("É")).toEqual(glyphs("E"));
    expect(glyphWidth(glyphs("ENTER TO BUILD"))).toBeGreaterThan(60);
  });
});
