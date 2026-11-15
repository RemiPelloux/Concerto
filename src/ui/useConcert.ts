import { useApp, useInput } from "ink";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createConcert, type Concert } from "#src/orchestrator/concert.js";
import { perform } from "#src/orchestrator/perform.js";
import { scoreRequest } from "#src/orchestrator/score.js";
import type { Store } from "#src/state/store.js";
import type { State } from "#src/state/types.js";
import { resumable } from "#src/engine/history.js";
import { unfinished } from "#src/ui/RunSummary.js";
import type { AppDeps } from "#src/ui/App.js";
import { runSlash, type ExitReason, type Panel, type Session } from "#src/ui/slash.js";

type Run = { concert: Concert | null; abort: AbortController };
type Controls = { panel: Panel | null; submit: (text: string) => void; retry: () => void };
type KeyContext = { store: Store; run: RefObject<Run | null>; fail: (e: unknown) => void; closePanel: () => boolean; active: boolean };
export type NavHooks = { active: boolean; tour: () => void };

/** Reads the store at keypress time, so this hook never subscribes and never re-renders the App. */
function useKeys({ store, run, fail, closePanel, active }: KeyContext): void {
  useInput((_input, key) => {
    if (!active) return;
    const concert = run.current?.concert;
    const state = store.get();
    if (key.escape && closePanel()) return;
    if (key.escape && state.phase === "planned") return store.update(() => ({ phase: "idle", plan: null, stories: {}, order: [] }));
    if (key.escape) return run.current?.abort.abort();
    if (key.return && state.phase === "planned" && concert) perform(concert).catch(fail);
  });
}

function useStartOnce(request: string, submit: (text: string) => void): void {
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !request) return;
    started.current = true;
    submit(request);
  }, [request, submit]);
}

/** A saved session goes back on screen; its concert is ready by the time Enter is pressed. */
type ResumeContext = { deps: AppDeps; session: Session; run: RefObject<Run | null>; fail: (e: unknown) => void };

function useResume({ deps, session, run, fail }: ResumeContext) {
  return useCallback((state: State) => {
    const current: Run = { concert: null, abort: new AbortController() };
    run.current = current;
    deps.store.update(() => state);
    createConcert({ ...deps, ...session, signal: current.abort.signal }).then((concert) => void (current.concert = concert)).catch(fail);
  }, [deps, session, fail, run]);
}

function useRequest(deps: AppDeps, session: Session, run: RefObject<Run | null>) {
  const fail = useCallback((e: unknown) => {
    deps.log.error(e, "run");
    const error = run.current?.abort.signal.aborted ? "interrupted" : e instanceof Error ? e.message : String(e);
    deps.store.update(() => ({ phase: "failed", error }));
  }, [deps.store, run]);
  const request = useCallback((text: string) => {
    const current: Run = { concert: null, abort: new AbortController() };
    run.current = current;
    deps.store.update(() => ({ phase: "scoring", prompt: text, error: "" }));
    createConcert({ ...deps, ...session, signal: current.abort.signal })
      .then(async (concert) => {
        current.concert = concert;
        await scoreRequest(concert, text);
        if (deps.autoPerform) await perform(concert);
      })
      .catch(fail);
  }, [deps, session, fail, run]);
  return { fail, request, resume: useResume({ deps, session, run, fail }) };
}

/** After a run, builds again the stories that did not pass; the ones that passed are kept. */
function useRetry(store: Store, run: RefObject<Run | null>, fail: (e: unknown) => void): () => void {
  return useCallback(() => {
    const state = store.get();
    const concert = run.current?.concert;
    if (!concert || !["done", "failed"].includes(state.phase) || unfinished(state).length === 0) return;
    store.update(() => resumable(state));
    perform(concert).catch(fail);
  }, [store, run, fail]);
}

/** Wires keyboard, prompt and slash commands to the orchestrator for one interactive session. */
export function useConcert(deps: AppDeps, nav: NavHooks): Controls {
  const [session, setSession] = useState<Session>({ config: deps.config, catalog: deps.catalog });
  const [panel, setPanel] = useState<Panel | null>(null);
  const run = useRef<Run | null>(null);
  const { exit } = useApp();
  const { fail, request, resume } = useRequest(deps, session, run);
  const leave = useCallback((reason: ExitReason) => {
    deps.onExit(reason);
    exit();
  }, [deps, exit]);
  const submit = useCallback((text: string) => {
    if (!text.startsWith("/")) return request(text);
    deps.log.write("command", text);
    void runSlash(text, { cwd: deps.cwd, store: deps.store, session, setSession, show: setPanel, exit: leave, tour: nav.tour, log: deps.log, resume });
  }, [deps.cwd, deps.store, deps.log, session, request, resume, leave, nav.tour]);
  const closePanel = () => (panel ? (setPanel(null), true) : false);
  useKeys({ store: deps.store, run, fail, closePanel, active: nav.active });
  useStartOnce(deps.initialRequest, submit);
  return { panel, submit, retry: useRetry(deps.store, run, fail) };
}
