import type { Notify } from "#src/config/types.js";

const TIMEOUT_MS = 10_000;

export type RunEvent = { on: Notify["on"][number]; title: string; text: string; details: object };

/** `${SLACK_WEBHOOK}` in a URL reads the environment, so the secret stays out of the project config. */
export function expandEnv(url: string): string {
  return url.replace(/\$\{(\w+)\}/g, (_, name: string) => process.env[name] ?? "");
}

/** The body each service expects: Slack's `text`, Discord's `content`, a webhook the whole event. */
export function payload(kind: Notify["kind"], event: RunEvent): object {
  const line = `*${event.title}*\n${event.text}`;
  if (kind === "slack") return { text: line };
  if (kind === "discord") return { content: line.replace(/^\*(.*)\*$/m, "**$1**") };
  return { event: event.on, title: event.title, text: event.text, ...event.details };
}

/**
 * Sends the event to every target configured for it. A target that is down, slow or misconfigured
 * is reported back, never thrown: a notification never fails a run.
 */
export async function notify(targets: readonly Notify[], event: RunEvent): Promise<string[]> {
  const sends = targets.filter((t) => t.on.includes(event.on)).map(async (t) => {
    const url = expandEnv(t.url);
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload(t.kind, event)), signal: AbortSignal.timeout(TIMEOUT_MS) });
      return res.ok ? "" : `${t.kind}: ${res.status}`;
    } catch (error) {
      return `${t.kind}: ${error instanceof Error ? error.message : String(error)}`;
    }
  });
  return (await Promise.all(sends)).filter(Boolean);
}
