import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { completeSlash } from "./slash.js";
import { COLOR } from "./theme.js";

type Props = { enabled: boolean; onSubmit: (text: string) => void; onTab: () => void };

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

function usePromptInput({ enabled, onSubmit, onTab }: Props): string {
  const [value, setValue] = useState("");
  useInput(
    (input, key) => {
      if (key.return) {
        if (value.trim()) onSubmit(value.trim());
        return setValue("");
      }
      if (key.tab) {
        const first = completeSlash(value)[0];
        if (!value.startsWith("/") || !first) return onTab();
        return setValue(`/${first.name}${first.args ? " " : ""}`);
      }
      if (key.backspace || key.delete) return setValue((v) => v.slice(0, -1));
      if (!key.ctrl && !key.meta && !key.escape) setValue((v) => v + input);
    },
    { isActive: enabled },
  );
  return value;
}

/** The request line. A leading "/" turns it into a command, with suggestions and tab completion. */
export function PromptBar({ enabled, onSubmit, onTab }: Props) {
  const value = usePromptInput({ enabled, onSubmit, onTab });
  return (
    <Box flexDirection="column">
      <Suggestions value={value} />
      <Box borderStyle="round" borderColor="gray" paddingX={1}>
        <Text>
          {"> "}
          {value || <Text color="gray">{enabled ? "Describe the job and what done means, or type / for commands." : ""}</Text>}
          {enabled ? <Text inverse> </Text> : null}
        </Text>
      </Box>
    </Box>
  );
}
