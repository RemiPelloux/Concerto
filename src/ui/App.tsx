import { Box, Text } from "ink";
import { useSyncExternalStore } from "react";
import type { ConcertoConfig } from "../config/types.js";
import type { Catalog } from "../models/catalog.js";
import { roleChain } from "../models/router.js";
import type { Runner } from "../runner/types.js";
import type { Store } from "../state/store.js";
import type { State } from "../state/types.js";
import { AgentList } from "./AgentList.js";
import { AgentTree } from "./AgentTree.js";
import { Banner } from "./Banner.js";
import { ChangesTable } from "./ChangesTable.js";
import { ConductorPanel } from "./ConductorPanel.js";
import { CostBar } from "./CostBar.js";
import { LogView } from "./LogView.js";
import { OverlayView } from "./Overlays.js";
import { PanelView } from "./PanelView.js";
import { PromptBar } from "./PromptBar.js";
import type { ExitReason } from "./slash.js";
import { Stage } from "./Stage.js";
import { StatusLine } from "./StatusLine.js";
import { StoryBoard } from "./StoryBoard.js";
import { ROLE_COLOR, shortModel } from "./theme.js";
import { useConcert } from "./useConcert.js";
import { useNavigation, type Navigation } from "./useNavigation.js";

export type AppDeps = {
  config: ConcertoConfig;
  catalog: Catalog;
  store: Store;
  runner: Runner;
  cwd: string;
  autoPerform: boolean;
  initialRequest: string;
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

function OverlayScreen({ state, nav }: { state: State; nav: Navigation }) {
  if (!nav.overlay) return null;
  return (
    <Box flexDirection="column" paddingX={1}>
      <Header state={state} />
      <OverlayView overlay={nav.overlay} state={state} scroll={nav.scroll} close={() => nav.open(null)} />
      <StatusLine state={state} zone={nav.zone} overlay />
    </Box>
  );
}

export function App(deps: AppDeps) {
  const state = useSyncExternalStore(deps.store.subscribe, deps.store.get);
  const nav = useNavigation(state, deps.cwd, deps.showTour);
  const { panel, submit } = useConcert(deps, { active: nav.zone === "prompt" && !nav.overlay, tour: () => nav.open({ kind: "tour" }) });
  const brain = shortModel(roleChain(deps.catalog, deps.config, "conductor")[0]?.ref ?? "");
  const idle = ["idle", "done", "failed"].includes(state.phase);
  if (nav.overlay) return <OverlayScreen state={state} nav={nav} />;
  return (
    <Box flexDirection="column" paddingX={1}>
      <Header state={state} />
      <CostBar ledger={state.ledger} brain={brain} />
      <Box marginTop={1}>
        <ConductorPanel state={state} />
        <Stage state={state} swarmSize={deps.config.swarm.maxParallel} />
      </Box>
      <Tagline />
      <Work state={state} nav={nav} />
      <LogView log={state.log} />
      <PanelView panel={panel} />
      <PromptBar enabled={idle && nav.zone === "prompt"} onSubmit={submit} onTab={nav.nextZone} />
      <StatusLine state={state} zone={nav.zone} overlay={false} />
    </Box>
  );
}
