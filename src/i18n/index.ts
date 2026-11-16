import { en, fr, type Messages } from "#src/i18n/messages.js";

const CATALOGS = { en, fr };
export type Language = keyof typeof CATALOGS;
let current: Messages = en;

/** `auto` reads LC_ALL, LC_MESSAGES then LANG (`fr_FR.UTF-8` is French); anything else is English. */
export function resolveLanguage(setting: "auto" | Language, env: NodeJS.ProcessEnv = process.env): Language {
  if (setting !== "auto") return setting;
  const locale = env.LC_ALL || env.LC_MESSAGES || env.LANG || "";
  return locale.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export function setLanguage(setting: "auto" | Language): Language {
  const language = resolveLanguage(setting);
  current = CATALOGS[language];
  return language;
}

/** The TUI's lines in the language set at launch. */
export function t(): Messages {
  return current;
}
