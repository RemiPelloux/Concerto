import { routingLines, statsLines } from "#src/commands/info.js";
import { configPath } from "#src/config/load.js";
import { MAX_SCORE, ROLES, type ConcertoConfig, type Route } from "#src/config/types.js";
import type { Catalog } from "#src/models/catalog.js";
import { isBroken, readHealth } from "#src/models/health.js";
import { roleChain } from "#src/models/router.js";
import type { SessionLog } from "#src/engine/session-log.js";
import type { Store } from "#src/state/store.js";
import type { State } from "#src/state/types.js";
import { history } from "#src/ui/history.js";
import type { Edit } from "#src/orchestrator/edit.js";
import type { Concert } from "#src/orchestrator/concert.js";
import { REVIEW_COMMANDS } from "#src/ui/review-commands.js";
import { parseEdit, PLAN_EDITS } from "#src/ui/plan-commands.js";
import { listTemplates, saveTemplate, templateBrief } from "#src/engine/templates.js";

export type Panel = { title: string; lines: string[] };
/** `template`: the plan shape the scorer follows for the next requests, if one was picked. */
export type Session = { config: ConcertoConfig; catalog: Catalog; template?: string };
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
  /** Puts a saved session on screen and gets it ready to build. */
  resume: (state: State) => void;
  /** Changes the plan waiting for Enter; returns what was done. */
  edit: (edit: Edit) => Promise<string>;
  /** The run of this session, for reviewing its work: null before the first request. */
  concert: () => Concert | null;
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

/** What a route takes, e.g. "tags ui,ux" or "score ≥ 55" or "score < 25". */
function routeMatch(r: Route): string {
  const parts = [r.tags.length ? `tags ${r.tags.join(",")}` : "", r.minScore > 0 ? `score ≥ ${r.minScore}` : "", r.maxScore <= MAX_SCORE ? `score < ${r.maxScore}` : ""];
  return parts.filter(Boolean).join(" · ") || "any story";
}

function configLines(ctx: SlashContext): string[] {
  const c = ctx.session.config;
  const routes = c.routes.map((r) => `  ${r.name.padEnd(ROUTE_NAME)} ${routeMatch(r)} → ${r.models[0] ?? "-"}`);
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

/** `/drop`, `/merge`, `/route`…: one command per plan edit. */
const editCommands: Command[] = Object.entries(PLAN_EDITS).map(([name, spec]) => ({
  name,
  args: spec.usage,
  help: spec.help,
  run: async (arg, ctx) => {
    const edit = parseEdit(name, arg);
    if (typeof edit === "string") return ctx.show({ title: "Usage", lines: [edit] });
    ctx.show({ title: "Plan", lines: [await ctx.edit(edit), "Enter builds the plan; more edits, or Esc to discard it."] });
  },
}));

function template(arg: string, ctx: SlashContext): void {
  const [verb, name = ""] = arg.split(/\s+/);
  if (verb === "save" && name) {
    const plan = ctx.store.get().plan;
    if (!plan) return ctx.show({ title: "Template", lines: ["Score a request first: a template saves the shape of a plan."] });
    return ctx.show({ title: "Template", lines: [`Saved ${saveTemplate(name, plan)}`] });
  }
  if (verb === "use" && name) {
    templateBrief(name);
    ctx.setSession({ ...ctx.session, template: name });
    return ctx.show({ title: "Template", lines: [`Next requests are planned in the shape of "${name}". /template off stops it.`] });
  }
  if (verb === "off") return ctx.setSession({ ...ctx.session, template: undefined });
  ctx.show({ title: "Templates", lines: [`Saved: ${listTemplates().join(", ") || "none"}`, "/template save <name> · /template use <name> · /template off"] });
}

export const COMMANDS: readonly Command[] = [
  ...editCommands,
  ...REVIEW_COMMANDS,
  { name: "template", args: "save|use <name>", help: "save a plan's shape, or plan the next requests in one", run: template },
  { name: "help", args: "", help: "list these commands", run: (_a, ctx) => ctx.show({ title: "Commands", lines: COMMANDS.map((c) => `/${`${c.name} ${c.args}`.trim().padEnd(HELP_NAME)} ${c.help}`) }) },
  { name: "session", args: "", help: "this session's id and its log file, for debugging", run: (_a, ctx) => ctx.show({ title: "Session", lines: [`id    ${ctx.log.id}`, `log   ${ctx.log.shownPath}`, "Every phase, agent line and error with its stack is in that file. Attach it to a bug report."] }) },
  { name: "history", args: "[n|id]", help: "saved sessions; /history 2 reopens one and builds what did not pass", run: history },
  { name: "onboarding", args: "", help: "replay the animated tour of Concerto", run: (_a, ctx) => ctx.tour() },
  { name: "setup", args: "", help: "detect and test your models again, then pick the routing", run: (_a, ctx) => ctx.exit("setup") },
  { name: "config", args: "", help: "the config in use: file, preference, budget, routes", run: (_a, ctx) => ctx.show({ title: "Configuration", lines: configLines(ctx) }) },
  { name: "models", args: "", help: "each role's model chain and how stories route", run: (_a, ctx) => ctx.show({ title: "Models", lines: routingLines(ctx.session.catalog, ctx.session.config) }) },
  { name: "doctor", args: "", help: "models skipped after a failed probe, and why", run: (_a, ctx) => ctx.show({ title: "Doctor", lines: doctorLines(ctx) }) },
  { name: "probe", args: "", help: "test every installed model with one tiny prompt", run: (_a, ctx) => probe(ctx) },
  { name: "reload", args: "", help: "read the config file again", run: (_a, ctx) => reload(ctx) },
  { name: "budget", args: "<usd|off>", help: "spending cap for this session", run: budget },
  { name: "prefer", args: "<providers|off>", help: "providers tried first, e.g. ce-*", run: prefer },
  { name: "insights", args: "", help: "what past runs say: pass rate and cost per model, files that fail", run: async (_a, ctx) => ctx.show({ title: "Insights", lines: (await import("#src/commands/insights.js")).insightsLines(ctx.cwd) }) },
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
