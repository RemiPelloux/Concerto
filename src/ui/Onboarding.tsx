import { Box, Text, useApp, useInput } from "ink";
import { useState } from "react";
import type { Detection } from "../setup/detect.js";
import { buildUserConfig, ROUTINGS, writeUserConfig, type Routing } from "../setup/user-config.js";
import { Banner } from "./Banner.js";
import { COLOR, ROLE_COLOR } from "./theme.js";

const CHOICES = Object.keys(ROUTINGS) as Routing[];
const NAME_WIDTH = 8;

function Check({ ok, name, detail }: { ok: boolean; name: string; detail: string }) {
  return (
    <Text>
      <Text color={ok ? COLOR.good : COLOR.bad}>{ok ? "✓ " : "✗ "}</Text>
      <Text bold>{name.padEnd(NAME_WIDTH)}</Text>
      <Text color="gray">{detail}</Text>
    </Text>
  );
}

function Found({ d }: { d: Detection }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginY={1}>
      <Text bold>What Concerto found on this machine</Text>
      <Check ok={d.claude} name="claude" detail="Claude Code, runs Claude models on your subscription" />
      <Check ok={d.codex} name="codex" detail={`Codex, runs GPT models on ChatGPT${d.profiles.length ? ` · profiles ${d.profiles.join(", ")}` : ""}`} />
      <Check ok={d.pi} name="pi" detail="any provider you hold an API key for, proxies included" />
      <Check ok={d.rtk} name="rtk" detail="optional: condensed shell output inside the agents" />
      <Text color={ROLE_COLOR.conductor}>{d.linked.length} models linked</Text>
    </Box>
  );
}

function Choices({ pick }: { pick: number }) {
  return (
    <Box flexDirection="column">
      <Text bold>When a model is reachable several ways, which goes first?</Text>
      {CHOICES.map((c, i) => (
        <Text key={c} color={i === pick ? COLOR.brass : undefined}>
          {i === pick ? "› " : "  "}
          {i + 1}. {ROUTINGS[c].label} <Text color="gray">· {ROUTINGS[c].detail}</Text>
        </Text>
      ))}
      <Text color="gray">↑↓ and enter, or 1-3 · change it later in the config or with --prefer</Text>
    </Box>
  );
}

/** First launch: shows what is installed, asks where calls go first, writes the personal config. */
export function Onboarding({ detection, onDone }: { detection: Detection; onDone: (path: string) => void }) {
  const [pick, setPick] = useState(0);
  const { exit } = useApp();
  useInput((input, key) => {
    if (key.upArrow || key.downArrow) return setPick((p) => (p + (key.upArrow ? CHOICES.length - 1 : 1)) % CHOICES.length);
    const numbered = Number(input) - 1;
    const choice = CHOICES[key.return ? pick : numbered];
    if (!choice) return;
    onDone(writeUserConfig(buildUserConfig(detection, choice)));
    exit();
  });
  return (
    <Box flexDirection="column" paddingX={1}>
      <Banner />
      <Found d={detection} />
      <Choices pick={pick} />
    </Box>
  );
}
