import { condense } from "#src/engine/condense.js";
import type { Segment } from "#src/engine/segments.js";
import type { LogEntry, State } from "#src/state/types.js";
import type { Plan, Story } from "#src/orchestrator/plan.js";

const LOG_TAIL = 30;

export function storyBrief(story: Story): string {
  return [
    `## Story ${story.id}: ${story.title}`,
    `As ${story.asA}, I want ${story.iWant}, so that ${story.soThat}.`,
    "Done means:",
    ...story.acceptance.map((a) => `- ${a}`),
  ].join("\n");
}

export function planBrief(plan: Plan): string {
  const lines = plan.stories.map((s) => {
    const after = s.dependsOn.length > 0 ? ` after ${s.dependsOn.join(", ")}` : "";
    return `- ${s.id} (${s.points} pts, complexity ${s.complexity}, risk ${s.risk}): ${s.title}${after}`;
  });
  return [`## Plan: ${plan.summary}`, ...lines].join("\n");
}

export function logBrief(log: LogEntry[]): string {
  const lines = log.slice(-LOG_TAIL).map((e) => `[${e.role}] ${e.label}: ${e.detail} -> ${e.result}`);
  return lines.length > 0 ? `## Session log\n${condense(lines.join("\n"))}` : "";
}

export function notesBrief(notes: string[]): string {
  return notes.length > 0 ? `## Conductor notes for this run\n${notes.join("\n\n")}` : "";
}

/**
 * The plan as one story sees it: the stories it waits for and the ones waiting for it. The rest
 * build in their own worktrees, so a count is all this story needs to know about them.
 */
export function planExcerpt(plan: Plan, storyId: string): string {
  const story = plan.stories.find((s) => s.id === storyId);
  if (!story) return planBrief(plan);
  const near = plan.stories.filter((s) => story.dependsOn.includes(s.id) || s.dependsOn.includes(storyId));
  const lines = near.map((s) => `- ${s.id}: ${s.title} (${story.dependsOn.includes(s.id) ? "lands before this one" : "builds on this one"})`);
  const others = plan.stories.length - 1 - near.length;
  const rest = others > 0 ? [`${others} other ${others === 1 ? "story builds" : "stories build"} separately. Do only this story.`] : [];
  return [`## Plan: ${plan.summary}`, ...lines, ...rest].join("\n");
}

/**
 * A builder's or critic's shared segments: the repository snapshot for builders (a critic reads
 * the diff, not the map), the story's slice of the plan, and the conductor notes.
 */
export function storySegments(state: State, opts: { repoMap: string; storyId: string; snapshot: boolean }): Segment[] {
  return [
    { name: "repository snapshot", text: opts.snapshot ? opts.repoMap : "" },
    { name: "plan", text: state.plan ? planExcerpt(state.plan, opts.storyId) : "" },
    { name: "conductor notes", text: notesBrief(state.notes) },
  ];
}

/**
 * Segments shared by every call in a run, most stable first: the repository snapshot, then
 * the plan and the conductor notes. Builders and critics append their story after these.
 */
export function runSegments(state: State, repoMap: string): Segment[] {
  return [
    { name: "repository snapshot", text: repoMap },
    { name: "plan", text: state.plan ? planBrief(state.plan) : "" },
    { name: "conductor notes", text: notesBrief(state.notes) },
  ];
}

/** First `KEY: value` line in a reply, lowercased. */
export function readTag(reply: string, key: string): string {
  const match = new RegExp(`^\\s*${key}:\\s*([\\w-]+)`, "im").exec(reply);
  return match?.[1]?.toLowerCase() ?? "";
}

function meaningfulLines(reply: string): string[] {
  return reply.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("```"));
}

/** The line after the tag: the one-line finding for the log. */
export function headline(reply: string, key: string): string {
  const lines = meaningfulLines(reply);
  const at = lines.findIndex((l) => l.toUpperCase().startsWith(`${key}:`));
  return (at >= 0 ? lines[at + 1] : lines[0]) ?? "";
}

/** Everything after the tag line, condensed: what the next model needs to act on. */
export function details(reply: string, key: string): string {
  const lines = meaningfulLines(reply);
  const at = lines.findIndex((l) => l.toUpperCase().startsWith(`${key}:`));
  return condense(lines.slice(at + 1).join("\n"));
}
