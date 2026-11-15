import { Box, Text, useInput } from "ink";
import { useState } from "react";

type Props = { enabled: boolean; onSubmit: (text: string) => void };

export function PromptBar({ enabled, onSubmit }: Props) {
  const [value, setValue] = useState("");
  useInput(
    (input, key) => {
      if (key.return) {
        if (value.trim()) onSubmit(value.trim());
        setValue("");
        return;
      }
      if (key.backspace || key.delete) return setValue((v) => v.slice(0, -1));
      if (!key.ctrl && !key.meta && !key.escape) setValue((v) => v + input);
    },
    { isActive: enabled },
  );
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1}>
      <Text>
        {"> "}
        {value || <Text color="gray">{enabled ? "Describe the job. Say what done means." : ""}</Text>}
        {enabled ? <Text inverse> </Text> : null}
      </Text>
    </Box>
  );
}
