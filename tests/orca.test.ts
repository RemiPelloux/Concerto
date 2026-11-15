import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { orcaBin, shellQuote, worktreeName } from "../src/commands/orca.js";

describe("orca integration", () => {
  it("quotes a request into one literal shell argument, whatever it contains", () => {
    const nasty = `fix it'; rm -rf ~; echo "$HOME" \`id\``;
    const echoed = execFileSync("sh", ["-c", `printf %s ${shellQuote(nasty)}`]).toString();
    expect(echoed).toBe(nasty);
  });

  it("names the worktree from the first words of the request", () => {
    expect(worktreeName("Add CSV export to invoices. Done means: tests pass")).toBe("concerto-add-csv-export-to-invoices");
    expect(worktreeName("")).toBe("concerto-run");
    expect(worktreeName("é ! ?")).toBe("concerto-run");
  });

  it("uses the configured Orca CLI, and orca inside Orca's terminals", () => {
    expect(orcaBin({ ORCA_CLI_COMMAND: "orca-dev" })).toBe("orca-dev");
    expect(orcaBin({ ORCA_AGENT_HOOK_PORT: "1234" })).toBe("orca");
  });
});
