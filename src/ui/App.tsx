import { Box, Text } from "ink";
import type { ConcertoConfig } from "../config/types.js";
import { modelForRole } from "../models/router.js";
import type { ModelInfo } from "../models/types.js";
import type { Runner } from "../runner/types.js";
import type { Store } from "../state/store.js";
import { AgentTree } from "./AgentTree.js";
import { Banner } from "./Banner.js";
import { ConductorPanel } from "./ConductorPanel.js";
import { CostBar } from "./CostBar.js";
import { LogView } from "./LogView.js";
import { PromptBar } from "./PromptBar.js";
import { Stage } from "./Stage.js";
import { StatusLine } from "./StatusLine.js";
import { StoryBoard } from "./StoryBoard.js";
import { ROLE_COLOR, shortModel } from "./theme.js";
import { useConcert } from "./useConcert.js";

export type AppDeps = {
  config: ConcertoConfig;
  catalog: ModelInfo[];
  store: Store;
  runner: Runner;
  cwd: string;
  autoPerform: boolean;
  initialRequest: string;
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

export function App(deps: AppDeps) {
  const { state, submit } = useConcert(deps);
  const brain = shortModel(modelForRole(deps.catalog, deps.config, "conductor").ref);
  const idle = ["idle", "done", "failed"].includes(state.phase);
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Banner />
        <AgentTree roles={state.roles} />
      </Box>
      <CostBar ledger={state.ledger} brain={brain} />
      <Box marginTop={1}>
        <ConductorPanel state={state} />
        <Stage state={state} swarmSize={deps.config.swarm.maxParallel} />
      </Box>
      <Tagline />
      <StoryBoard state={state} />
      <LogView log={state.log} />
      <PromptBar enabled={idle} onSubmit={submit} />
      <StatusLine state={state} />
    </Box>
  );
}
