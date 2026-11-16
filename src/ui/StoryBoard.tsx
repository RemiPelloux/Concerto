import { Box, Text } from "ink";
import type { Story } from "#src/orchestrator/plan.js";
import type { State, StoryStatus, StoryView } from "#src/state/types.js";
import { COLOR, ROLE_COLOR, shortModel } from "#src/ui/theme.js";

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
  const { files, direct, indirect, tests } = view.impact;
  return files.length === 0 ? "-" : `${files.length}·${direct + indirect}·${tests.length}`;
}

function Header() {
  const cells = ["story".padEnd(W.title), "pts".padStart(W.pts), "cx".padStart(W.cx), "risk".padStart(W.risk), "files·imp·tests".padStart(W.reach), "score".padStart(W.score), "est".padStart(W.est)];
  return <Text color="gray">{`${cells.join(" ")}  ${"model".padEnd(W.model)} ${"review".padEnd(W.review)} status`}</Text>;
}

function StoryRow({ story, view, active }: { story: Story; view: StoryView; active: boolean }) {
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
    <Box flexDirection="column">
      <Text>
        <Text inverse={active}>{cells.join(" ")}</Text>  <Text color={ROLE_COLOR[view.role]}>{shortModel(view.model).padEnd(W.model)}</Text>{" "}
        <Text color={ROLE_COLOR.critic}>{shortModel(view.critics[0] ?? "").padEnd(W.review)}</Text>{" "}
        <Text color={STATUS_COLOR[view.status]}>{view.status}</Text>
      </Text>
      <Text color="gray" wrap="truncate-end">{`  why ${view.score}: ${view.reasons.join(" · ")} · effort ${view.effort}`}</Text>
    </Box>
  );
}

/** The plan's cost on each way of reaching the models, cheapest first, with the command that picks it. */
function Paths({ state }: { state: State }) {
  if (state.phase !== "planned" || state.paths.length < 2) return null;
  const sorted = [...state.paths].sort((a, b) => a.cost - b.cost);
  return (
    <Text color="gray" wrap="truncate-end">
      {sorted.map((p) => `${p.label} ${dollars(p.cost)}${p.path === "subscriptions" ? " (prepaid)" : ""}${p.missing ? `, ${p.missing} not reachable` : ""} (/prefer ${p.prefer})`).join(" · ")}
    </Text>
  );
}

export function StoryBoard({ state, focused = false, selected = 0 }: { state: State; focused?: boolean; selected?: number }) {
  if (!state.plan) return null;
  const total = Object.values(state.stories).reduce((sum, v) => sum + v.estimate, 0);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>
        {state.plan.summary}
        <Text color="gray"> · about {dollars(total)} API-equivalent before retries</Text>
      </Text>
      <Paths state={state} />
      <Header />
      {state.plan.stories.map((story) => {
        const view = state.stories[story.id];
        return view ? <StoryRow key={story.id} story={story} view={view} active={focused && state.order[selected] === story.id} /> : null;
      })}
    </Box>
  );
}
