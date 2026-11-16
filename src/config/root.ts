import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getAsset, isSea } from "node:sea";
import { fileURLToPath } from "node:url";

/** In a single executable, the list of files it carries: package.json, the config, prompts, skills. */
export const ASSET_INDEX = "concerto-assets.json";
const DONE = ".complete";
let root: string | null = null;

function cacheHome(): string {
  if (process.env.XDG_CACHE_HOME) return process.env.XDG_CACHE_HOME;
  return process.platform === "win32" && process.env.LOCALAPPDATA ? process.env.LOCALAPPDATA : join(homedir(), ".cache");
}

/** The executable's files, written once per version to the cache folder, where the rest of Concerto reads them. */
function unpack(): string {
  const names = JSON.parse(getAsset(ASSET_INDEX, "utf8")) as string[];
  const { version } = JSON.parse(getAsset("package.json", "utf8")) as { version: string };
  const dir = join(cacheHome(), "concerto", `app-${version}`);
  if (existsSync(join(dir, DONE))) return dir;
  names.forEach((name) => {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), Buffer.from(getAsset(name)));
  });
  writeFileSync(join(dir, DONE), "");
  return dir;
}

/** Where package.json, the bundled config, prompts and skills are: the package, or the executable's unpacked files. */
export function packageRoot(): string {
  root ??= isSea() ? unpack() : fileURLToPath(new URL("../..", import.meta.url));
  return root;
}

export function packageVersion(): string {
  return (JSON.parse(readFileSync(join(packageRoot(), "package.json"), "utf8")) as { version: string }).version;
}
