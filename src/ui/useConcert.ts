import { useInput } from "ink";
import { useCallback, useEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import { createConcert, type Concert } from "../orchestrator/concert.js";
import { perform } from "../orchestrator/perform.js";
import { scoreRequest } from "../orchestrator/score.js";
import type { Store } from "../state/store.js";
import type { State } from "../state/types.js";
import type { AppDeps } from "./App.js";

type Run = { concert: Concert; abort: AbortController };
type Controls = { state: State; submit: (text: string) => void };
type KeyContext = { store: Store; state: State; run: RefObject<Run | null>; fail: (e: unknown) => void };

function useKeys({ store, state, run, fail }: KeyContext): void {
  useInput((_input, key) => {
    if (key.escape && state.phase === "planned") return store.update(() => ({ phase: "idle", plan: null, stories: [] }));
    if (key.escape) return run.current?.abort.abort();
    if (key.return && state.phase === "planned" && run.current) perform(run.current.concert).catch(fail);
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

/** Wires keyboard and prompt input to the orchestrator for one interactive session. */
export function useConcert(deps: AppDeps): Controls {
  const state = useSyncExternalStore(deps.store.subscribe, deps.store.get);
  const run = useRef<Run | null>(null);
  const fail = useCallback((e: unknown) => {
    const error = run.current?.abort.signal.aborted ? "interrupted" : e instanceof Error ? e.message : String(e);
    deps.store.update(() => ({ phase: "failed", error }));
  }, [deps.store]);
  const submit = useCallback((text: string) => {
    const abort = new AbortController();
    run.current = { concert: createConcert({ ...deps, signal: abort.signal }), abort };
    const concert = run.current.concert;
    scoreRequest(concert, text)
      .then(() => (deps.autoPerform ? perform(concert) : undefined))
      .catch(fail);
  }, [deps, fail]);
  useKeys({ store: deps.store, state, run, fail });
  useStartOnce(deps.initialRequest, submit);
  return { state, submit };
}
