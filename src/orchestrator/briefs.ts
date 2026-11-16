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
