import { render } from "ink";
import { probeTargets } from "#src/commands/setup.js";
import { readConfigFile } from "#src/config/load.js";
import { catalogFrom } from "#src/models/catalog.js";
import { organigramLines } from "#src/setup/organigram.js";
import { detect } from "#src/setup/detect.js";
import { App, type AppDeps } from "#src/ui/App.js";
import type { ExitReason } from "#src/ui/slash.js";
import { Onboarding } from "#src/ui/Onboarding.js";

/** The only module that loads Ink and React: commands that print and exit never import it. */
export async function launchTui(deps: Omit<AppDeps, "onExit">): Promise<ExitReason> {
  process.stdout.write("\x1b[2J\x1b[H");
  let reason: ExitReason = "quit";
  await render(<App {...deps} onExit={(r) => (reason = r)} />).waitUntilExit();
  return reason;
}

/** The interactive first-launch screen. Resolves once the personal config is written. */
export async function runOnboarding(): Promise<void> {
  const detection = await detect();
  const targets = await probeTargets(detection);
  let written = "";
  await render(<Onboarding detection={detection} targets={targets} onDone={(path) => (written = path)} />).waitUntilExit();
  if (!written) return;
  const config = readConfigFile(written);
  const chart = organigramLines(catalogFrom(config), config).join("\n");
  process.stdout.write(`Saved the working models to ${written}\n\nOrganigram\n${chart}\n\n`);
}
