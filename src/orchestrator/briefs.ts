import type { LogEntry } from "../state/types.js";
import type { Plan, Story } from "./plan.js";

const LOG_TAIL = 30;

export function storyBrief(story: Story): string {
  return [
    `Story ${story.id}: ${story.title}`,
    `As ${story.asA}, I want ${story.iWant}, so that ${story.soThat}.`,
    "Done means:",
    ...story.acceptance.map((a) => `- ${a}`),
  ].join("\n");
}

export function planBrief(plan: Plan): string {
  const lines = plan.stories.map(
    (s) => `- ${s.id} (${s.points} pts, complexity ${s.complexity}, risk ${s.risk}): ${s.title}` +
      (s.dependsOn.length > 0 ? ` after ${s.dependsOn.join(", ")}` : ""),
  );
  return [`Plan: ${plan.summary}`, ...lines].join("\n");
}

export function logBrief(log: LogEntry[]): string {
  return log
    .slice(-LOG_TAIL)
    .map((e) => `[${e.role}] ${e.label}: ${e.detail} -> ${e.result}`)
    .join("\n");
}

/** First line of the form `KEY: value` in a reply, lowercased. */
export function readTag(reply: string, key: string): string {
  const match = new RegExp(`^\\s*${key}:\\s*(\\w+)`, "im").exec(reply);
  return match?.[1]?.toLowerCase() ?? "";
}

/** The line after the tag, used as the one-line finding in the log. */
export function headline(reply: string, key: string): string {
  const lines = reply.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("```"));
  const at = lines.findIndex((l) => l.toUpperCase().startsWith(`${key}:`));
  return (at >= 0 ? lines[at + 1] : lines[0]) ?? "";
}
