import { Box, Text } from "ink";
import type { ConcertoConfig } from "#src/config/types.js";
import type { Catalog } from "#src/models/catalog.js";
import { shown, type Field } from "#src/ui/config/fields.js";
import { COLOR } from "#src/ui/theme.js";

export const ROWS = 16;
/** The label column: as wide as the longest label, so values line up, within these bounds. */
const MIN_LABEL = 26;
const MAX_LABEL = 44;
const VALUE = 40;

/** The `room` rows around the cursor, so a long list scrolls with it. */
export function around<T>(items: T[], at: number, room = ROWS): { rows: T[]; offset: number } {
  const offset = Math.max(0, Math.min(at - Math.floor(room / 2), items.length - room));
  return { rows: items.slice(offset, offset + room), offset };
}

/** What the keys do on this field. */
function keys(field: Field): string {
  if (field.kind === "number" || field.kind === "choice" || field.kind === "toggle") return "←→ change";
  if (field.kind === "chain") return "enter reorder";
  return field.kind === "model" ? "enter pick" : "enter type";
}

export type Editing = { text: string; caret: number };

/** Typed text with the caret drawn as an inverted cell. */
export function Typing({ text, caret }: Editing) {
  return <Text>{text.slice(0, caret)}<Text inverse>{text[caret] ?? " "}</Text>{text.slice(caret + 1)}</Text>;
}

/** `room`: how many rows the list may take. */
type ListProps = { fields: Field[]; at: number | null; editing: Editing | null; config: ConcertoConfig; catalog: Catalog; room?: number };

/** Settings as rows: label, value, and on the selected one what the keys do. `at` null: not focused. */
export function FieldList({ fields, at, editing, config, catalog, room }: ListProps) {
  const { rows, offset } = around(fields, at ?? 0, room);
  const label = Math.min(MAX_LABEL, Math.max(MIN_LABEL, ...fields.map((f) => f.label.length + 1)));
  return (
    <Box flexDirection="column">
      {rows.map((f, i) => {
        const on = offset + i === at;
        const value = on && editing ? <Typing {...editing} /> : shown(f, config, catalog).padEnd(VALUE);
        return (
          <Text key={`${f.label}-${offset + i}`} color={on ? COLOR.brass : undefined} wrap="truncate-end">
            {on ? "› " : "  "}{f.label.padEnd(label)} {value} <Text color="gray">{on ? `${keys(f)}${f.hint ? ` · ${f.hint}` : ""}` : (f.hint ?? "")}</Text>
          </Text>
        );
      })}
    </Box>
  );
}
