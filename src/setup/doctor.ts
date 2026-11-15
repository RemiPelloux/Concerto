import { configPath, userConfigPath } from "#src/config/load.js";
import type { ConcertoConfig } from "#src/config/types.js";
import type { Catalog } from "#src/models/catalog.js";
import { firstOf } from "#src/models/router.js";
import { ROLES } from "#src/config/types.js";
import { isBroken, readHealth } from "#src/models/health.js";
import type { Detection } from "#src/setup/detect.js";

const COUNT_WIDTH = 3;
const ROLE_WIDTH = 10;
const out = (line: string) => process.stdout.write(`${line}\n`);
const mark = (ok: boolean) => (ok ? "ok  " : "--  ");

function tools(d: Detection): void {
  out(`${mark(d.claude)}claude    Claude Code CLI (Claude subscription)`);
  out(`${mark(d.codex)}codex     Codex CLI (ChatGPT subscription)${d.profiles.length ? `, profiles: ${d.profiles.join(", ")}` : ""}`);
  out(`${mark(d.pi)}pi        pi (API keys for any provider)`);
  out(`${mark(d.rtk)}rtk       condensed shell output inside the agents (optional)`);
}

function linkedByVia(d: Detection): void {
  const groups = new Map<string, number>();
  d.linked.forEach((m) => groups.set(m.via, (groups.get(m.via) ?? 0) + 1));
  groups.forEach((n, via) => out(`      ${String(n).padStart(COUNT_WIDTH)} models via ${via}`));
}

/** `--doctor`: what is installed, what is linked, which config loads, and what each role runs on. */
export function printDoctor(cwd: string, d: Detection, setup: { config: ConcertoConfig; catalog: Catalog }): void {
  tools(d);
  linkedByVia(d);
  out("");
  out(`config    ${configPath(cwd)}`);
  if (configPath(cwd) !== userConfigPath()) out(`          (personal config: ${userConfigPath()}, written by --init)`);
  out(`reachable ${setup.catalog.models.length} of ${Object.keys(setup.config.models).length} configured models`);
  ROLES.forEach((r) => {
    const first = firstOf(setup.catalog, setup.config, r);
    out(`${r.padEnd(ROLE_WIDTH)}${first?.ref ?? "nothing reachable"}`);
  });
  const health = readHealth();
  const broken = Object.keys(setup.config.models).filter((ref) => isBroken(health, ref));
  broken.forEach((ref) => out(`skipped   ${ref}: ${health[ref]?.error ?? "failed its last probe"}`));
  if (!d.claude && !d.codex && !d.pi) out("\nInstall and log into at least one of: claude, codex, pi.");
}
