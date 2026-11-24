/** Spanish for ./target-details.ts, in its own module so English pages do not download it. */

import type { tdEn } from "./target-details";

export const tdEs: Partial<Record<keyof typeof tdEn, string>> = {
  "td.title": "Detalles de las metas",
  "td.intro": "Seis datos de cada meta de los que dependen los informes y las revisiones. Los fija quien aprueba los planes, y cada cambio queda en el registro de auditoría.",
  "td.readOnly": "Puedes leerlos. Los cambia quien aprueba los planes.",
  "td.empty": "Este proyecto todavía no tiene metas. Agrégalas en la configuración.",
  "td.demo": "Elige un proyecto guardado en la base de datos.",
  "td.baseline": "Línea de base",
  "td.baseline.help": "La cifra antes de que empezara el proyecto. Déjalo vacío si no hay.",
  "td.baseline.bad": "Usa cifras y un punto, con dos decimales como máximo, por ejemplo 1250.5. Sin comas.",
  "td.breakdown": "Se informa por",
  "td.by.sex": "Mujeres y hombres",
  "td.by.province": "Provincia",
  "td.by.district": "Distrito",
  "td.breakdown.help": "Un resultado al que le falte uno de estos se marca para MEL.",
  "td.breakdown.other": "También se conserva: {list}",
  "td.verification": "Documentos de prueba",
  "td.verification.help": "Lo que prueba un resultado, por ejemplo listas de asistencia o un informe de verificación en campo.",
  "td.budgetRef": "Línea de presupuesto que la paga",
  "td.budgetRef.help": "El Presupuesto y el informe trimestral muestran el gasto de esta línea junto a la meta.",
  "td.workplanCode": "Paso del plan de trabajo que la entrega",
  "td.workplanCode.help": "Permite al informe distinguir el trabajo atrasado del trabajo planeado para un trimestre posterior.",
  "td.none": "Sin definir",
  "td.inQpr": "En la tabla trimestral del donante",
  "td.inQpr.help": "Desmarca si la meta se sigue solo para otros informes.",
  "td.baselineMissing": "Las líneas de base marcadas con — no están registradas. Agrégalas en:",
  "td.save": "Guardar",
  "td.saved": "Guardado.",
};
