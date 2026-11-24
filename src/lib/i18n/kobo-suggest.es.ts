/** Spanish for ./kobo-suggest.ts, in its own module so English pages do not download it. */

import type { ksEn } from "./kobo-suggest";

type Keys = keyof typeof ksEn;

export const ksEs: Partial<Record<Keys, string>> = {
  "ks.suggest": "Sugerir correspondencias",
  "ks.suggesting": "Revisando los formularios… (hasta un minuto)",
  "ks.help": "Claude revisa las preguntas de los formularios (nunca las respuestas) y sugiere una para cada meta. Nada cambia hasta que acepte una sugerencia y guarde.",
  "ks.acceptHigh": "Aceptar todas las de confianza alta ({n})",
  "ks.accept": "Aceptar",
  "ks.accepted": "Aceptada",
  "ks.none": "Sin buena coincidencia: {reason}",
  "ks.conf.high": "Confianza alta",
  "ks.conf.medium": "Media: revísela",
  "ks.conf.low": "Baja: una suposición",
  "ks.risks": "Revise esto",
  "ks.origin.suggested": "Sugerida",
  "ks.origin.suggested-edited": "Sugerida y cambiada",
};
