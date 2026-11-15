import { Box, Text } from "ink";
import type { State } from "#src/state/types.js";
import { COLOR, ROLE_COLOR, shortModel } from "#src/ui/theme.js";
import type { Zone } from "#src/ui/useNavigation.js";

const HINT: Record<State["phase"], string> = {
  idle: "enter to score · / for commands · tab to look around",
  scoring: "✻ Scoring… (esc to interrupt)",
  planned: "enter to build · esc to discard the plan · tab to inspect the stories",
  running: "✻ Working… tab to watch the agents · esc to interrupt",
  done: "done · tab to review the changes · type a new request",
  failed: "stopped · tab to see what happened · type a new request",
};

const ZONE_HINT: Record<Exclude<Zone, "prompt">, string> = {
  agents: "agents · ↑↓ select · enter live output · tab next · esc prompt",
  stories: "stories · ↑↓ select · enter why this score · tab next · esc prompt",
  changes: "changes · ↑↓ select · enter diff · tab next · esc prompt",
};

function hint(state: State, zone: Zone, overlay: boolean): string {
  if (overlay) return "esc back";
  const base = zone === "prompt" ? HINT[state.phase] : ZONE_HINT[zone];
  return state.error && zone === "prompt" ? `${base} · ${state.error}` : base;
}

/** A plan waiting for Enter is the one moment the hint asks for something: it stands out. */
export function hintTone(state: State, zone: Zone, overlay: boolean): { color: string; bold: boolean } {
  const atPrompt = zone === "prompt" && !overlay;
  if (atPrompt && state.phase === "planned") return { color: COLOR.brass, bold: true };
  return { color: atPrompt && state.phase === "failed" ? COLOR.bad : COLOR.dim, bold: false };
}

export function StatusLine({ state, zone, overlay, session }: { state: State; zone: Zone; overlay: boolean; session: string }) {
  const { color, bold } = hintTone(state, zone, overlay);
  return (
    <Box justifyContent="space-between">
      <Box flexShrink={1}>
        <Text color={color} bold={bold} wrap="truncate-end">{hint(state, zone, overlay)}</Text>
      </Box>
      <Box flexShrink={0} marginLeft={2}>
        <Text>
          <Text color={ROLE_COLOR.conductor}>advisor: {shortModel(state.roles.conductor.model)}</Text>
          <Text color="gray"> · </Text>
          <Text color={ROLE_COLOR.soloist}>{shortModel(state.roles.soloist.model)}</Text>
          <Text color="gray"> · {session}</Text>
        </Text>
      </Box>
    </Box>
  );
}
