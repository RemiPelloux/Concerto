import { useInput } from "ink";
import { useRef, useState, type RefObject } from "react";
import { parseConfig } from "#src/config/load.js";
import type { ConcertoConfig } from "#src/config/types.js";
import type { Change } from "#src/ui/config/actions.js";
import type { Field } from "#src/ui/config/fields.js";
import { onKey } from "#src/ui/config/keys.js";
import { savePath, type Path } from "#src/ui/config/paths.js";
import { fieldsOf, START, type ConfigProps, type Note, type View } from "#src/ui/config/view.js";

/** One saved change, kept so `u` can put the value back. */
type Step = { before: ConcertoConfig; path: Path };
type Store = { props: ConfigProps; live: RefObject<ConcertoConfig>; history: RefObject<Step[]> };

function failed(error: unknown): Note {
  const message = error instanceof Error ? error.message : String(error);
  return { note: message.split("\n").at(-1)?.trim() ?? message, bad: true };
}

function apply(store: Store, config: ConcertoConfig): void {
  store.live.current = config;
  store.props.onApply(config);
}

/** Validates the change, saves that one place in the config file and applies it to the session. */
function commit(store: Store, change: Change | string | null): Note | null {
  if (change === null) return null;
  if (typeof change === "string") return { note: change, bad: true };
  try {
    const next = parseConfig(change.raw, "this change");
    const file = savePath(store.props.cwd, next, change.path);
    store.history.current.push({ before: store.live.current, path: change.path });
    apply(store, next);
    return { note: `${change.say(next)} · saved to ${file}`, bad: false };
  } catch (error) {
    return failed(error);
  }
}

function undo(store: Store): Note {
  const last = store.history.current.pop();
  if (!last) return { note: "Nothing to undo.", bad: false };
  try {
    const file = savePath(store.props.cwd, last.before, last.path);
    apply(store, last.before);
    return { note: `Undone · saved to ${file}`, bad: false };
  } catch (error) {
    return failed(error);
  }
}

/**
 * The view and the config live in refs as well as in state: keys that arrive faster than renders
 * (a held arrow) all count, and each sees the change the previous one made.
 */
export function useConfigScreen(props: ConfigProps): { view: View; fields: Field[] } {
  const [shownView, setShown] = useState(START);
  const view = useRef(START);
  const store: Store = { props, live: useRef(props.config), history: useRef<Step[]>([]) };
  const set = (v: View) => setShown((view.current = v));
  useInput((input, key) => {
    const config = store.live.current;
    const fields = fieldsOf(view.current, config, props.catalog);
    onKey({ props, view: view.current, set, config, fields, commit: (c) => commit(store, c), undo: () => undo(store) }, input, key);
  });
  return { view: shownView, fields: fieldsOf(shownView, props.config, props.catalog) };
}
