import { Box, Text } from "ink";
import type { State, StoryStatus } from "../state/types.js";
import { COLOR, ROLE_COLOR, shortModel } from "./theme.js";

const STATUS_COLOR: Record<StoryStatus, string> = {
  queued: "gray",
  building: ROLE_COLOR.soloist,
  checking: ROLE_COLOR.critic,
  passed: COLOR.good,
  failed: COLOR.bad,
};
const W = { title: 34, pts: 3, cx: 2, risk: 4, score: 5, model: 20, review: 18 };

function Header() {
  return (
    <Text color="gray">
      {"story".padEnd(W.title)} {"pts".padStart(W.pts)} {"cx".padStart(W.cx)} {"risk".padStart(W.risk)} {"score".padStart(W.score)}  {"model".padEnd(W.model)} {"review".padEnd(W.review)} status
    </Text>
  );
}

export function StoryBoard({ state }: { state: State }) {
  if (!state.plan) return null;
  const byId = new Map(state.plan.stories.map((s) => [s.id, s]));
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>{state.plan.summary}</Text>
      <Header />
      {state.stories.map((v) => {
        const s = byId.get(v.id);
        if (!s) return null;
        return (
          <Text key={v.id}>
            {s.title.slice(0, W.title).padEnd(W.title)} {String(s.points).padStart(W.pts)} {String(s.complexity).padStart(W.cx)} {String(s.risk).padStart(W.risk)} {String(v.score).padStart(W.score)}  <Text color={ROLE_COLOR[v.role]}>{shortModel(v.model).padEnd(W.model)}</Text> <Text color={ROLE_COLOR.critic}>{shortModel(v.critic).padEnd(W.review)}</Text> <Text color={STATUS_COLOR[v.status]}>{v.status}</Text>
          </Text>
        );
      })}
    </Box>
  );
}
