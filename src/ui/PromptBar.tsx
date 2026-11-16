import { Box, Text, useInput } from "ink";
import { t } from "#src/i18n/index.js";
import { useRef, useState } from "react";
import type { State } from "#src/state/types.js";
import { unfinished } from "#src/ui/RunSummary.js";
import { completeSlash } from "#src/ui/slash.js";
import { COLOR } from "#src/ui/theme.js";

/** `onEmpty`: Enter on an empty prompt (build the plan, or retry what did not pass). `hint`: what typing does now. */
type Props = { enabled: boolean; hint: string; onSubmit: (text: string) => void; onTab: () => void; onEmpty: () => void };

const SUGGESTIONS = 6;
const NAME_WIDTH = 22;

function Suggestions({ value }: { value: string }) {
  const matches = value.startsWith("/") && !value.includes(" ") ? completeSlash(value).slice(0, SUGGESTIONS) : [];
  if (matches.length === 0) return null;
  return (
    <Box flexDirection="column" paddingX={2}>
      {matches.map((c) => (
        <Text key={c.name}>
          <Text color={COLOR.brass}>{`/${c.name} ${c.args}`.trim().padEnd(NAME_WIDTH)}</Text>
          <Text color="gray">{c.help}</Text>
        </Text>
      ))}
      <Text color="gray">tab completes · enter runs</Text>
    </Box>
  );
}

const NEWLINE = /\r\n|\r|\n/;

/**
 * Text that arrives in one chunk can carry its own Enter: a paste ending in a newline, or keys
 * typed while the app was busy. Everything before the last newline is submitted (null: nothing
 * to submit yet); what follows stays in the prompt.
 */
export function splitTyped(current: string, chunk: string): { keep: string; submit: string | null } {
  const lines = (current + chunk).split(NEWLINE);
  const keep = lines.pop() ?? "";
  return { keep, submit: lines.length > 0 ? lines.join(" ").trim() : null };
}

/**
 * The typed text lives in a ref as well as in state: keys that arrive together must see each
 * other's edits before the next render, or Enter would read an empty prompt and build instead of
 * sending the text.
 */
function usePromptInput({ enabled, onSubmit, onTab, onEmpty }: Props): string {
  const [value, setValue] = useState("");
  const text = useRef("");
  const set = (next: string) => setValue((text.current = next));
  useInput(
    (input, key) => {
      const current = text.current;
      if (key.tab) {
        const first = completeSlash(current)[0];
        if (!current.startsWith("/") || !first) return onTab();
        return set(`/${first.name}${first.args ? " " : ""}`);
      }
      if (key.backspace || key.delete) return set(current.slice(0, -1));
      if (key.ctrl || key.meta || key.escape) return;
      const { keep, submit } = splitTyped(current, key.return ? "\n" : input);
      set(keep);
      if (submit !== null) return submit ? onSubmit(submit) : onEmpty();
    },
    { isActive: enabled },
  );
  return value;
}

/** What typing does in each phase, shown in the empty prompt. */
export function promptHint(state: State): string {
  const p = t().prompt;
  if (state.phase === "scoring" || state.phase === "planned" || state.phase === "running") return p[state.phase];
  const left = state.phase === "idle" ? 0 : unfinished(state).length;
  return left ? p.retry(left) : p.idle;
}

/** The request line. A leading "/" turns it into a command, with suggestions and tab completion. */
export function PromptBar(props: Props) {
  const { enabled, hint } = props;
  const value = usePromptInput(props);
  return (
    <Box flexDirection="column">
      <Suggestions value={value} />
      <Box borderStyle="round" borderColor="gray" paddingX={1}>
        <Text>
          {"> "}
          {value || <Text color="gray">{enabled ? hint : ""}</Text>}
          {enabled ? <Text inverse> </Text> : null}
        </Text>
      </Box>
    </Box>
  );
}
