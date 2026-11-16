import { Box, Text, useInput } from "ink";
import { useRef, useState } from "react";
import { configPath } from "#src/config/load.js";
import type { ConcertoConfig } from "#src/config/types.js";
import type { Catalog } from "#src/models/catalog.js";
import type { ModelInfo } from "#src/models/types.js";
import { assign, choices, current, saveChoice, slots, type Slot } from "#src/ui/model-slots.js";
import { COLOR } from "#src/ui/theme.js";

const ROWS = 18;
const LABEL = 26;
const REF = 40;
const CENTS = 2;

export type PickerProps = { config: ConcertoConfig; catalog: Catalog; cwd: string; onApply: (config: ConcertoConfig) => void; onClose: () => void };
type Cursor = { slot: number; model: number | null; note: string };

/** The rows around the cursor, so a long list scrolls with it. */
function around<T>(items: T[], at: number): { rows: T[]; offset: number } {
  const offset = Math.max(0, Math.min(at - Math.floor(ROWS / 2), items.length - ROWS));
  return { rows: items.slice(offset, offset + ROWS), offset };
}

function cost(m: ModelInfo): string {
  if (m.costFactor < 1) return "subscription";
  return m.price ? `$${m.price.input}/$${m.price.output} per M` : "no price";
}

function move(n: number, step: number, size: number): number {
  return Math.max(0, Math.min(n + step, size - 1));
}

type Keys = PickerProps & { list: Slot[]; at: Cursor; set: (c: Cursor) => void };

function onModelKeys(k: Keys, key: { return: boolean; escape: boolean }, step: number): void {
  const slot = k.list[k.at.slot];
  const options = slot ? choices(k.catalog, slot) : [];
  if (key.escape || !slot) return k.set({ ...k.at, model: null });
  if (step !== 0) return k.set({ ...k.at, model: move(k.at.model ?? 0, step, options.length) });
  const picked = options[k.at.model ?? 0];
  if (!key.return || !picked) return;
  const next = assign(k.config, slot, picked.ref);
  const path = saveChoice(k.cwd, next, slot);
  k.onApply(next);
  k.set({ slot: k.at.slot, model: null, note: `${slot.label} → ${picked.ref} · saved to ${path}` });
}

/** The cursor lives in a ref too, so keys arriving faster than renders (a held arrow) all count. */
function useCursor(): [Cursor, () => Cursor, (c: Cursor) => void] {
  const [at, setAt] = useState<Cursor>({ slot: 0, model: null, note: "" });
  const live = useRef(at);
  const set = (c: Cursor) => {
    live.current = c;
    setAt(c);
  };
  return [at, () => live.current, set];
}

function usePicker(props: PickerProps) {
  const list = slots(props.config);
  const [shown, now, set] = useCursor();
  useInput((_input, key) => {
    const at = now();
    const step = key.upArrow ? -1 : key.downArrow ? 1 : 0;
    if (at.model !== null) return onModelKeys({ ...props, list, at, set }, key, step);
    if (key.escape) return props.onClose();
    if (step !== 0) return set({ ...at, slot: move(at.slot, step, list.length) });
    const slot = list[at.slot];
    if (!key.return || !slot) return;
    const index = choices(props.catalog, slot).findIndex((m) => m.ref === current(props.config, props.catalog, slot));
    set({ ...at, model: Math.max(0, index), note: "" });
  });
  return { list, at: shown };
}

function SlotList({ list, at, config, catalog }: { list: Slot[]; at: number; config: ConcertoConfig; catalog: Catalog }) {
  const { rows, offset } = around(list, at);
  return (
    <Box flexDirection="column">
      {rows.map((s, i) => {
        const on = offset + i === at;
        const model = current(config, catalog, s) || "(none reachable)";
        return (
          <Text key={`${s.kind}-${s.key}`} color={on ? COLOR.brass : undefined} wrap="truncate-end">
            {on ? "› " : "  "}{s.label.padEnd(LABEL)} {model.padEnd(REF)} <Text color="gray">{s.duty}{s.brain ? " · premium only" : ""}</Text>
          </Text>
        );
      })}
    </Box>
  );
}

function ModelList({ options, at, chosen }: { options: ModelInfo[]; at: number; chosen: string }) {
  const { rows, offset } = around(options, at);
  return (
    <Box flexDirection="column">
      {rows.map((m, i) => {
        const on = offset + i === at;
        return (
          <Text key={m.ref} color={on ? COLOR.brass : undefined} wrap="truncate-end">
            {on ? "› " : "  "}{m.ref === chosen ? "● " : "  "}{m.ref.padEnd(REF)} <Text color="gray">tier {m.tier} · {cost(m)}</Text>
          </Text>
        );
      })}
    </Box>
  );
}

function Summary({ config, catalog, cwd }: { config: ConcertoConfig; catalog: Catalog; cwd: string }) {
  const budget = config.budgetUsd === undefined ? "no budget" : `budget $${config.budgetUsd.toFixed(CENTS)}`;
  const prefer = config.prefer.length ? `prefer ${config.prefer.join(", ")}` : "no provider preference";
  return <Text color="gray" wrap="truncate-end">{`${configPath(cwd)} · ${catalog.models.length} models reachable · ${prefer} · ${budget}`}</Text>;
}

/** `/config`: every role, build route and review rule with its model; ↑↓ and enter to change one. */
export function ModelPicker(props: PickerProps) {
  const { list, at } = usePicker(props);
  const slot = list[at.slot];
  const picking = at.model !== null && slot !== undefined;
  const hint = picking ? "↑↓ move · enter choose · esc back" : "↑↓ move · enter change · esc close";
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLOR.brass} paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color={COLOR.brass}>{picking ? `Pick the model for ${slot.label}` : "Who does what"}</Text>
        <Text color="gray">{hint}</Text>
      </Box>
      <Summary config={props.config} catalog={props.catalog} cwd={props.cwd} />
      {picking ? <ModelList options={choices(props.catalog, slot)} at={at.model ?? 0} chosen={current(props.config, props.catalog, slot)} /> : <SlotList list={list} at={at.slot} config={props.config} catalog={props.catalog} />}
      {picking && slot.brain ? <Text color="gray">Premium only: Deepseek, Grok, Haiku, GPT Terra and Luna never do brain work.</Text> : null}
      {at.note ? <Text color={COLOR.good} wrap="truncate-end">{at.note}</Text> : null}
    </Box>
  );
}
