import { Box, Text, useApp, useInput } from "ink";
import { useEffect, useState } from "react";
import { probeAndSave } from "../commands/setup.js";
import type { Detection } from "../setup/detect.js";
import { buildUserConfig, ROUTINGS, writeUserConfig, type Routing } from "../setup/user-config.js";
import { Banner } from "./Banner.js";
import { COLOR, ROLE_COLOR } from "./theme.js";

const CHOICES = Object.keys(ROUTINGS) as Routing[];
const NAME_WIDTH = 8;

type Progress = { done: number; failed: string[]; working: Set<string> | null };

function Check({ ok, name, detail }: { ok: boolean; name: string; detail: string }) {
  return (
    <Text>
      <Text color={ok ? COLOR.good : COLOR.bad}>{ok ? "✓ " : "✗ "}</Text>
      <Text bold>{name.padEnd(NAME_WIDTH)}</Text>
      <Text color="gray">{detail}</Text>
    </Text>
  );
}

function Found({ d, total, p }: { d: Detection; total: number; p: Progress }) {
  const working = p.working ? `${p.working.size} of ${total} models answered` : `testing ${p.done} of ${total} models, one tiny prompt each`;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginY={1}>
      <Text bold>What Concerto found on this machine</Text>
      <Check ok={d.claude} name="claude" detail="Claude Code, runs Claude models on your subscription" />
      <Check ok={d.codex} name="codex" detail={`Codex, runs GPT models on ChatGPT${d.profiles.length ? ` · profiles ${d.profiles.join(", ")}` : ""}`} />
      <Check ok={d.pi} name="pi" detail="any provider you hold an API key for, proxies included" />
      <Check ok={d.rtk} name="rtk" detail="optional: condensed shell output inside the agents" />
      <Text color={ROLE_COLOR.conductor}>{working}</Text>
      {p.failed.length > 0 ? <Text color="gray" wrap="truncate-end">left out: {p.failed.join(", ")}</Text> : null}
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

function useProbe(targets: string[]): Progress {
  const [p, setP] = useState<Progress>({ done: 0, failed: [], working: null });
  useEffect(() => {
    const onResult = (ref: string, ok: boolean) => setP((s) => ({ ...s, done: s.done + 1, failed: ok ? s.failed : [...s.failed, ref] }));
    probeAndSave(targets, onResult).then((working) => setP((s) => ({ ...s, working })));
  }, [targets]);
  return p;
}

/** First launch: tests every linked model, asks where calls go first, writes the working ones. */
export function Onboarding({ detection, targets, onDone }: { detection: Detection; targets: string[]; onDone: (path: string) => void }) {
  const [pick, setPick] = useState(0);
  const progress = useProbe(targets);
  const { exit } = useApp();
  useInput((input, key) => {
    if (key.upArrow || key.downArrow) return setPick((p) => (p + (key.upArrow ? CHOICES.length - 1 : 1)) % CHOICES.length);
    const choice = CHOICES[key.return ? pick : Number(input) - 1];
    if (!choice || !progress.working) return;
    onDone(writeUserConfig(buildUserConfig(detection, choice, progress.working)));
    exit();
  });
  return (
    <Box flexDirection="column" paddingX={1}>
      <Banner />
      <Found d={detection} total={targets.length} p={progress} />
      {progress.working ? <Choices pick={pick} /> : <Text color="gray">Testing models… (ctrl+c to stop)</Text>}
    </Box>
  );
}
