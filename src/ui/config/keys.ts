import type { Key } from "ink";
import { addReview, addRoute, addSkill, removeItem, removeModel, swapItems } from "#src/ui/config/actions.js";
import { editText, stepped, type Field } from "#src/ui/config/fields.js";
import { clamp, fieldChange, onChain, onConfirm, onPick, onText, reorder, vertical } from "#src/ui/config/keys-edit.js";
import { BRANCHES, moveOrg, organize, selectedSlot, type Arrow, type Column } from "#src/ui/config/org.js";
import { focused, MODELS_TAB, ORG_TAB, SKILLS_TAB, START, TABS, type Ctx } from "#src/ui/config/view.js";
import { choices, current, type Slot } from "#src/ui/model-slots.js";

/** A new route opens on its name, a new review on its tags: the next thing to set. */
const NEW_RULE_FIELD = 2;
/** Each model and each skill rule takes two rows. */
const ROWS_PER_ITEM = 2;

function arrowOf(key: Key): Arrow | null {
  if (key.upArrow) return "up";
  if (key.downArrow) return "down";
  if (key.leftArrow) return "left";
  return key.rightArrow ? "right" : null;
}

/** Enter on a field: pick a model, edit a chain, type a list or text, or step forward. */
function enterField(ctx: Ctx, field: Field): void {
  const { view, config, props } = ctx;
  if (field.kind === "chain") return ctx.set({ ...view, chain: 0, note: "" });
  if (field.kind === "model") {
    const index = choices(props.catalog, field.slot).findIndex((m) => m.ref === current(config, props.catalog, field.slot));
    return ctx.set({ ...view, pick: Math.max(0, index), append: false, note: "" });
  }
  if (field.kind !== "list" && field.kind !== "text") return ctx.set({ ...view, ...ctx.commit(fieldChange(ctx, stepped(field, config, 1))) });
  const text = editText(field, config);
  ctx.set({ ...view, text, caret: text.length, note: "" });
}

/** a adds a route under the soloist or the section and a review under the critic, at the top. */
function addUnder(ctx: Ctx): void {
  const { view, config, props } = ctx;
  const role = view.org.row < 0 ? "conductor" : BRANCHES[view.org.col];
  const change = role === "critic" ? addReview(config, props.catalog) : role === "soloist" || role === "section" ? addRoute(config, props.catalog, role) : null;
  if (!change) return ctx.set({ ...view, note: "Routes go under the soloist and the section, reviews under the critic.", bad: true });
  const note = ctx.commit(change);
  const opened = note && !note.bad ? { org: { col: view.org.col, row: 1 }, open: true, field: NEW_RULE_FIELD } : {};
  ctx.set({ ...view, ...note, ...opened });
}

function askDelete(ctx: Ctx, slot: Slot): void {
  const { view } = ctx;
  if (slot.kind === "roles") return ctx.set({ ...view, note: "Roles always exist: change their model or chain instead.", bad: true });
  const after = { org: { ...view.org, row: view.org.row - 1 }, open: false, field: 0 };
  ctx.set({ ...view, confirm: { change: removeItem(ctx.config, slot.kind, slot.index), question: `Delete ${slot.label}?`, after } });
}

/** [ ] swaps a route or review with its neighbour in the column: the order is the order they are tried. */
function moveLeaf(ctx: Ctx, column: Column, dir: number): void {
  const { view } = ctx;
  const [here, there] = [column.leaves[view.org.row - 1], column.leaves[view.org.row - 1 + dir]];
  if (!here || !there || here.kind === "roles") return;
  const note = ctx.commit(swapItems(ctx.config, here.kind, [here.index, there.index]));
  ctx.set({ ...view, ...note, org: note && !note.bad ? { ...view.org, row: view.org.row + dir } : view.org });
}

function orgActions(ctx: Ctx, input: string, key: Key): void {
  const org = organize(ctx.config);
  const column = org.columns[ctx.view.org.col];
  const dir = reorder(input, key);
  if (input === "a") return addUnder(ctx);
  if (input === "d") return askDelete(ctx, selectedSlot(org, ctx.view.org));
  if (dir !== 0 && column) moveLeaf(ctx, column, dir);
}

function listActions(ctx: Ctx, input: string): void {
  const { view, config } = ctx;
  const item = Math.floor(view.field / ROWS_PER_ITEM);
  const after = { field: Math.max(0, (item - 1) * ROWS_PER_ITEM) };
  const ref = Object.keys(config.models)[item];
  if (view.tab === MODELS_TAB && input === "a") return ctx.set({ ...view, text: "", caret: 0, adding: true, note: "" });
  if (view.tab === MODELS_TAB && input === "d" && ref) return ctx.set({ ...view, confirm: { change: removeModel(config, ref), question: `Delete ${ref}?`, after } });
  if (view.tab !== SKILLS_TAB) return;
  if (input === "a") return ctx.set({ ...view, ...ctx.commit(addSkill(config)), field: config.skills.length * ROWS_PER_ITEM });
  if (input === "d" && config.skills[item]) ctx.set({ ...view, confirm: { change: removeItem(config, "skills", item), question: `Delete skill rule ${item + 1}?`, after } });
}

/** u undoes on every tab; a, d and [ ] act on what is selected. */
function actionKeys(ctx: Ctx, input: string, key: Key): void {
  if (input === "u") return ctx.set({ ...ctx.view, ...ctx.undo() });
  if (ctx.view.tab === ORG_TAB) return orgActions(ctx, input, key);
  listActions(ctx, input);
}

function onFields(ctx: Ctx, input: string, key: Key): void {
  const { view } = ctx;
  const field = ctx.fields[view.field];
  const arrow = key.shift ? null : arrowOf(key);
  if (key.escape) return view.tab === ORG_TAB ? ctx.set({ ...view, open: false }) : ctx.props.onClose();
  if (arrow === "up" || arrow === "down") return ctx.set({ ...view, field: clamp(view.field + vertical(key), 0, ctx.fields.length - 1) });
  if (field && arrow) return ctx.set({ ...view, ...ctx.commit(fieldChange(ctx, stepped(field, ctx.config, arrow === "left" ? -1 : 1))) });
  if (field && key.return) return enterField(ctx, field);
  actionKeys(ctx, input, key);
}

function onOrg(ctx: Ctx, input: string, key: Key): void {
  const { view } = ctx;
  const arrow = key.shift ? null : arrowOf(key);
  if (key.escape) return ctx.props.onClose();
  if (key.return) return ctx.set({ ...view, open: true, field: 0, note: "" });
  if (arrow) return ctx.set({ ...view, org: moveOrg(organize(ctx.config), view.org, arrow) });
  actionKeys(ctx, input, key);
}

export function onKey(ctx: Ctx, input: string, key: Key): void {
  const { view } = ctx;
  if (view.confirm) return onConfirm(ctx, input);
  if (view.text !== null) return onText(ctx, input, key);
  if (view.pick !== null) return onPick(ctx, key);
  if (view.chain !== null) return onChain(ctx, input, key);
  if (key.tab) return ctx.set({ ...START, tab: (view.tab + (key.shift ? -1 : 1) + TABS.length) % TABS.length });
  if (focused(view)) return onFields(ctx, input, key);
  onOrg(ctx, input, key);
}
