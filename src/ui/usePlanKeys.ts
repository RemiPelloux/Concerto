import { useInput } from "ink";
import type { State } from "#src/state/types.js";
import type { Navigation } from "#src/ui/useNavigation.js";

/**
 * In the story list of a waiting plan: d drops the selected story, s splits it, m merges the
 * next one into it. Each key sends the matching slash command, so they behave the same.
 */
export function usePlanKeys(state: State, nav: Navigation, submit: (text: string) => void): void {
  useInput(
    (input) => {
      if (nav.overlay || state.phase !== "planned") return;
      const at = nav.selected.stories;
      const [id, next] = [state.order[at], state.order[at + 1]];
      if (!id) return;
      if (input === "d") submit(`/drop ${id}`);
      if (input === "s") submit(`/split ${id}`);
      if (input === "m" && next) submit(`/merge ${next} ${id}`);
    },
    { isActive: nav.zone === "stories" },
  );
}
