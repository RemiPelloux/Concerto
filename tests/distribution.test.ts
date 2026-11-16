import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { packageRoot, packageVersion } from "#src/config/root.js";
import { updateCommand } from "#src/commands/update.js";
import { checkForUpdate, firstLine, newer } from "#src/engine/update-check.js";

afterEach(() => vi.unstubAllGlobals());

describe("the update check", () => {
  it("compares versions by number, and keeps the first real line of the notes", () => {
    expect([newer("0.16.0", "0.13.0"), newer("0.13.0", "0.16.0"), newer("1.0.0", "0.19.9"), newer("v0.16.1", "0.16.0"), newer("0.16.0", "0.16.0")]).toEqual([true, false, true, true, false]);
    expect(firstLine("## Highlights\n\nPart 5: Concerto for teams.\nMore.")).toBe("Part 5: Concerto for teams.");
  });

  it("asks GitHub once a day at most, is quiet when current, and never runs in CI", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ tag_name: "v9.0.0", body: "Big release." })));
    vi.stubGlobal("fetch", fetch);
    expect(await checkForUpdate("0.16.0", {})).toEqual({ latest: "9.0.0", note: "Big release." });
    expect(await checkForUpdate("0.16.0", {})).toEqual({ latest: "9.0.0", note: "Big release." });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await checkForUpdate("9.0.0", {})).toBeNull();
    expect(await checkForUpdate("0.1.0", { CI: "true" })).toBeNull();
    expect(await checkForUpdate("0.1.0", { CONCERTO_NO_UPDATE_CHECK: "1" })).toBeNull();
  });

  it("is silent offline", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const { rmSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { userConfigPath } = await import("#src/config/load.js");
    rmSync(join(dirname(userConfigPath()), "update-check.json"), { force: true });
    expect(await checkForUpdate("0.16.0", {})).toBeNull();
  });
});

describe("updating the way Concerto was installed", () => {
  it("picks the package manager from where the executable lives", () => {
    expect(updateCommand("/opt/homebrew/Cellar/concerto/0.17.0/bin/concerto", true).manager).toBe("Homebrew");
    expect(updateCommand("C:\\Users\\a\\scoop\\apps\\concerto\\current\\concerto.exe", true, "win32").command).toEqual(["scoop", "update", "concerto"]);
    expect(updateCommand("/nix/store/abc-concerto-0.17.0/bin/concerto", true).manager).toBe("Nix");
    expect(updateCommand("/home/a/.local/share/concerto", false, "linux").command.at(-1)).toMatch(/install\.sh \| sh$/);
    expect(updateCommand("C:\\Users\\a\\AppData\\Local\\Concerto", false, "win32").command.at(-1)).toMatch(/install\.ps1 \| iex$/);
  });

  it("reads its own files from the package when it is not a single executable", () => {
    expect(packageVersion()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(existsSync(join(packageRoot(), "package.json")) && existsSync(join(packageRoot(), "prompts", "critic.md"))).toBe(true);
  });
});
