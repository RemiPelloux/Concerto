import { useInput } from "ink";
import { useCallback, useEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import { createConcert, type Concert } from "../orchestrator/concert.js";
import { perform } from "../orchestrator/perform.js";
import { scoreRequest } from "../orchestrator/score.js";
import type { Store } from "../state/store.js";
import type { State } from "../state/types.js";
import type { AppDeps } from "./App.js";

type Run = { concert: Concert | null; abort: AbortController };
type Controls = { state: State; submit: (text: string) => void };
type KeyContext = { store: Store; state: State; run: RefObject<Run | null>; fail: (e: unknown) => void };

function useKeys({ store, state, run, fail }: KeyContext): void {
  useInput((_input, key) => {
    const concert = run.current?.concert;
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

/** Wires keyboard and prompt input to the orchestrator for one interactive session. */
export function useConcert(deps: AppDeps): Controls {
  const state = useSyncExternalStore(deps.store.subscribe, deps.store.get);
  const run = useRef<Run | null>(null);
  const fail = useCallback((e: unknown) => {
    const error = run.current?.abort.signal.aborted ? "interrupted" : e instanceof Error ? e.message : String(e);
    deps.store.update(() => ({ phase: "failed", error }));
  }, [deps.store]);
  const submit = useCallback((text: string) => {
    const current: Run = { concert: null, abort: new AbortController() };
    run.current = current;
    deps.store.update(() => ({ phase: "scoring", prompt: text, error: "" }));
    createConcert({ ...deps, signal: current.abort.signal })
      .then(async (concert) => {
        current.concert = concert;
        await scoreRequest(concert, text);
        if (deps.autoPerform) await perform(concert);
      })
      .catch(fail);
  }, [deps, fail]);
  useKeys({ store: deps.store, state, run, fail });
  useStartOnce(deps.initialRequest, submit);
  return { state, submit };
}
