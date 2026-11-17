import { Box, Text, useStdout } from "ink";
import { configPath } from "#src/config/load.js";
import type { Field } from "#src/ui/config/fields.js";
import { FieldList, Typing } from "#src/ui/config/FieldList.js";
import { ChainList, ModelList } from "#src/ui/config/ModelList.js";
import { OrgChart } from "#src/ui/config/OrgChart.js";
import { BRANCHES, organize, selectedSlot } from "#src/ui/config/org.js";
import { useConfigScreen } from "#src/ui/config/useConfigScreen.js";
import { focused, MODELS_TAB, ORG_TAB, SKILLS_TAB, TABS, type ConfigProps, type View } from "#src/ui/config/view.js";
import { choices, current, slotModels } from "#src/ui/model-slots.js";
import { COLOR } from "#src/ui/theme.js";

const CENTS = 2;
/** The App's padding plus this frame's border and padding. */
const CHROME = 6;
/** Narrow enough that five columns fit an 80-column terminal; box titles shorten with … */
const MIN_COLUMN = 14;
const MAX_COLUMN = 34;
const DEFAULT_COLUMNS = 120;

type BodyProps = { view: View; fields: Field[]; props: ConfigProps };

const TAB_HINT: Record<number, string> = {
  [ORG_TAB]: "arrows move · enter edit · a add · d delete · [ ] reorder · u undo",
  [MODELS_TAB]: "↑↓ move · ←→ change · a add · d delete · u undo",
  [SKILLS_TAB]: "↑↓ move · enter edit · a add · d delete · u undo",
};

/** What the keys do now, by mode. */
function hintOf(view: View): string {
  if (view.confirm) return "y delete · any other key keeps it";
  if (view.text !== null) return "type · ←→ home end move · enter save · esc cancel";
  if (view.pick !== null) return "↑↓ move · enter choose · esc back";
  if (view.chain !== null) return "↑↓ move · [ ] or shift+↑↓ reorder · a add · d remove · u undo · esc back";
  const tab = TAB_HINT[view.tab] ?? "↑↓ move · ←→ change · enter edit · u undo";
  return `${tab} · tab next tab · esc ${view.tab === ORG_TAB && focused(view) ? "back" : "close"}`;
}

function TabBar({ view }: { view: View }) {
  return (
    <Box flexDirection="column">
      <Text>
        {TABS.map((t, i) => (
          <Text key={t} bold={i === view.tab} inverse={i === view.tab} color={i === view.tab ? COLOR.brass : "gray"}>{` ${t} `}</Text>
        ))}
      </Text>
      <Text color="gray" wrap="truncate-end">{hintOf(view)}</Text>
    </Box>
  );
}

function Summary({ props }: { props: ConfigProps }) {
  const { config, catalog, cwd } = props;
  const budget = config.budgetUsd === undefined ? "no budget" : `budget $${config.budgetUsd.toFixed(CENTS)}`;
  const prefer = config.prefer.length ? `prefer ${config.prefer.join(", ")}` : "no provider preference";
  return <Text color="gray" wrap="truncate-end">{`${configPath(cwd)} · ${catalog.models.length} models reachable · ${prefer} · ${budget}`}</Text>;
}

function Picking({ view, fields, props }: BodyProps) {
  const field = fields[view.field];
  if (field?.kind !== "model" && field?.kind !== "chain") return null;
  return (
    <Box flexDirection="column">
      <Text bold color={COLOR.brass}>{view.append ? "Add a fallback for" : "Pick the model for"} {field.slot.label}</Text>
      <ModelList options={choices(props.catalog, field.slot)} at={view.pick ?? 0} chosen={current(props.config, props.catalog, field.slot)} />
      {field.slot.brain ? <Text color="gray">Premium only: Deepseek, Grok, Haiku, GPT Terra and Luna never do brain work.</Text> : null}
    </Box>
  );
}

function Chain({ view, fields, props }: BodyProps) {
  const field = fields[view.field];
  if (field?.kind !== "chain" && field?.kind !== "model") return null;
  return (
    <Box flexDirection="column">
      <Text bold color={COLOR.brass}>Chain for {field.slot.label} <Text color="gray">· tried top to bottom, your preferred providers first</Text></Text>
      <ChainList models={slotModels(props.config, field.slot)} at={view.chain ?? 0} catalog={props.catalog} />
    </Box>
  );
}

/** Columns as wide as the terminal allows, within readable bounds. */
function useColumnWidth(): number {
  const columns = useStdout().stdout.columns ?? DEFAULT_COLUMNS;
  return Math.max(MIN_COLUMN, Math.min(Math.floor((columns - CHROME) / BRANCHES.length), MAX_COLUMN));
}

const editing = (view: View) => (view.text !== null && !view.adding ? { text: view.text, caret: view.caret } : null);

function Organigram({ view, fields, props }: BodyProps) {
  const org = organize(props.config);
  const slot = selectedSlot(org, view.org);
  const scene = { config: props.config, catalog: props.catalog, width: useColumnWidth() };
  return (
    <Box flexDirection="column">
      <OrgChart {...scene} org={org} at={view.org} />
      <Box flexDirection="column" borderStyle="single" borderColor={view.open ? COLOR.brass : "gray"} paddingX={1}>
        <Text bold>{slot.label} <Text color="gray">· {slot.duty}{view.open ? "" : " · enter to edit"}</Text></Text>
        <FieldList {...scene} fields={fields} at={view.open ? view.field : null} editing={editing(view)} />
      </Box>
    </Box>
  );
}

function Listing({ view, fields, props }: BodyProps) {
  const empty = view.tab === SKILLS_TAB ? "No skill rules yet: a adds one." : "No models yet: a adds one.";
  return (
    <Box flexDirection="column">
      {fields.length === 0 ? <Text color="gray">{empty}</Text> : <FieldList fields={fields} at={view.field} editing={editing(view)} config={props.config} catalog={props.catalog} />}
      {view.adding ? <Text color={COLOR.brass}>New model: <Typing text={view.text ?? ""} caret={view.caret} /> <Text color="gray">e.g. anthropic/claude-opus-5-5 · enter adds it at tier 3</Text></Text> : null}
    </Box>
  );
}

function Body(body: BodyProps) {
  const { view } = body;
  if (view.pick !== null) return <Picking {...body} />;
  if (view.chain !== null) return <Chain {...body} />;
  return view.tab === ORG_TAB ? <Organigram {...body} /> : <Listing {...body} />;
}

function Footer({ view }: { view: View }) {
  if (view.confirm) return <Text color={COLOR.bad} bold>{view.confirm.question} y to delete, any other key keeps it.</Text>;
  return view.note ? <Text color={view.bad ? COLOR.bad : COLOR.good} wrap="truncate-end">{view.note}</Text> : null;
}

/** `/config`: the organigram of who does what, every model, the settings and the skill rules, all editable. */
export function ConfigScreen(props: ConfigProps) {
  const { view, fields } = useConfigScreen(props);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLOR.brass} paddingX={1}>
      <TabBar view={view} />
      <Summary props={props} />
      <Body view={view} fields={fields} props={props} />
      <Footer view={view} />
    </Box>
  );
}
