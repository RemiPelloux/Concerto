/**
 * Tiers for model families Concerto knows, used when onboarding adds a model the bundled config
 * does not list. 5 = frontier reasoning, 1 = bulk work. Unknown or legacy models are skipped.
 */
const T = { frontier: 5, strong: 4, solid: 3, light: 2, bulk: 1 };

const FAMILIES: ReadonlyArray<[RegExp, number]> = [
  [/^claude-fable-5/, T.frontier],
  [/^gpt-6(?:\.\d+)?-astra/, T.frontier],
  [/^claude-opus-5/, T.strong],
  [/^gpt-6(?:\.\d+)?-(?:sol|terra)/, T.strong],
  [/^gpt-5\.[5-9](?:-pro)?$/, T.strong],
  [/^claude-sonnet-5/, T.solid],
  [/^gpt-5\.6-(?:sol|terra)/, T.solid],
  [/^deepseek-v4-pro/, T.solid],
  [/^grok-4/, T.solid],
  [/^z-ai\/glm-5/, T.solid],
  [/^claude-haiku-5/, T.light],
  [/^gpt-6(?:\.\d+)?-luna/, T.light],
  [/^gpt-5\.6-luna/, T.light],
  [/^deepseek-v4-flash(?!-vision)/, T.bulk],
];

export function inferTier(modelId: string): number | null {
  const id = modelId.replace(/\[.*\]$/, "");
  return FAMILIES.find(([pattern]) => pattern.test(id))?.[1] ?? null;
}
