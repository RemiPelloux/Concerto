import { render } from "ink";
import { probeTargets } from "#src/commands/setup.js";
import { readConfigFile } from "#src/config/load.js";
import { catalogFrom } from "#src/models/catalog.js";
import { organigramLines } from "#src/setup/organigram.js";
import { detect } from "#src/setup/detect.js";
import { App, type AppDeps } from "#src/ui/App.js";
import type { ExitReason } from "#src/ui/slash.js";
import { Onboarding } from "#src/ui/Onboarding.js";
import { applyKeys } from "#src/ui/keys.js";
import { setLanguage } from "#src/i18n/index.js";
import { applyTheme } from "#src/ui/theme.js";

/** The only module that loads Ink and React: commands that print and exit never import it. */
export async function launchTui(deps: Omit<AppDeps, "onExit">): Promise<ExitReason> {
  applyTheme(deps.config.ui.theme);
  applyKeys(deps.config.ui.keys);
  setLanguage(deps.config.ui.language);
  process.stdout.write("\x1b[2J\x1b[H");
  let reason: ExitReason = "quit";
  // Not Ink's incrementalRendering: its own count of the lines on screen drifts on resizes and on
  // screens that change height, leaving old frames behind. Every screen stays shorter than the
  // terminal instead, so a full redraw never has to clear it.
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
