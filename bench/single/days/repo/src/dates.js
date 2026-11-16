const DAY = 24 * 60 * 60 * 1000;

/** Whole days from a to b (both Date objects). */
export function daysBetween(a, b) {
  return Math.floor((b - a) / DAY) + 1;
}
