import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "#tests/fixtures.js";

const hasNvim = spawnSync("nvim", ["--version"]).status === 0;

/** Runs `script` in a headless Neovim with the plugin loaded; what it prints comes back. */
function nvim(cwd: string, script: string): string {
  const file = join(cwd, "test.lua");
  writeFileSync(file, script);
  return execFileSync("nvim", ["--headless", "-u", "NONE", "-i", "NONE", "--cmd", `set rtp^=${resolve("editors/nvim")}`, "--cmd", "runtime plugin/concerto.lua", "-c", `luafile ${file}`, "-c", "qa!"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const SCRIPT = `
local concerto = require("concerto")
local runs = {}
concerto.open_terminal = function(argv) table.insert(runs, argv) end
concerto.open_output = function(argv) table.insert(runs, argv) end
vim.cmd("edit src/billing.ts")
vim.api.nvim_buf_set_lines(0, 0, -1, false, { "export function total(a: number) {", "  return a * 1.2;", "}" })
vim.bo.filetype = "typescript"
vim.cmd("2,3Concerto round to cents")
vim.cmd("ConcertoPlan add a refund flow")
vim.cmd("Concerto")
io.stdout:write(vim.json.encode(runs))
`;

describe("the Neovim plugin", () => {
  it.skipIf(!hasNvim)("starts a run from a selection, plans a request, and opens the TUI bare", () => {
    const runs = JSON.parse(nvim(tempDir(), SCRIPT)) as string[][];
    expect(runs[0]).toEqual(["concerto", "In src/billing.ts lines 2-3:\n```typescript\n  return a * 1.2;\n}\n```\n\nround to cents"]);
    expect(runs[1]).toEqual(["concerto", "--plan", "--explain", "add a refund flow"]);
    expect(runs[2]).toEqual(["concerto"]);
  });

  it.skipIf(!hasNvim || process.platform === "win32")("really starts the command in a terminal split", () => {
    const cwd = tempDir();
    const fake = join(cwd, "fake-concerto");
    writeFileSync(fake, `#!/bin/sh\nprintf '%s' "$1" > "${join(cwd, "got.txt")}"\n`, { mode: 0o700 });
    nvim(cwd, `require("concerto").setup({ cmd = "${fake}" })\nvim.cmd("Concerto fix the bug")\nvim.wait(3000, function() return vim.fn.filereadable("got.txt") == 1 end)`);
    expect(readFileSync(join(cwd, "got.txt"), "utf8")).toBe("fix the bug");
  });
});
