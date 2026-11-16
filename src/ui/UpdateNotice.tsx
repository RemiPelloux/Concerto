import { Text } from "ink";
import { useEffect, useState } from "react";
import { packageVersion } from "#src/config/root.js";
import { checkForUpdate, type Update } from "#src/engine/update-check.js";
import { COLOR } from "#src/ui/theme.js";

/** One line under the logo when a newer release is out; nothing otherwise, and nothing offline. */
export function UpdateNotice() {
  const [update, setUpdate] = useState<Update | null>(null);
  useEffect(() => {
    let live = true;
    void checkForUpdate(packageVersion()).then((u) => live && setUpdate(u));
    return () => {
      live = false;
    };
  }, []);
  if (!update) return null;
  return <Text color={COLOR.brass}>{`Concerto ${update.latest} is out${update.note ? `: ${update.note}` : ""} · concerto --update`}</Text>;
}
