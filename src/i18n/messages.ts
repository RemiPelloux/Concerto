import { KEYS } from "#src/ui/keys.js";

/** Every TUI line that guides the person, in each language Concerto speaks. */
export type Messages = {
  welcome: string;
  phase: { idle: string; scoring: string; clarifying: string; planned: string; running: string; done: string; failed: string };
  zone: { agents: string; stories: () => string; changes: string };
  retry: (n: number) => string;
  back: string;
  /** The big call-out over a plan waiting for Enter. */
  build: string;
  prompt: { scoring: string; clarifying: string; planned: string; running: string; retry: (n: number) => string; idle: string };
};

export const en: Messages = {
  welcome: "♪ Welcome to Concerto",
  phase: {
    idle: "enter to score · / for commands · tab to look around",
    scoring: "✻ Scoring… (esc to interrupt)",
    clarifying: "answer the questions in the log · enter alone lets the rewriter decide · esc to drop the request",
    planned: "enter to build · type a change to re-plan · esc to discard the plan · tab to inspect the stories",
    running: "✻ Working… type a note for the agents · tab to watch them · esc to interrupt",
    done: "done · tab to review the changes · type a new request",
    failed: "stopped · tab to see what happened · type a new request",
  },
  zone: {
    agents: "agents · ↑↓ select · enter live output · tab next · esc prompt",
    stories: () => `stories · ↑↓ select · enter why this score · ${KEYS.drop} drop · ${KEYS.merge} merge next in · ${KEYS.split} split · tab next · esc prompt`,
    changes: "changes · ↑↓ select · enter diff · tab next · esc prompt",
  },
  retry: (n) => `enter retries the ${n} ${n === 1 ? "story" : "stories"} that did not pass · tab to review · or type a new request`,
  back: "esc back",
  build: "ENTER TO BUILD",
  prompt: {
    scoring: "Scoring… type / for commands; a change to the request waits for the plan.",
    clarifying: "Type your answers and Enter · Enter alone lets the rewriter decide · / for commands",
    planned: "Enter builds the plan · or type a change and Enter to re-plan · / for commands",
    running: "Type a note for the agents: they read it from their next step · / for commands",
    retry: (n) => `Enter retries the ${n} that did not pass · or type a new request · / for commands`,
    idle: "Describe the job and what done means, or type / for commands.",
  },
};

export const fr: Messages = {
  welcome: "♪ Bienvenue dans Concerto",
  phase: {
    idle: "entrée pour évaluer · / pour les commandes · tab pour explorer",
    scoring: "✻ Évaluation… (échap pour interrompre)",
    clarifying: "répondez aux questions du journal · entrée seule laisse le réécrivain décider · échap pour abandonner la demande",
    planned: "entrée pour construire · tapez une modification pour refaire le plan · échap pour l'abandonner · tab pour voir les stories",
    running: "✻ Au travail… tapez une note pour les agents · tab pour les suivre · échap pour interrompre",
    done: "terminé · tab pour relire les changements · tapez une nouvelle demande",
    failed: "arrêté · tab pour voir ce qui s'est passé · tapez une nouvelle demande",
  },
  zone: {
    agents: "agents · ↑↓ choisir · entrée sortie en direct · tab suivant · échap invite",
    stories: () => `stories · ↑↓ choisir · entrée pourquoi ce score · ${KEYS.drop} retirer · ${KEYS.merge} fusionner la suivante · ${KEYS.split} scinder · tab suivant · échap invite`,
    changes: "changements · ↑↓ choisir · entrée diff · tab suivant · échap invite",
  },
  retry: (n) => `entrée relance ${n === 1 ? "la story qui n'a pas réussi" : `les ${n} stories qui n'ont pas réussi`} · tab pour relire · ou tapez une nouvelle demande`,
  back: "échap retour",
  build: "ENTRÉE POUR CONSTRUIRE",
  prompt: {
    scoring: "Évaluation… tapez / pour les commandes ; une modification de la demande attend le plan.",
    clarifying: "Tapez vos réponses puis Entrée · Entrée seule laisse le réécrivain décider · / pour les commandes",
    planned: "Entrée construit le plan · ou tapez une modification puis Entrée pour refaire le plan · / pour les commandes",
    running: "Tapez une note pour les agents : ils la lisent à leur prochaine étape · / pour les commandes",
    retry: (n) => `Entrée relance ${n === 1 ? "celle qui n'a pas réussi" : `les ${n} qui n'ont pas réussi`} · ou tapez une nouvelle demande · / pour les commandes`,
    idle: "Décrivez le travail et ce que « terminé » veut dire, ou tapez / pour les commandes.",
  },
};
