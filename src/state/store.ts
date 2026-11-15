import { EMPTY_LEDGER } from "../cache/ledger.js";
import { ROLES, type Role } from "../config/types.js";
import type { LogEntry, RoleView, State, StoryView } from "./types.js";

const LOG_LIMIT = 200;

function idleRoles(): Record<Role, RoleView> {
  const entries = ROLES.map((r) => [r, { model: "", activity: "idle", note: "" }] as const);
  return Object.fromEntries(entries) as Record<Role, RoleView>;
}

export function initialState(): State {
  return {
    phase: "idle",
    prompt: "",
    plan: null,
    stories: [],
    roles: idleRoles(),
    swarm: [],
    checkpoints: { "plan-lock": "", "repeat-error": "", "before-done": "" },
    log: [],
    ledger: EMPTY_LEDGER,
    error: "",
  };
}

type Listener = () => void;

/** A tiny external store: the orchestrator writes, Ink components subscribe. */
export class Store {
  private state = initialState();
  private readonly listeners = new Set<Listener>();

  get = (): State => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  update(change: (s: State) => Partial<State>): void {
    this.state = { ...this.state, ...change(this.state) };
    this.listeners.forEach((l) => l());
  }

  role(role: Role, patch: Partial<RoleView>): void {
    this.update((s) => ({ roles: { ...s.roles, [role]: { ...s.roles[role], ...patch } } }));
  }

  story(id: string, patch: Partial<StoryView>): void {
    this.update((s) => ({ stories: s.stories.map((v) => (v.id === id ? { ...v, ...patch } : v)) }));
  }

  log(entry: LogEntry): void {
    this.update((s) => ({ log: [...s.log, entry].slice(-LOG_LIMIT) }));
  }
}
