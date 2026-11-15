import { Box, Text } from "ink";
import type { Story } from "../orchestrator/plan.js";
import type { State, StoryStatus, StoryView } from "../state/types.js";
import { COLOR, ROLE_COLOR, shortModel } from "./theme.js";

const STATUS_COLOR: Record<StoryStatus, string> = {
  queued: "gray",
  building: ROLE_COLOR.soloist,
  checking: ROLE_COLOR.critic,
  passed: COLOR.good,
  failed: COLOR.bad,
  skipped: "gray",
};
const W = { title: 28, pts: 3, cx: 2, risk: 4, reach: 15, score: 5, est: 7, model: 20, review: 18 };
const CENTS = 2;

function dollars(n: number): string {
  return `$${n.toFixed(CENTS)}`;
}

/** "3·12·5": files the story touches, files importing them, tests covering them. "-" when unknown. */
function reachCell(view: StoryView): string {
  const { files, dependents, tests } = view.impact;
  return files.length === 0 ? "-" : `${files.length}·${dependents}·${tests.length}`;
}

function Header() {
  const cells = ["story".padEnd(W.title), "pts".padStart(W.pts), "cx".padStart(W.cx), "risk".padStart(W.risk), "files·imp·tests".padStart(W.reach), "score".padStart(W.score), "est".padStart(W.est)];
  return <Text color="gray">{`${cells.join(" ")}  ${"model".padEnd(W.model)} ${"review".padEnd(W.review)} status`}</Text>;
}

function StoryRow({ story, view }: { story: Story; view: StoryView }) {
  const cells = [
    story.title.slice(0, W.title).padEnd(W.title),
    String(story.points).padStart(W.pts),
    String(story.complexity).padStart(W.cx),
    String(story.risk).padStart(W.risk),
    reachCell(view).padStart(W.reach),
    String(view.score).padStart(W.score),
    dollars(view.estimate).padStart(W.est),
  ];
  return (
    <Text>
      {cells.join(" ")}  <Text color={ROLE_COLOR[view.role]}>{shortModel(view.model).padEnd(W.model)}</Text>{" "}
      <Text color={ROLE_COLOR.critic}>{shortModel(view.critics[0] ?? "").padEnd(W.review)}</Text>{" "}
      <Text color={STATUS_COLOR[view.status]}>{view.status}</Text>
    </Text>
  );
}

export function StoryBoard({ state }: { state: State }) {
  if (!state.plan) return null;
  const total = Object.values(state.stories).reduce((sum, v) => sum + v.estimate, 0);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>
        {state.plan.summary}
        <Text color="gray"> · about {dollars(total)} API-equivalent before retries</Text>
      </Text>
      <Header />
      {state.plan.stories.map((story) => {
        const view = state.stories[story.id];
        return view ? <StoryRow key={story.id} story={story} view={view} /> : null;
      })}
    </Box>
  );
}
