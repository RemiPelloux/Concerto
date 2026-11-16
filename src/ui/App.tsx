import { Box, Text, useStdout } from "ink";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { ConcertoConfig } from "#src/config/types.js";
import type { Catalog } from "#src/models/catalog.js";
import { roleChain } from "#src/models/router.js";
import type { Runner } from "#src/runner/types.js";
import type { SessionLog } from "#src/engine/session-log.js";
import type { Store } from "#src/state/store.js";
import type { State } from "#src/state/types.js";
import { AgentList } from "#src/ui/AgentList.js";
import { AgentTree } from "#src/ui/AgentTree.js";
import { Banner } from "#src/ui/Banner.js";
import { ChangesTable } from "#src/ui/ChangesTable.js";
import { ConductorPanel } from "#src/ui/ConductorPanel.js";
import { CostBar } from "#src/ui/CostBar.js";
import { LogView } from "#src/ui/LogView.js";
import { OverlayView } from "#src/ui/Overlays.js";
import { PanelView } from "#src/ui/PanelView.js";
import { PromptBar, promptHint } from "#src/ui/PromptBar.js";
import { RunSummary } from "#src/ui/RunSummary.js";
import type { ExitReason } from "#src/ui/slash.js";
import { Stage } from "#src/ui/Stage.js";
import { StatusLine } from "#src/ui/StatusLine.js";
import { StoryBoard } from "#src/ui/StoryBoard.js";
import { ROLE_COLOR, shortModel } from "#src/ui/theme.js";
import { useConcert } from "#src/ui/useConcert.js";
import { useNavigation, type Navigation } from "#src/ui/useNavigation.js";
import { usePlanKeys } from "#src/ui/usePlanKeys.js";
import type { CallRecord } from "#src/engine/session-log.js";

/** Below this many rows the decorative diagram is left out, so the useful parts fit. */
const ROOMY_ROWS = 72;
/** Ink writes at most 30 frames a second; rendering more often than that is work nobody sees. */
const FRAMES_PER_SECOND = 30;
const MS_PER_SECOND = 1000;
export const FRAME_MS = Math.ceil(MS_PER_SECOND / FRAMES_PER_SECOND);

export type AppDeps = {
  config: ConcertoConfig;
  catalog: Catalog;
  store: Store;
  runner: Runner;
  cwd: string;
  autoPerform: boolean;
  initialRequest: string;
  /** This launch's session: its id is shown, its log keeps every event and error. */
  log: SessionLog;
  /** Opens with the animated tour: the first launch does. */
  showTour: boolean;
  /** Why the TUI closed: "setup" asks the launcher to rerun onboarding and come back. */
  onExit: (reason: ExitReason) => void;
};

function Tagline() {
  return (
    <Box justifyContent="center" marginY={1}>
      <Text bold>
        <Text color={ROLE_COLOR.conductor}>Conductor reads. </Text>
        <Text color={ROLE_COLOR.soloist}>Soloist builds. </Text>
        <Text color={ROLE_COLOR.critic}>Critic checks. </Text>
        <Text color={ROLE_COLOR.section}>Section swarms.</Text>
      </Text>
    </Box>
  );
}

function Work({ state, nav }: { state: State; nav: Navigation }) {
  return (
    <Box flexDirection="column">
      <StoryBoard state={state} focused={nav.zone === "stories"} selected={nav.selected.stories} />
      <Box>
        <AgentList state={state} focused={nav.zone === "agents"} selected={nav.selected.agents} />
        <ChangesTable state={state} focused={nav.zone === "changes"} selected={nav.selected.changes} />
      </Box>
    </Box>
  );
}

function Header({ state }: { state: State }) {
  return (
    <Box>
      <Banner />
      <AgentTree roles={state.roles} />
    </Box>
  );
}

function OverlayScreen({ state, nav, session }: { state: State; nav: Navigation; session: string }) {
  if (!nav.overlay) return null;
  return (
    <Box flexDirection="column" paddingX={1}>
      <Header state={state} />
      <OverlayView overlay={nav.overlay} state={state} scroll={nav.scroll} close={() => nav.open(null)} />
      <StatusLine state={state} zone={nav.zone} overlay session={session} />
    </Box>
  );
}

/** The conductor and stage diagram: shown when the terminal has room for it. */
function Diagram({ state, swarmSize }: { state: State; swarmSize: number }) {
  return (
    <Box flexDirection="column">
      <Box marginTop={1}>
        <ConductorPanel state={state} />
        <Stage state={state} swarmSize={swarmSize} />
      </Box>
      <Tagline />
    </Box>
  );
}

/** The store's state, re-read at most once a frame however fast the orchestrator writes. */
function useFrameState(store: Store): State {
  const subscribe = useCallback((notify: () => void) => {
    let timer: NodeJS.Timeout | null = null;
    const stop = store.subscribe(() => {
      timer ??= setTimeout(() => {
        timer = null;
        notify();
      }, FRAME_MS);
    });
    return () => {
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [store]);
  return useSyncExternalStore(subscribe, store.get);
}

export function App(deps: AppDeps) {
  const state = useFrameState(deps.store);
  const roomy = (useStdout().stdout.rows ?? ROOMY_ROWS) >= ROOMY_ROWS;
  const nav = useNavigation(state, deps.cwd, deps.showTour);
  const hooks = { active: nav.zone === "prompt" && !nav.overlay, tour: () => nav.open({ kind: "tour" }), replay: (calls: CallRecord[]) => nav.open({ kind: "replay", calls, index: 0 }) };
  const { panel, submit, enter } = useConcert(deps, hooks);
  usePlanKeys(state, nav, submit);
  const brain = useMemo(() => shortModel(roleChain(deps.catalog, deps.config, "conductor")[0]?.ref ?? ""), [deps.catalog, deps.config]);
  if (nav.overlay) return <OverlayScreen state={state} nav={nav} session={deps.log.id} />;
  return (
    <Box flexDirection="column" paddingX={1}>
      <Header state={state} />
      <CostBar ledger={state.ledger} brain={brain} />
      {roomy ? <Diagram state={state} swarmSize={deps.config.swarm.maxParallel} /> : null}
      <Work state={state} nav={nav} />
      <LogView log={state.log} />
      <PanelView panel={panel} />
      <RunSummary state={state} />
      <PromptBar enabled={nav.zone === "prompt"} hint={promptHint(state)} onSubmit={submit} onTab={nav.nextZone} onEmpty={enter} />
      <StatusLine state={state} zone={nav.zone} overlay={false} session={deps.log.id} />
    </Box>
  );
}
