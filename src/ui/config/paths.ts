import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { bundledConfigPath, editableConfigPath, userConfigPath } from "#src/config/load.js";
import type { ConcertoConfig } from "#src/config/types.js";
import { writeUserConfig } from "#src/setup/user-config.js";

/** Where a value lives in the config, e.g. ["roles", "critic", "effort"] or ["routes", 0, "tags"]. */
export type Path = readonly (string | number)[];

export function getIn(root: unknown, path: Path): unknown {
  return path.reduce<unknown>((node, key) => (typeof node === "object" && node !== null ? Reflect.get(node, key) : undefined), root);
}

/** A copy of `root` with `value` at `path`; missing objects on the way are created, undefined deletes. */
export function setIn(root: unknown, path: Path, value: unknown): unknown {
  const [key, ...rest] = path;
  if (key === undefined) return value;
  const copy: object = Array.isArray(root) ? [...root] : { ...(typeof root === "object" ? root : {}) };
  const child = setIn(Reflect.get(copy, key), rest, value);
  if (child === undefined) Reflect.deleteProperty(copy, key);
  else Reflect.set(copy, key, child);
  return copy;
}

/**
 * Saves one changed value to the config in use and leaves the rest of the file as it was, so hand
 * edits and comments stay. The bundled default is never edited: the personal config gets the whole
 * config instead.
 */
export function savePath(cwd: string, config: ConcertoConfig, path: Path): string {
  const file = editableConfigPath(cwd);
  if (file === bundledConfigPath() || !existsSync(file)) return writeUserConfig(config, userConfigPath());
  const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, `${JSON.stringify(setIn(raw, path, getIn(config, path)), null, 2)}\n`);
  return file;
}
