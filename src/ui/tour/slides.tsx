import { Box, Text } from "ink";
import { meter } from "#src/ui/meter.js";
import { COLOR, ROLE_COLOR } from "#src/ui/theme.js";
import { typed } from "#src/ui/tour/useTick.js";

const CHARS_PER_TICK = 2;
const BAR = 24;
const PERCENT = 100;
/** Animation timing, in frames of 70 ms. */
const T = { stagger: 6, grow: 20, travelStagger: 4, gate: 10, gateDelay: 5, notes: 35, fill: 30, keyEvery: 4 };
/** Column widths. */
const W = { title: 28, label: 22, key: 7 };

type Slide = { title: string; body: (t: number) => React.ReactNode };

function Bar({ value, color }: { value: number; color: string }) {
  const { filled, empty } = meter(value, 1, BAR);
  return (
    <Text>
      <Text color={color}>{"█".repeat(filled)}</Text>
      <Text color="#333333">{"█".repeat(empty)}</Text>
    </Text>
  );
}

const STORIES = [
  { title: "Fix the README typo", score: 22, model: "gpt-6.1-sol", color: ROLE_COLOR.section },
  { title: "Add CSV export", score: 41, model: "gpt-6.1-sol", color: ROLE_COLOR.section },
  { title: "Dark mode on settings", score: 47, model: "claude-opus-5-5", color: ROLE_COLOR.soloist },
  { title: "Encrypt the cache at rest", score: 64, model: "claude-opus-5-5", color: ROLE_COLOR.soloist },
];

function Request(t: number) {
  const text = "Add CSV export and dark mode, and encrypt the cache. Done means: the tests pass.";
  return (
    <Box flexDirection="column">
      <Text>You describe the job once, in your words, with what done means:</Text>
      <Text color={COLOR.brass}>{`> ${typed(text, t * CHARS_PER_TICK)}`}{t % 2 === 0 ? "▌" : " "}</Text>
      <Text color="gray">{t * CHARS_PER_TICK > text.length ? "Concerto takes it from here. No model choice, no prompt juggling." : " "}</Text>
    </Box>
  );
}

function Scoring(t: number) {
  return (
    <Box flexDirection="column">
      <Text>A scorer splits it into user stories. Concerto measures each one in your repository:</Text>
      <Text color="gray">files touched · who imports them · tests that cover them · size · churn · risk</Text>
      {STORIES.map(({ title, score }, i) => (
        <Text key={title}>
          {title.padEnd(W.title)} <Bar value={Math.max(0, (t - i * T.stagger) / T.grow) * (score / PERCENT)} color={COLOR.brass} />{" "}
          {t > i * T.stagger + T.grow ? score : ""}
        </Text>
      ))}
    </Box>
  );
}

function Routing(t: number) {
  return (
    <Box flexDirection="column">
      <Text>Each story goes to the model that fits it. Hard and UI work to Opus, the rest to Sol:</Text>
      {STORIES.map(({ title, score, model, color }, i) => {
        const travel = Math.min(BAR, Math.max(0, t - i * T.travelStagger));
        return (
          <Text key={title}>
            {title.padEnd(W.title)} <Text color="gray">{"·".repeat(travel)}</Text>
            <Text color={color}>{travel >= BAR ? `● ${model}` : "●"}</Text> <Text color="gray">{travel >= BAR ? `score ${score}` : ""}</Text>
          </Text>
        );
      })}
      <Text color="gray">Subscriptions first, your proxy or API keys as fallbacks. A rate limit just moves to the next.</Text>
    </Box>
  );
}

function Review(t: number) {
  const gates = ["before the plan locks", "when a story fails twice", "before calling it done"];
  return (
    <Box flexDirection="column">
      <Text>Nobody grades their own work. A critic tries to break every story.</Text>
      <Text>The conductor reads everything, writes nothing, and wakes three times:</Text>
      {gates.map((g, i) => (
        <Text key={g} color={t > i * T.gate + T.gateDelay ? ROLE_COLOR.conductor : "gray"}>
          {t > i * T.gate + T.gateDelay ? "✓" : "○"} {g}
        </Text>
      ))}
      <Text color="gray">{t > T.notes ? "Its notes go back into every builder's prompt." : " "}</Text>
    </Box>
  );
}

function Engine(t: number) {
  const rows = [
    { label: "Prompt cache reads", value: 0.9, color: COLOR.good },
    { label: "Context not resent", value: 0.6, color: ROLE_COLOR.critic },
    { label: "Noise condensed", value: 0.45, color: ROLE_COLOR.conductor },
    { label: "Claude Code start", value: 0.995, color: COLOR.brass },
  ];
  return (
    <Box flexDirection="column">
      <Text>A token engine sits between Concerto and the models:</Text>
      {rows.map(({ label, value, color }) => (
        <Text key={label}>
          {label.padEnd(W.label)} <Bar value={Math.min(value, t / T.fill)} color={color} />
        </Text>
      ))}
      <Text color="gray">Claude Code starts with about 600 tokens of context instead of about 131,000.</Text>
    </Box>
  );
}

function Keys(t: number) {
  const keys: ReadonlyArray<[string, string]> = [
    ["enter", "score the request, then enter again to build"],
    ["tab", "move between prompt, agents, stories and changes"],
    ["↑ ↓", "pick an agent, a story or a file"],
    ["enter", "open it: the agent's live output, a story's score, a file's diff"],
    ["esc", "close, discard a plan, or stop a build"],
    ["/", "commands: /setup /config /models /budget /prefer /onboarding /help"],
  ];
  return (
    <Box flexDirection="column">
      <Text>Drive it from the keyboard:</Text>
      {keys.slice(0, Math.min(keys.length, Math.floor(t / T.keyEvery) + 1)).map(([k, what], i) => (
        <Text key={i}>
          <Text color={COLOR.brass}>{k.padEnd(W.key)}</Text>
          {what}
        </Text>
      ))}
    </Box>
  );
}

export const SLIDES: readonly Slide[] = [
  { title: "One request", body: Request },
  { title: "Scored, not guessed", body: Scoring },
  { title: "The right model for each story", body: Routing },
  { title: "Reviewed before it counts", body: Review },
  { title: "Fewer tokens", body: Engine },
  { title: "Your controls", body: Keys },
];
