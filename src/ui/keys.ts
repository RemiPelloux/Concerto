/**
 * The keys of single-key actions, remappable in the config (`ui.keys`): in the story list d drops,
 * s splits, m merges; q closes a view. `next`, `up` and `down` add a key to Tab and the arrows
 * (for example j and k); empty adds nothing. The prompt always takes every key it is given.
 */
export const KEYS = { drop: "d", split: "s", merge: "m", close: "q", next: "", up: "", down: "" };
export type KeyAction = keyof typeof KEYS;

export function applyKeys(remap: Partial<Record<KeyAction, string>>): void {
  Object.assign(KEYS, remap);
}
