import { z } from "zod";

/**
 * The `--json` event format, version 1, stable under semantic versioning from Concerto 1.0: a
 * minor release may add event types and fields, only a major one removes or changes them. Read
 * events by `type` and ignore what you do not know.
 */
export const EVENT_FORMAT = 1;

const log = z.object({ type: z.literal("log"), label: z.string(), role: z.string(), detail: z.string(), result: z.string() });

export const EventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session"), format: z.literal(EVENT_FORMAT), session: z.string(), log: z.string() }),
  log,
  z.object({ type: z.literal("story"), id: z.string(), status: z.string(), model: z.string() }),
  z.object({
    type: z.literal("done"), phase: z.string(), error: z.string().optional(), costUsd: z.number(), report: z.string(),
    stories: z.array(z.object({ id: z.string(), status: z.string().optional(), merged: z.array(z.string()) })),
  }),
  z.object({ type: z.literal("pr"), url: z.string().nullable(), reason: z.string().optional() }),
]);
export type Event = z.infer<typeof EventSchema>;

/** Every event type, in the order a run sends them. */
export const EVENT_TYPES = ["session", "log", "story", "done", "pr"] as const;
