/** Spanish for ./plain-words.ts, in its own module so English pages do not download it. */

import type { pwEn } from "./plain-words";

export const pwEs: Record<keyof typeof pwEn, string> = {
  "pw.howMany": "Cuántos",
  "pw.target": "Meta",
  "pw.targets": "Metas",
  "pw.frameworkIntro": "Desde el objetivo hasta cada meta y las actividades de ROP, con el avance de este año. El árbol sigue los códigos del donante; cada enunciado dice de dónde viene su redacción.",
  "pw.noTargets": "Este proyecto no tiene metas que reciban resultados registrados.",
  "pw.fromKobo": "Esta meta se cuenta desde un formulario de KoboToolbox, así que sus resultados no se registran aquí.",
  "pw.whichTarget": "¿Para qué meta es el resultado?",
  "pw.noActivityNumbers": "Las metas de este proyecto aún no tienen números de actividad (como 1.1.1), así que no hay dónde archivar los elementos. Agrega primero los códigos del donante en Marco de resultados.",
  "pw.paysFor": "La línea del presupuesto que paga esta meta",
  "pw.importBva": "Importar el libro de presupuesto y gasto de Finanzas",
  "pw.fromBva": "Del libro de presupuesto y gasto de Finanzas:",
  "pw.baselines": "Las líneas de base marcadas — no están registradas para la meta; agrégalas en Detalles de la meta.",
  "pw.windowFirst": "Los resultados, las metas y el presupuesto se redactan después de fijar la ventana de mercado.",
  "pw.notDrafted": "El marco de resultados, las actividades, las metas y el presupuesto aún no están redactados. Se planifican a partir de la ventana de mercado de arriba.",
};
