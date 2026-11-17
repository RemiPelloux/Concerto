import type { ConcertoConfig } from "#src/config/types.js";
import type { Catalog } from "#src/models/catalog.js";
import type { Change } from "#src/ui/config/actions.js";
import { modelFields, nodeFields, settingsFields, skillFields, type Field } from "#src/ui/config/fields.js";
import { organize, selectedSlot, type OrgAt } from "#src/ui/config/org.js";

export const TABS = ["Organigram", "Models", "Settings", "Skills"] as const;
export const ORG_TAB = 0;
export const MODELS_TAB = 1;
export const SKILLS_TAB = 3;

export type ConfigProps = { config: ConcertoConfig; catalog: Catalog; cwd: string; onApply: (config: ConcertoConfig) => void; onClose: () => void };
export type Note = { note: string; bad: boolean };
export type Confirm = { change: Change; question: string; after: Partial<View> };

/**
 * Where the keys go. `open`: the selected box's fields (organigram). `chain`: the cursor in a
 * model chain. `pick`: the model list, `append` when it adds a fallback. `text`/`caret`: typing,
 * `adding` when the text is a new model's ref. `confirm`: a delete waiting for y.
 */
export type View = Note & {
  tab: number;
  org: OrgAt;
  open: boolean;
  field: number;
  chain: number | null;
  pick: number | null;
  append: boolean;
  text: string | null;
  caret: number;
  adding: boolean;
  confirm: Confirm | null;
};

export const START: View = { tab: ORG_TAB, org: { col: 0, row: -1 }, open: false, field: 0, chain: null, pick: null, append: false, text: null, caret: 0, adding: false, confirm: null, note: "", bad: false };

/** What a key handler can read and do. `commit` validates, applies and saves; `undo` reverts the last one. */
export type Ctx = {
  props: ConfigProps;
  view: View;
  set: (v: View) => void;
  config: ConcertoConfig;
  fields: Field[];
  commit: (change: Change | string | null) => Note | null;
  undo: () => Note;
};

/** The fields under the cursor: the selected box's on the organigram, the tab's elsewhere. */
export function fieldsOf(view: View, config: ConcertoConfig, catalog: Catalog): Field[] {
  if (view.tab === MODELS_TAB) return modelFields(config, catalog);
  if (view.tab === SKILLS_TAB) return skillFields(config);
  if (view.tab !== ORG_TAB) return settingsFields();
  return nodeFields(selectedSlot(organize(config), view.org));
}

/** Fields have the keys: always outside the organigram, after Enter on a box inside it. */
export function focused(view: View): boolean {
  return view.tab !== ORG_TAB || view.open;
}
