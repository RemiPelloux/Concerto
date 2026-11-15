import { useEffect, useState } from "react";

const FRAME_MS = 70;

/** Frames since `key` last changed: restart the animation by changing the key. */
export function useTick(key: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setTick(0);
    const timer = setInterval(() => setTick((t) => t + 1), FRAME_MS);
    return () => clearInterval(timer);
  }, [key]);
  return tick;
}

/** The first `n` characters of `text`: a typewriter. */
export function typed(text: string, n: number): string {
  return text.slice(0, Math.max(0, n));
}
