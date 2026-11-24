/** Spanish for ./qpr-checks.ts, in its own module so English pages do not download it. */

import type { qcEn } from "./qpr-checks";

export const qcEs: Record<keyof typeof qcEn, string> = {
  "qc.pending": "{code}: {n} resultado(s) de este trimestre siguen esperando la revisión de MEL, así que no se cuentan.",
  "qc.queried": "{code}: MEL cuestionó {n} resultado(s) de este trimestre, así que no se cuentan hasta que se corrijan.",
  "qc.noProof": "{code}: {n} resultado(s) de este trimestre no tienen prueba adjunta{note}.",
  "qc.completedShort": "{code}: marcada como Completada, pero el resultado de este año es {done} de una meta de {target} {unit}.",
  "qc.notImplemented": "{code}: marcada como No implementada, pero el resultado de este año es {done} {unit}.",
  "qc.commentPct": "{code}: el comentario dice {pcts}%, pero el resultado de este año es el {real}% de la meta.",
  "qc.commentStatus": "{code}: el comentario debe empezar con su estado ({status}).",
  "qc.overBudget": "El gasto hasta ahora ({spent}) es mayor que el presupuesto ({budget}).",
  "qc.quarterOverTotal": "El gasto de este trimestre es mayor que todo el gasto hasta ahora.",
  "qc.noQuarterSpend": "El gasto de este trimestre no está ingresado: importa el libro de presupuesto y gasto de Finanzas, o escríbelo en Información del proyecto.",
  "qc.lineOver": "La línea presupuestaria {code} ha gastado {spent} de {budget} {currency} ({pct}%): di por qué está por encima del presupuesto, o indica la revisión del presupuesto, en Información del proyecto.",
  "qc.missingMonths": "La importación de gasto no incluye {months}: importa el libro más reciente de Finanzas.",
  "qc.typedSpend": "El gasto de este trimestre se escribió como {typed}, pero la importación de Finanzas dice {imported}.",
  "qc.sectionEmpty": "{heading} todavía no está escrita.",
  "qc.sectionCopied": "{heading} está copiada de {from}: revisa que sirva para este trimestre.",
  "qc.activityText": "La actividad {code} tiene resultados este trimestre, pero no hay nada escrito sobre ellos.",
  "qc.risks": "La tabla de riesgos está vacía.",
  "qc.grm": "Las cifras de quejas (GRM) no están completadas.",
};
