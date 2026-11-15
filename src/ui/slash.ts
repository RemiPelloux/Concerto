import { routingLines, statsLines } from "#src/commands/info.js";
import { configPath } from "#src/config/load.js";
import { ROLES, type ConcertoConfig } from "#src/config/types.js";
import type { Catalog } from "#src/models/catalog.js";
import { isBroken, readHealth } from "#src/models/health.js";
import { roleChain } from "#src/models/router.js";
import type { SessionLog } from "#src/engine/session-log.js";
import type { Store } from "#src/state/store.js";

export type Panel = { title: string; lines: string[] };
export type Session = { config: ConcertoConfig; catalog: Catalog };
export type ExitReason = "quit" | "setup";

export type SlashContext = {
  cwd: string;
  store: Store;
  session: Session;
  setSession: (s: Session) => void;
  show: (panel: Panel | null) => void;
  exit: (reason: ExitReason) => void;
  tour: () => void;
  log: SessionLog;
};

type Command = { name: string; args: string; help: string; run: (arg: string, ctx: SlashContext) => Promise<void> | void };

const CENTS = 2;
const ROUTE_NAME = 14;
const HELP_NAME = 20;

export function parseSlash(text: string): { name: string; arg: string } | null {
  const match = /^\/([a-z-]+)\s*(.*)$/i.exec(text.trim());
  return match ? { name: (match[1] ?? "").toLowerCase(), arg: (match[2] ?? "").trim() } : null;
}

function seedRoles(ctx: SlashContext, session: Session): void {
  ROLES.forEach((role) => ctx.store.role(role, { model: roleChain(session.catalog, session.config, role)[0]?.ref ?? "" }));
}

function updateConfig(ctx: SlashContext, patch: Partial<ConcertoConfig>, note: string): void {
  const session = { ...ctx.session, config: { ...ctx.session.config, ...patch } };
  ctx.setSession(session);
  seedRoles(ctx, session);
  ctx.show({ title: "Session updated", lines: [note, "Applies to the next request in this session. The config file is unchanged."] });
}

function configLines(ctx: SlashContext): string[] {
  const c = ctx.session.config;
  const routes = c.routes.map((r) => `  ${r.name.padEnd(ROUTE_NAME)} ${r.tags.length ? `tags ${r.tags.join(",")}` : `score ≥ ${r.minScore}`} → ${r.models[0] ?? "-"}`);
  return [
    `file      ${configPath(ctx.cwd)}`,
    `prefer    ${c.prefer.join(", ") || "(none)"}`,
    `budget    ${c.budgetUsd === undefined ? "(none)" : `$${c.budgetUsd.toFixed(CENTS)}`}`,
    `timeout   ${c.timeoutMinutes} min per call · swarm ${c.swarm.maxParallel} in parallel`,
    `models    ${ctx.session.catalog.models.length} reachable of ${Object.keys(c.models).length} configured`,
    "routes",
    ...routes,
    "Edit the file, then /reload. /budget and /prefer change this session only.",
  ];
}

function doctorLines(ctx: SlashContext): string[] {
  const health = readHealth();
  const skipped = Object.keys(ctx.session.config.models).filter((ref) => isBroken(health, ref));
  const lines = skipped.map((ref) => `skipped  ${ref}: ${health[ref]?.error ?? "failed its last probe"}`);
  return lines.length > 0 ? [...lines, "Fix the login or key, then /probe."] : ["No model is skipped. /probe retests them all."];
}

async function reload(ctx: SlashContext): Promise<void> {
  const [{ loadConfig }, { loadCatalog }] = await Promise.all([import("#src/config/load.js"), import("#src/models/catalog.js")]);
  const config = loadConfig(ctx.cwd);
  const session = { config, catalog: await loadCatalog(config) };
  ctx.setSession(session);
  seedRoles(ctx, session);
  ctx.show({ title: "Reloaded", lines: [`${configPath(ctx.cwd)}`, `${session.catalog.models.length} models reachable`] });
}

async function probe(ctx: SlashContext): Promise<void> {
  const { installedTargets, probeAndSave } = await import("#src/commands/setup.js");
  const targets = await installedTargets(ctx.session.config);
  const lines: string[] = [];
  ctx.show({ title: `Probing ${targets.length} models`, lines: ["one tiny prompt each…"] });
  const working = await probeAndSave(targets, (ref, ok) => {
    lines.push(`${ok ? "ok  " : "FAIL"} ${ref}`);
    ctx.show({ title: `Probing ${targets.length} models`, lines: [...lines] });
  });
  await reload(ctx);
  ctx.show({ title: `${working.size} of ${targets.length} models answered`, lines: lines.filter((l) => l.startsWith("FAIL")) });
}

function budget(arg: string, ctx: SlashContext): void {
  if (arg === "off") return updateConfig(ctx, { budgetUsd: undefined }, "No budget for this session.");
  const usd = Number(arg.replace("$", ""));
  if (!(usd > 0)) return ctx.show({ title: "Usage", lines: ["/budget 5    stop starting stories after $5", "/budget off  no budget"] });
  updateConfig(ctx, { budgetUsd: usd }, `Budget: $${usd.toFixed(CENTS)} per run.`);
}

function prefer(arg: string, ctx: SlashContext): void {
  if (!arg) return ctx.show({ title: "Usage", lines: ["/prefer ce-*            your proxy first", "/prefer claude-code,codex  subscriptions first", "/prefer off              config default"] });
  const list = arg === "off" ? [] : arg.split(/[\s,]+/).filter(Boolean);
  updateConfig(ctx, { prefer: list }, list.length ? `Providers tried first: ${list.join(", ")}.` : "No provider preference.");
}

async function orca(arg: string, ctx: SlashContext): Promise<void> {
  if (!arg) return ctx.show({ title: "Usage", lines: ["/orca <request>   build it in a new Orca worktree, in its own tab"] });
  const { runInOrca } = await import("#src/commands/orca.js");
  await runInOrca(arg);
  ctx.show({ title: "Started in Orca", lines: [`A new worktree is building: ${arg}`] });
}

export const COMMANDS: readonly Command[] = [
  { name: "help", args: "", help: "list these commands", run: (_a, ctx) => ctx.show({ title: "Commands", lines: COMMANDS.map((c) => `/${`${c.name} ${c.args}`.trim().padEnd(HELP_NAME)} ${c.help}`) }) },
  { name: "session", args: "", help: "this session's id and its log file, for debugging", run: (_a, ctx) => ctx.show({ title: "Session", lines: [`id    ${ctx.log.id}`, `log   ${ctx.log.shownPath}`, "Every phase, agent line and error with its stack is in that file. Attach it to a bug report."] }) },
  { name: "onboarding", args: "", help: "replay the animated tour of Concerto", run: (_a, ctx) => ctx.tour() },
  { name: "setup", args: "", help: "detect and test your models again, then pick the routing", run: (_a, ctx) => ctx.exit("setup") },
  { name: "config", args: "", help: "the config in use: file, preference, budget, routes", run: (_a, ctx) => ctx.show({ title: "Configuration", lines: configLines(ctx) }) },
  { name: "models", args: "", help: "each role's model chain and how stories route", run: (_a, ctx) => ctx.show({ title: "Models", lines: routingLines(ctx.session.catalog, ctx.session.config) }) },
  { name: "doctor", args: "", help: "models skipped after a failed probe, and why", run: (_a, ctx) => ctx.show({ title: "Doctor", lines: doctorLines(ctx) }) },
  { name: "probe", args: "", help: "test every installed model with one tiny prompt", run: (_a, ctx) => probe(ctx) },
  { name: "reload", args: "", help: "read the config file again", run: (_a, ctx) => reload(ctx) },
  { name: "budget", args: "<usd|off>", help: "spending cap for this session", run: budget },
  { name: "prefer", args: "<providers|off>", help: "providers tried first, e.g. ce-*", run: prefer },
  { name: "stats", args: "", help: "tokens, cache hits and savings for this repository", run: (_a, ctx) => ctx.show({ title: "Stats", lines: statsLines(ctx.cwd) }) },
  { name: "orca", args: "<request>", help: "build a request in a new Orca worktree", run: orca },
  { name: "clear", args: "", help: "clear the plan and the log", run: (_a, ctx) => ctx.store.update(() => ({ phase: "idle", plan: null, stories: {}, order: [], log: [], error: "" })) },
  { name: "quit", args: "", help: "leave Concerto", run: (_a, ctx) => ctx.exit("quit") },
];

/** Commands whose name starts with what was typed after the slash. */
export function completeSlash(text: string): Command[] {
  const typed = parseSlash(text)?.name ?? (text === "/" ? "" : null);
  return typed === null ? [] : COMMANDS.filter((c) => c.name.startsWith(typed));
}

export async function runSlash(text: string, ctx: SlashContext): Promise<void> {
  const parsed = parseSlash(text);
  const command = COMMANDS.find((c) => c.name === parsed?.name);
  if (!parsed || !command) return ctx.show({ title: "Unknown command", lines: [`${text} is not a command. Type /help.`] });
  try {
    await command.run(parsed.arg, ctx);
  } catch (error) {
    ctx.show({ title: `/${command.name} failed`, lines: [error instanceof Error ? error.message : String(error)] });
  }
}
