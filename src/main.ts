import { clearCache, printModels, printStats } from "#src/commands/info.js";
import type { Values } from "#src/commands/options.js";
import { configPath, isFirstLaunch, loadConfig } from "#src/config/load.js";
import { keepSessions } from "#src/engine/history.js";
import { SessionLog } from "#src/engine/session-log.js";
import { ROLES, type ConcertoConfig } from "#src/config/types.js";
import { loadCatalog, type Catalog } from "#src/models/catalog.js";
import { firstOf } from "#src/models/router.js";
import { Store } from "#src/state/store.js";

export type Setup = { config: ConcertoConfig; catalog: Catalog; store: Store; cwd: string; log: SessionLog };

function overrides(values: Values): Partial<ConcertoConfig> {
  const budget = values.budget === undefined ? undefined : Number(values.budget);
  if (budget !== undefined && !(budget > 0)) throw new Error("--budget takes a positive number of dollars.");
  const prefer = values.prefer?.split(",").map((p) => p.trim()).filter(Boolean);
  return { ...(prefer ? { prefer } : {}), ...(budget ? { budgetUsd: budget } : {}) };
}

async function setup(values: Values): Promise<Setup> {
  const cwd = process.cwd();
  const config = { ...loadConfig(cwd), ...overrides(values) };
  const catalog = await loadCatalog(config);
  const log = SessionLog.current ?? new SessionLog(cwd);
  const store = new Store((kind, text) => log.write(kind, text));
  ROLES.forEach((role) => store.role(role, { model: firstOf(catalog, config, role)?.ref ?? "" }));
  keepSessions(store, { cwd, id: log.id });
  log.write("start", `concerto in ${cwd} · config ${configPath(cwd)} · ${catalog.models.length} models reachable`);
  log.write("start", `prefer ${config.prefer.join(",") || "-"} · budget ${config.budgetUsd ?? "-"} · roles ${ROLES.map((r) => `${r}=${store.get().roles[r].model}`).join(" ")}`);
  return { config, catalog, store, cwd, log };
}

async function printPlan(s: Setup, request: string): Promise<void> {
  const [{ createConcert }, { scoreRequest }, { runModel }] = await Promise.all([
    import("#src/orchestrator/concert.js"), import("#src/orchestrator/score.js"), import("#src/runner/index.js"),
  ]);
  await scoreRequest(await createConcert({ ...s, runner: runModel }), request);
  const { plan, order, stories } = s.store.get();
  process.stdout.write(`${JSON.stringify({ ...plan, routing: order.map((id) => stories[id]) }, null, 2)}\n`);
}

async function headless(s: Setup, request: string): Promise<void> {
  const [{ createConcert }, { runHeadless }, { runModel }] = await Promise.all([
    import("#src/orchestrator/concert.js"), import("#src/headless.js"), import("#src/runner/index.js"),
  ]);
  await runHeadless(await createConcert({ ...s, runner: runModel }), request, s.log);
}

/** Commands that need no model catalog. */
async function standalone(values: Values, request: string): Promise<boolean> {
  if (values.stats) return printStats(process.cwd()), true;
  if (values.insights) return (await import("#src/commands/insights.js")).insightsLines(process.cwd()).forEach((l) => process.stdout.write(`${l}\n`)), true;
  if (values["install-skills"]) return (await import("#src/commands/skills.js")).installSkills(), true;
  if (values.init) return await (await import("#src/commands/setup.js")).runInit(values.routing), true;
  if (values.orca) return await (await import("#src/commands/orca.js")).runInOrca(request), true;
  if (values.probe) return await (await import("#src/commands/setup.js")).runProbe(loadConfig(process.cwd())), true;
  return false;
}

/** Every command after argument parsing; modules load only for the command that runs. */
export async function run(values: Values, request: string): Promise<void> {
  if (await standalone(values, request)) return;
  const tui = !values.plan && !values.run && !values.models && !values.doctor && !values["clear-cache"];
  const firstLaunch = tui && process.stdin.isTTY && isFirstLaunch(process.cwd());
  if (firstLaunch) await (await import("#src/ui/launch.js")).runOnboarding();
  const s = await setup(values);
  if (values.doctor) return (await import("#src/setup/doctor.js")).printDoctor(s.cwd, await (await import("#src/setup/detect.js")).detect(), s);
  if (values["clear-cache"]) return clearCache(s.cwd, s.config);
  if (values.models) return printModels(s.catalog, s.config);
  if ((values.plan || values.run) && !request) throw new Error("--plan and --run need a request.");
  if (values.plan) return printPlan(s, request);
  if (values.run) return headless(s, request);
  return interactive(values, s, { request: values.resume ? `/history ${values.resume}` : request, tour: firstLaunch });
}

/** The TUI; `/setup` closes it, reruns onboarding with fresh detection, and opens it again. */
async function interactive(values: Values, first: Setup, start: { request: string; tour: boolean }): Promise<void> {
  const [{ launchTui, runOnboarding }, { runModel }] = await Promise.all([
    import("#src/ui/launch.js"), import("#src/runner/index.js"),
  ]);
  let s = first;
  for (let initial = start.request, tour = start.tour; ; initial = "", tour = false) {
    const reason = await launchTui({ ...s, runner: runModel, autoPerform: Boolean(values.yes), initialRequest: initial, showTour: tour });
    if (reason !== "setup") return;
    await runOnboarding();
    s = await setup(values);
  }
}
