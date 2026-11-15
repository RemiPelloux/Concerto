/**
 * How many of `width` cells a bar fills for `value` out of `max`: never below 0, never above
 * `width`, whatever the inputs (a value above max, a zero or negative max, NaN). Every bar in
 * the TUI goes through this, so a bad number can only draw a wrong bar, never crash the screen.
 */
export function meter(value: number, max: number, width: number): { filled: number; empty: number } {
  const ratio = max > 0 && Number.isFinite(value) ? value / max : 0;
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return { filled, empty: width - filled };
}
