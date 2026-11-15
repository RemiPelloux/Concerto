import { Box, Text } from "ink";
import { ROLES } from "../config/types.js";
import type { State } from "../state/types.js";
import { ROLE_COLOR, ROLE_DUTY, shortModel } from "./theme.js";

export function AgentTree({ roles }: { roles: State["roles"] }) {
  return (
    <Box flexDirection="column" marginLeft={4}>
      <Text bold>agent tree</Text>
      {ROLES.map((role) => (
        <Text key={role}>
          <Text color={ROLE_COLOR[role]}>● </Text>
          <Text>{shortModel(roles[role].model)}</Text>
          <Text color="gray"> · {role} · {ROLE_DUTY[role]}</Text>
        </Text>
      ))}
    </Box>
  );
}
