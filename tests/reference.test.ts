import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reference } from "#scripts/reference.js";

describe("the reference page", () => {
  it("lists every flag, slash command and config key the code has: regenerate it with scripts/reference.ts", () => {
    const committed = readFileSync("docs/reference.md", "utf8").replace(/\r\n/g, "\n");
    expect(committed).toBe(reference());
  });
});
