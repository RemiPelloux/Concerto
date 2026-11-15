import { Box, Text } from "ink";
import type { State } from "#src/state/types.js";
import { COLOR, ROLE_COLOR, shortModel } from "#src/ui/theme.js";
import { Tour } from "#src/ui/Tour.js";
import type { Overlay } from "#src/ui/useNavigation.js";

const HEIGHT = 30;
const PERCENT = 100;
const FACTOR = 13;
const PCT = 3;
const FRAME_CHROME = 3;

type Props = { overlay: NonNullable<Overlay>; state: State; scroll: number; close: () => void };

/** `lines` scrolled: a positive scroll moves down from the top, a negative one up from the end. */
function visible(lines: string[], scroll: number, fromEnd: boolean): string[] {
  const max = Math.max(0, lines.length - HEIGHT);
  const offset = fromEnd ? max - Math.min(max, Math.max(0, -scroll)) : Math.min(max, Math.max(0, scroll));
  return lines.slice(offset, offset + HEIGHT);
}

function Frame({ title, hint, children }: { title: React.ReactNode; hint: string; children: React.ReactNode }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLOR.brass} paddingX={1} minHeight={HEIGHT + FRAME_CHROME}>
      <Box justifyContent="space-between">
        <Text bold>{title}</Text>
        <Text color="gray">{hint}</Text>
      </Box>
      {children}
    </Box>
  );
}

function AgentOverlay({ id, state, scroll }: { id: string; state: State; scroll: number }) {
  const a = state.agents[id];
  if (!a) return <Text color="gray">This agent is gone.</Text>;
  const title = <Text color={ROLE_COLOR[a.role]}>{a.label} <Text color="gray">· {a.role} · {shortModel(a.model)} · {a.status}</Text></Text>;
  return (
    <Frame title={title} hint="live · ↑↓ scroll · esc back">
      {visible(a.lines, scroll, true).map((l, i) => (
        <Text key={i} color={l.startsWith("▸") ? COLOR.brass : l.startsWith("✗") ? COLOR.bad : undefined} wrap="truncate-end">{l || " "}</Text>
      ))}
    </Frame>
  );
}

function diffColor(line: string): string | undefined {
  if (line.startsWith("+++") || line.startsWith("---")) return "gray";
  if (line.startsWith("+")) return COLOR.good;
  if (line.startsWith("-")) return COLOR.bad;
  return line.startsWith("@@") ? COLOR.brass : undefined;
}

function DiffOverlay({ file, text, scroll }: { file: string; text: string; scroll: number }) {
  return (
    <Frame title={file} hint="↑↓ pgup pgdn scroll · esc back">
      {visible(text.split("\n"), scroll, false).map((l, i) => (
        <Text key={i} color={diffColor(l)} wrap="truncate-end">{l || " "}</Text>
      ))}
    </Frame>
  );
}

function StoryOverlay({ id, state }: { id: string; state: State }) {
  const v = state.stories[id];
  const story = state.plan?.stories.find((s) => s.id === id);
  if (!v || !story) return <Text color="gray">This story is gone.</Text>;
  const factors = v.factors.map((f) => `${f.key.padEnd(FACTOR)} ${String(Math.round(f.value * PERCENT)).padStart(PCT)}%  × ${Math.round(f.weight * PERCENT)}%  ${f.note}`);
  const reach = [`files     ${v.impact.files.join(", ") || "-"}`, `tests     ${v.impact.tests.join(", ") || "none"}`];
  return (
    <Frame title={`${story.title} · score ${v.score}`} hint="esc back">
      <Text color="gray">{`As ${story.asA}, I want ${story.iWant}, so that ${story.soThat}.`}</Text>
      {story.acceptance.map((a, i) => <Text key={i}>✓ {a}</Text>)}
      <Text bold>Why this score</Text>
      {factors.map((f, i) => <Text key={i}>{f}</Text>)}
      {reach.map((r, i) => <Text key={i} color="gray" wrap="truncate-end">{r}</Text>)}
      <Text>{`${v.rule} → ${v.chain.join(" > ")} · effort ${v.effort} · review ${v.critics[0] ?? "-"}`}</Text>
    </Frame>
  );
}

export function OverlayView({ overlay, state, scroll, close }: Props) {
  if (overlay.kind === "tour") return <Tour onClose={close} />;
  if (overlay.kind === "agent") return <AgentOverlay id={overlay.id} state={state} scroll={scroll} />;
  if (overlay.kind === "diff") return <DiffOverlay file={overlay.file} text={overlay.text} scroll={scroll} />;
  return <StoryOverlay id={overlay.id} state={state} />;
}
