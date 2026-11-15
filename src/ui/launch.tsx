import { render } from "ink";
import { probeTargets } from "../commands/setup.js";
import { detect } from "../setup/detect.js";
import { App, type AppDeps } from "./App.js";
import type { ExitReason } from "./slash.js";
import { Onboarding } from "./Onboarding.js";

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
  if (written) process.stdout.write(`Saved the working models to ${written}\n\n`);
}
