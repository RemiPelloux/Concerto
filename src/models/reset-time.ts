/**
 * When a limit lifts, read from the message that announced it: Claude Code prints
 * "resets 6:40pm (Europe/Paris)" for its 5-hour window and "resets Thu 10am (Europe/Paris)" for
 * the weekly one.
 */
const RESETS = /resets\s+(?:(sun|mon|tue|wed|thu|fri|sat)\w*\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([^)]+)\)/i;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const HALF_DAY = 12;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
const DAYS_PER_WEEK = 7;

type Wall = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

/** The wall clock in `zone` at `ms`. */
function wallClock(zone: string, ms: number): Wall {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", weekday: "short", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(ms);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const num = (type: string) => Number(get(type));
  return { year: num("year"), month: num("month"), day: num("day"), hour: num("hour"), minute: num("minute"), weekday: WEEKDAYS.indexOf(get("weekday").toLowerCase()) };
}

/** How far `zone` is ahead of UTC at `ms`. */
function offset(zone: string, ms: number): number {
  const w = wallClock(zone, ms);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - Math.floor(ms / MS_PER_MINUTE) * MS_PER_MINUTE;
}

/** `hour`:`minute` on the day of `now` in `zone`, as an instant. */
function sameDayAt(zone: string, now: number, time: { hour: number; minute: number }): number {
  const w = wallClock(zone, now);
  const guess = Date.UTC(w.year, w.month - 1, w.day, time.hour, time.minute);
  return guess - offset(zone, guess - offset(zone, guess));
}

function knownZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The instant the message says the limit resets, the next one after `now`; null if it names none. */
export function resetAt(message: string, now = Date.now()): number | null {
  const m = RESETS.exec(message);
  if (!m) return null;
  const [, day, hours = "0", minutes = "0", meridiem = "am", zone = ""] = m;
  if (!knownZone(zone)) return null;
  const hour = (Number(hours) % HALF_DAY) + (meridiem.toLowerCase() === "pm" ? HALF_DAY : 0);
  const time = { hour, minute: Number(minutes) };
  const weekday = day ? WEEKDAYS.indexOf(day.toLowerCase()) : -1;
  let when = sameDayAt(zone, now, time);
  // A day at a time, re-reading the wall clock, so a daylight-saving change keeps the hour.
  for (let i = 0; i <= DAYS_PER_WEEK && (when <= now || (weekday >= 0 && wallClock(zone, when).weekday !== weekday)); i++) {
    when = sameDayAt(zone, when + MS_PER_DAY, time);
  }
  return when;
}
