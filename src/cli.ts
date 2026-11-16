#!/usr/bin/env node
import { parseArgs } from "node:util";
import { OPTIONS, USAGE } from "#src/commands/options.js";

/**
 * Entry point. Kept tiny on purpose: `--help` and `--version` load nothing else, the commands
 * load what they need, and only the terminal UI pays for Ink and React.
 */
async function main(): Promise<void> {
  // Inside the Linux sandbox: relay to the proxy, then run the agent. Never typed by a person.
  const [, , first, ...rest] = process.argv;
  if (first === "--sandbox-forward") return (await import("#src/commands/forward.js")).forward(rest);
  const { values, positionals } = parseArgs({ allowPositionals: true, options: OPTIONS });
  if (values.help) return void process.stdout.write(`${USAGE}\n`);
  if (values.version) {
    const { packageVersion } = await import("#src/config/root.js");
    return void process.stdout.write(`concerto ${packageVersion()}\n`);
  }
  const { run } = await import("#src/main.js");
  await run(values, positionals.join(" ").trim());
}

// `concerto --models | head` closes the pipe early: that is the reader's choice, not an error.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

/** Every crash names its session and log, with the full stack written to the log. */
async function report(error: unknown): Promise<void> {
  process.stderr.write(`concerto: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
  const { SessionLog } = await import("#src/engine/session-log.js");
  const log = SessionLog.current;
  if (!log) return;
  log.error(error, "crash");
  process.stderr.write(`session ${log.id} · full log: ${log.shownPath}\n`);
}

main().catch(report);
