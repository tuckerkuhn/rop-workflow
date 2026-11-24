/** Spanish for ./agreement.ts, in its own module so English pages do not download it. */

import type { agEn } from "./agreement";

type Keys = keyof typeof agEn;

export const agEs: Partial<Record<Keys, string>> = {
  "ag.title": "Empezar desde los documentos",
  "ag.help": "Suba el acuerdo firmado, el marco lógico o de resultados y el presupuesto (PDF, Word o Excel). Basta con uno. Claude propone cada parte con su origen; usted confirma cada sección antes de guardar nada.",
  "ag.helpRunning": "Suba el acuerdo firmado (y el presupuesto, si el proyecto aún no lo tiene). Claude propone los plazos de informe y las reglas del donante con su origen; usted los confirma.",
  "ag.slot.agreement": "Acuerdo",
  "ag.slot.logframe": "Marco lógico o de resultados",
  "ag.slot.budget": "Presupuesto",
  "ag.choose": "Elegir archivo",
  "ag.read": "Leer los documentos",
  "ag.reading": "Leyendo… (hasta 2 minutos)",
  "ag.partFailed": "No se pudo leer {part}: {error}",
  "ag.done": "Leído. Revise cada paso: nada se guarda hasta que lo confirme.",
  "ag.sources": "De dónde sale cada respuesta",
  "ag.budgetFrom": "Propuesto desde {file}: revise las líneas y guarde, u omita.",
  "ag.deadlines.title": "Plazos de informe",
  "ag.deadlines.help": "Los informes que exige el acuerdo, con sus fechas durante el proyecto. Cada uno que conserve se convierte en un plazo de informe en Tareas, y la revisión previa cuenta los días hasta él.",
  "ag.deadlines.none": "No se propusieron obligaciones de informe. Suba el acuerdo arriba, o añada plazos en Tareas.",
  "ag.deadlines.days": "Vence {days} días después de cada periodo",
  "ag.deadlines.format": "Formato: {format}",
  "ag.deadlines.save": "Añadir {n} plazos a Tareas",
  "ag.deadlines.saved": "{n} plazos añadidos a Tareas.",
  "ag.rules.title": "Las reglas del donante",
  "ag.rules.help": "Reglas del acuerdo que la aplicación puede comprobar. Cada una que conserve pasa a ser la regla del proyecto en Configuración, Política, con su cláusula.",
  "ag.rules.none": "No se propusieron reglas. Suba el acuerdo arriba, o configúrelas en Configuración, Política.",
  "ag.rules.terms": "Otros términos a cumplir",
  "ag.rules.termsHelp": "Se listan en la página de política para el equipo; la aplicación no los comprueba.",
  "ag.rules.save": "Guardar {n} reglas y {m} términos",
  "ag.rules.saved": "Guardado en la política del proyecto.",
  "ag.questions": "Por aclarar",
  "ag.skip": "Omitir",
  "ag.keep": "Conservar",
  "ag.source": "Origen: {source}",
};
