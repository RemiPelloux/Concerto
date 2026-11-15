#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { OPTIONS, USAGE } from "#src/commands/options.js";

/**
 * Entry point. Kept tiny on purpose: `--help` and `--version` load nothing else, the commands
 * load what they need, and only the terminal UI pays for Ink and React.
 */
async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: OPTIONS });
  if (values.help) return void process.stdout.write(`${USAGE}\n`);
  if (values.version) {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    return void process.stdout.write(`concerto ${pkg.version}\n`);
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
