import type { Effort, Role } from "../config/types.js";
import type { Ledger } from "../cache/ledger.js";
import type { Plan } from "../orchestrator/plan.js";

export type Phase = "idle" | "scoring" | "planned" | "running" | "done" | "failed";
export type Activity = "idle" | "working" | "waiting" | "done";
export type StoryStatus = "queued" | "building" | "checking" | "passed" | "failed";

export type RoleView = { model: string; activity: Activity; note: string };

export type StoryView = {
  id: string;
  score: number;
  role: Role;
  model: string;
  effort: Effort;
  /** Name of the routing rule that picked the model. */
  rule: string;
  /** Model that reviews this story. */
  critic: string;
  status: StoryStatus;
};

export type LogEntry = { role: Role; label: string; detail: string; result: string };

export const CHECKPOINTS = ["plan-lock", "repeat-error", "before-done"] as const;
export type Checkpoint = (typeof CHECKPOINTS)[number];

export type State = {
  phase: Phase;
  prompt: string;
  plan: Plan | null;
  stories: StoryView[];
  roles: Record<Role, RoleView>;
  swarm: string[];
  checkpoints: Record<Checkpoint, string>;
  log: LogEntry[];
  ledger: Ledger;
  error: string;
};
