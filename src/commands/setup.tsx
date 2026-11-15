import { render } from "ink";
import { detect } from "../setup/detect.js";
import { buildUserConfig, ROUTINGS, writeUserConfig, type Routing } from "../setup/user-config.js";
import { Onboarding } from "../ui/Onboarding.js";

const out = (line: string) => process.stdout.write(`${line}\n`);

export function parseRouting(value: string | undefined): Routing {
  if (value === undefined) return "subscriptions";
  if (value in ROUTINGS) return value as Routing;
  throw new Error(`--routing must be one of: ${Object.keys(ROUTINGS).join(", ")}.`);
}

/** The interactive first-launch screen. Resolves once the personal config is written. */
export async function runOnboarding(): Promise<void> {
  const detection = await detect();
  let written = "";
  await render(<Onboarding detection={detection} onDone={(path) => (written = path)} />).waitUntilExit();
  if (written) out(`Saved ${detection.linked.length} linked models to ${written}\n`);
}

/** `--init`: the onboarding screen in a terminal, or a direct write in scripts and CI. */
export async function runInit(routing: string | undefined): Promise<void> {
  if (process.stdin.isTTY && routing === undefined) return runOnboarding();
  const detection = await detect();
  const path = writeUserConfig(buildUserConfig(detection, parseRouting(routing)));
  out(`Saved ${detection.linked.length} linked models to ${path} (${parseRouting(routing)} first).`);
}
