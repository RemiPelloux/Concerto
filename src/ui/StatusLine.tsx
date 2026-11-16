import { Box, Text } from "ink";
import { t } from "#src/i18n/index.js";
import type { State } from "#src/state/types.js";
import { COLOR, ROLE_COLOR, shortModel } from "#src/ui/theme.js";
import { unfinished } from "#src/ui/RunSummary.js";
import type { Zone } from "#src/ui/useNavigation.js";

function zoneHint(zone: Exclude<Zone, "prompt">): string {
  const z = t().zone;
  return zone === "stories" ? z.stories() : z[zone];
}

/** After a run with stories left, the first thing to say is that Enter retries them. */
function promptHint(state: State): string {
  const left = (state.phase === "done" || state.phase === "failed") ? unfinished(state).length : 0;
  return left ? t().retry(left) : t().phase[state.phase];
}

function hint(state: State, zone: Zone, overlay: boolean): string {
  if (overlay) return t().back;
  const base = zone === "prompt" ? promptHint(state) : zoneHint(zone);
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
