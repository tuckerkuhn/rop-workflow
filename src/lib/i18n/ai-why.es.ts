/** Spanish for ./ai-why.ts, in its own module so English pages do not download it. */

import type { awEn } from "./ai-why";

export const awEs: Partial<Record<keyof typeof awEn, string>> = {
  "ai.why": "Por qué:",
  "ai.looked": "Qué revisó:",
  "ai.looks.dataChecks": "los otros registros de esta meta, las cifras de mujeres y hombres, las pruebas y las fechas de las fotos. Son reglas fijas, no IA: el mismo registro siempre recibe los mismos avisos.",
  "ai.looks.claimCheck": "el texto del informe, los resultados aceptados de este trimestre y las actualizaciones semanales, con los nombres de las personas reemplazados. La IA avisa; tú decides.",
  "ai.looks.procurementCheck": "el registro de esta compra: el artículo, el valor, la línea de presupuesto, las fechas, el proveedor y las firmas. La IA avisa; tú decides.",
  "ai.looks.koboSuggest": "los nombres de los formularios, las preguntas y las opciones de respuesta. Nunca las respuestas de las personas.",
  "cc.fix": "Corregir el texto",
  "cc.keep": "El texto está bien",
  "cc.fixing": "Por corregir. Marcado por {name}.",
  "cc.kept": "Se queda como está. Decidido por {name}.",
  "cc.undo": "Cambiar",
  "ks.decline": "Esta no",
  "ks.declined": "Queda para que la asignes a mano",
};
