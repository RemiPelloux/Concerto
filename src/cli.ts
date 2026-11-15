#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { OPTIONS, USAGE } from "./commands/options.js";

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
  const { run } = await import("./main.js");
  await run(values, positionals.join(" ").trim());
}

// `concerto --models | head` closes the pipe early: that is the reader's choice, not an error.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

main().catch((error: unknown) => {
  process.stderr.write(`concerto: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
