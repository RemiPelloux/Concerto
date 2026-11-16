#!/usr/bin/env node
/* global process, URL */
// Builds Concerto as one executable with Node's single executable applications, so it runs where
// Node is not installed: out/sea/concerto (concerto.exe on Windows), for the platform it runs on.
// Needs Node 25.5 or newer, for `node --build-sea`.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "out", "sea");
/** What Concerto reads from its own folder at run time; the executable carries them. */
const ASSETS = ["package.json", "concerto.config.json", ".pelloux/GUIDELINES.md", "prompts", "skills"];
const MIN_MAJOR = 25;

function files(path) {
  return statSync(join(ROOT, path)).isDirectory() ? readdirSync(join(ROOT, path)).flatMap((f) => files(join(path, f))) : [path.split("\\").join("/")];
}

async function bundle() {
  writeFileSync(join(OUT, "devtools-stub.mjs"), "export default { initialize() {}, connectToDevTools() {} };\n");
  await build({
    entryPoints: [join(ROOT, "src", "cli.ts")], bundle: true, platform: "node", format: "esm", target: "node22", conditions: ["source"],
    // Ink imports its devtools statically; they are only for development and are left out.
    alias: { "react-devtools-core": join(OUT, "devtools-stub.mjs") },
    banner: { js: "import { createRequire as __concertoRequire } from 'node:module'; const require = __concertoRequire(import.meta.url);" },
    outfile: join(OUT, "concerto.mjs"), logLevel: "warning",
  });
}

function seaConfig(output) {
  const names = ASSETS.flatMap(files);
  writeFileSync(join(OUT, "concerto-assets.json"), JSON.stringify(names));
  const assets = Object.fromEntries([...names.map((n) => [n, join(ROOT, n)]), ["concerto-assets.json", join(OUT, "concerto-assets.json")]]);
  const config = { main: join(OUT, "concerto.mjs"), mainFormat: "module", output, assets, disableExperimentalSEAWarning: true, useCodeCache: false };
  writeFileSync(join(OUT, "sea.json"), JSON.stringify(config, null, 2));
  return join(OUT, "sea.json");
}

async function main() {
  if (Number(process.versions.node.split(".")[0]) < MIN_MAJOR) throw new Error(`Node ${MIN_MAJOR}.5 or newer builds the executable; this is ${process.version}.`);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  await bundle();
  const output = join(OUT, process.platform === "win32" ? "concerto.exe" : "concerto");
  execFileSync(process.execPath, ["--build-sea", seaConfig(output)], { stdio: "inherit" });
  // macOS refuses an executable whose signature no longer matches: sign it ad hoc again.
  if (process.platform === "darwin") execFileSync("codesign", ["--sign", "-", "--force", output], { stdio: "inherit" });
  process.stdout.write(`Built ${relative(ROOT, output)}\n`);
}

await main();
