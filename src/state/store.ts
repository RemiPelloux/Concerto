import { EMPTY_LEDGER } from "#src/engine/ledger.js";
import { ROLES, type Role } from "#src/config/types.js";
import type { AgentView, LogEntry, RoleView, State, StoryView } from "#src/state/types.js";

const LOG_LIMIT = 200;
const AGENT_LINES = 400;
const AGENTS_KEPT = 60;
const SWARM_TRAIL = 6;

function idleRoles(): Record<Role, RoleView> {
  return Object.fromEntries(ROLES.map((r) => [r, { model: "", activity: "idle", note: "" }])) as Record<Role, RoleView>;
}

export function initialState(): State {
  return {
    phase: "idle",
    prompt: "",
    plan: null,
    stories: {},
    order: [],
    roles: idleRoles(),
    swarm: [],
    checkpoints: { "plan-lock": "", "repeat-error": "", "before-done": "" },
    notes: [],
    log: [],
    agents: {},
    agentOrder: [],
    changes: [],
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
    this.update((s) => {
      const current = s.stories[id];
      return current ? { stories: { ...s.stories, [id]: { ...current, ...patch } } } : {};
    });
  }

  view(id: string): StoryView {
    const v = this.state.stories[id];
    if (!v) throw new Error(`Unknown story "${id}".`);
    return v;
  }

  /** Starts or restarts an agent; a retry keeps its earlier lines under a separator. */
  agentStart(view: Omit<AgentView, "lines" | "status" | "startedAt" | "endedAt">): void {
    this.update((s) => {
      const before = s.agents[view.id];
      const lines = before ? [...before.lines, `── ${view.model} ──`] : [];
      const agent: AgentView = { ...view, lines, status: "working", startedAt: Date.now(), endedAt: null };
      const order = [...s.agentOrder.filter((id) => id !== view.id), view.id].slice(-AGENTS_KEPT);
      const kept = Object.fromEntries(order.map((id) => [id, id === view.id ? agent : s.agents[id]]).filter(([, a]) => a));
      return { agents: kept, agentOrder: order };
    });
  }

  agentLines(id: string, lines: string[]): void {
    this.update((s) => {
      const agent = s.agents[id];
      return agent ? { agents: { ...s.agents, [id]: { ...agent, lines: [...agent.lines, ...lines].slice(-AGENT_LINES) } } } : {};
    });
  }

  agentEnd(id: string, status: "done" | "failed"): void {
    this.update((s) => {
      const agent = s.agents[id];
      return agent ? { agents: { ...s.agents, [id]: { ...agent, status, endedAt: Date.now() } } } : {};
    });
  }

  log(entry: LogEntry): void {
    this.update((s) => ({ log: [...s.log, entry].slice(-LOG_LIMIT) }));
  }

  tool(name: string): void {
    this.update((s) => ({ swarm: [...s.swarm, name].slice(-SWARM_TRAIL) }));
  }
}
