import { createHash } from "node:crypto";

const SHORT = 16;

/** Short content hash; parts are separated so ["ab","c"] and ["a","bc"] differ. */
export function hashParts(parts: readonly string[]): string {
  const h = createHash("sha256");
  parts.forEach((p) => h.update(p).update("\u0000"));
  return h.digest("hex").slice(0, SHORT);
}
