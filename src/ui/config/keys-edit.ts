import type { Key } from "ink";
import { addModel, chainAppend, chainMove, chainRemove, type Change } from "#src/ui/config/actions.js";
import { shown, typed } from "#src/ui/config/fields.js";
import type { Ctx } from "#src/ui/config/view.js";
import { assign, choices, slotModels, slotPath, type Slot } from "#src/ui/model-slots.js";

export function clamp(n: number, low: number, high: number): number {
  return Math.max(low, Math.min(n, high));
}

/** ↑ -1, ↓ 1, anything else 0. */
export function vertical(key: Key): number {
  return key.upArrow ? -1 : key.downArrow ? 1 : 0;
}

/** [ or shift+↑ moves the selected item up (-1), ] or shift+↓ down (1). */
export function reorder(input: string, key: Key): number {
  if (input === "[" || (key.shift && key.upArrow)) return -1;
  return input === "]" || (key.shift && key.downArrow) ? 1 : 0;
}

/** The slot of the selected model or chain field; null on any other field. */
function fieldSlot(ctx: Ctx): Slot | null {
  const field = ctx.fields[ctx.view.field];
  return field && (field.kind === "model" || field.kind === "chain") ? field.slot : null;
}

/** The change a new value makes to the selected field, or null when it cannot take one. */
export function fieldChange(ctx: Ctx, raw: unknown): Change | null {
  const field = ctx.fields[ctx.view.field];
  if (!field || raw === null || field.kind === "model" || field.kind === "chain") return null;
  return { raw, path: field.path, say: (next) => `${field.label.trim()} → ${shown(field, next, ctx.props.catalog)}` };
}

function finishText(ctx: Ctx): void {
  const { view, config } = ctx;
  const text = view.text ?? "";
  const field = ctx.fields[view.field];
  const change = view.adding ? addModel(config, text) : field ? fieldChange(ctx, typed(field, config, text)) : null;
  ctx.set({ ...view, text: null, adding: false, ...ctx.commit(change) });
}

/** Typing: ←→ home end move the caret, backspace deletes before it, enter saves, esc cancels. */
export function onText(ctx: Ctx, input: string, key: Key): void {
  const { view } = ctx;
  const text = view.text ?? "";
  const caret = Math.min(view.caret, text.length);
  const edit = (next: string, at: number) => ctx.set({ ...view, text: next, caret: at });
  if (key.escape) return ctx.set({ ...view, text: null, adding: false });
  if (key.return) return finishText(ctx);
  if (key.leftArrow || key.rightArrow) return ctx.set({ ...view, caret: clamp(caret + (key.leftArrow ? -1 : 1), 0, text.length) });
  if (key.home || (key.ctrl && input === "a")) return ctx.set({ ...view, caret: 0 });
  if (key.end || (key.ctrl && input === "e")) return ctx.set({ ...view, caret: text.length });
  if (key.backspace || key.delete) return caret > 0 ? edit(text.slice(0, caret - 1) + text.slice(caret), caret - 1) : undefined;
  const chunk = input.replace(/[\r\n]/g, "");
  if (chunk && !key.ctrl && !key.meta) edit(text.slice(0, caret) + chunk + text.slice(caret), caret + chunk.length);
}

/** The model list: enter makes the model first in the chain, or adds it at the end as a fallback. */
export function onPick(ctx: Ctx, key: Key): void {
  const { view, config } = ctx;
  const slot = fieldSlot(ctx);
  if (key.escape || !slot) return ctx.set({ ...view, pick: null, append: false });
  const options = choices(ctx.props.catalog, slot);
  const step = vertical(key);
  if (step !== 0) return ctx.set({ ...view, pick: clamp((view.pick ?? 0) + step, 0, options.length - 1) });
  const picked = options[view.pick ?? 0];
  if (!key.return || !picked) return;
  const first: Change = { raw: assign(config, slot, picked.ref), path: slotPath(slot), say: () => `${slot.label} → ${picked.ref}` };
  ctx.set({ ...view, pick: null, append: false, ...ctx.commit(view.append ? chainAppend(config, slot, picked.ref) : first) });
}

/** The chain editor: ↑↓ select, [ ] reorder, a add a fallback, d remove, esc back. */
export function onChain(ctx: Ctx, input: string, key: Key): void {
  const { view, config } = ctx;
  const slot = fieldSlot(ctx);
  const at = view.chain ?? 0;
  if (key.escape || !slot) return ctx.set({ ...view, chain: null });
  const size = slotModels(config, slot).length;
  const dir = reorder(input, key);
  if (dir !== 0) {
    const note = ctx.commit(chainMove(config, slot, { index: at, dir }));
    return ctx.set({ ...view, ...note, chain: note && !note.bad ? at + dir : at });
  }
  if (vertical(key) !== 0) return ctx.set({ ...view, chain: clamp(at + vertical(key), 0, Math.max(0, size - 1)) });
  if (input === "u") return ctx.set({ ...view, ...ctx.undo() });
  if (input === "a") return ctx.set({ ...view, pick: 0, append: true, note: "" });
  if (input === "d") ctx.set({ ...view, chain: clamp(at, 0, Math.max(0, size - 2)), ...ctx.commit(chainRemove(config, slot, at)) });
}

/** A delete waits for y; any other key keeps the item. */
export function onConfirm(ctx: Ctx, input: string): void {
  const { view } = ctx;
  const pending = view.confirm;
  if (!pending) return;
  if (input.toLowerCase() !== "y") return ctx.set({ ...view, confirm: null, note: "Kept.", bad: false });
  ctx.set({ ...view, confirm: null, ...pending.after, ...ctx.commit(pending.change) });
}
