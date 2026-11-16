import type { Effort, Role } from "#src/config/types.js";
import type { Impact } from "#src/engine/impact.js";
import type { Ledger } from "#src/engine/ledger.js";
import type { Factor } from "#src/orchestrator/scoring.js";
import type { Plan } from "#src/orchestrator/plan.js";

export type Phase = "idle" | "scoring" | "planned" | "running" | "done" | "failed";
export type Activity = "idle" | "working" | "waiting" | "done";
export type StoryStatus = "queued" | "building" | "checking" | "passed" | "failed" | "skipped";

export type RoleView = { model: string; activity: Activity; note: string };

export type StoryView = {
  id: string;
  score: number;
  /** The factors that moved the score most, in words. */
  reasons: string[];
  factors: Factor[];
  role: Role;
  effort: Effort;
  /** Name of the routing rule that picked the chain. */
  rule: string;
  /** Builder models in order; `model` is the one that ran last. */
  chain: string[];
  model: string;
  /** Reviewer models in order. */
  critics: string[];
  /** Rough API-equivalent dollars for one build and one review. */
  estimate: number;
  /** Files, importers and covering tests, measured after scoring. */
  impact: Impact;
  status: StoryStatus;
  /** The critic's last finding, in one line: why a story failed, shown when the run ends. */
  finding?: string;
  /** API-equivalent dollars this story's builds and reviews cost so far. */
  spent?: number;
  /** Builds this story took, rebuilds included. */
  attempts?: number;
  /** Files this story's merge wrote into the main folder (isolated runs). */
  merged?: string[];
  /** Routes whose answer changed when Concerto ran the server before and after the story. */
  behaviour?: string[];
  /** The flipped condition Concerto tried on the last attempt, and whether a test caught it. */
  mutation?: { file: string; line: number; from: string; to: string; caught: boolean };
  /** The checks Concerto ran on the last attempt: command, result, time, and whether a rerun passed. */
  checks?: { name: string; command: string; ok: boolean; ms: number; flaky?: boolean }[];
};

export type LogEntry = { role: Role; label: string; detail: string; result: string };

/** One model call you can look into: what it is doing right now, line by line. */
export type AgentView = {
  id: string;
  role: Role;
  model: string;
  label: string;
  status: "working" | "done" | "failed";
  lines: string[];
  startedAt: number;
  /** When the agent last printed something: a long gap means it waits on a command, not a hang. */
  lastAt: number;
  endedAt: number | null;
};

/** One file the run changed, from git. Untracked files count all their lines as added. */
export type FileChange = { file: string; added: number; removed: number; status: "modified" | "added" | "deleted" };

export const CHECKPOINTS = ["plan-lock", "repeat-error", "critics-disagree", "before-done"] as const;
export type Checkpoint = (typeof CHECKPOINTS)[number];

export type State = {
  phase: Phase;
  prompt: string;
  plan: Plan | null;
  /** Stories by id for O(1) updates; `order` keeps the plan order for display. */
  stories: Record<string, StoryView>;
  order: string[];
  roles: Record<Role, RoleView>;
  swarm: string[];
  checkpoints: Record<Checkpoint, string>;
  /** Conductor guidance every builder and critic sees for the rest of the run. */
  notes: string[];
  log: LogEntry[];
  /** Every agent this session started, newest last; `agentOrder` keeps that order. */
  agents: Record<string, AgentView>;
  agentOrder: string[];
  changes: FileChange[];
  ledger: Ledger;
  error: string;
  /** What the plan would cost on each way of reaching the models, for picking one before building. */
  paths: PathCost[];
};

/** The plan's cost if every story ran one way; `prefer` is the /prefer value that picks it. */
export type PathCost = { path: "subscriptions" | "profiles" | "api"; label: string; cost: number; missing: number; prefer: string };
