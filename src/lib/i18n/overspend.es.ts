/** Spanish for ./overspend.ts, in its own module so English pages do not download it. */

import type { osEn } from "./overspend";

export const osEs: Record<keyof typeof osEn, string> = {
  "os.label": "¿Por qué esta línea está por encima del presupuesto?",
  "os.choose": "Elige un motivo",
  "os.reason.price": "Los precios o el tipo de cambio fueron más altos de lo presupuestado",
  "os.reason.early": "Trabajo adelantado de un trimestre posterior (solo calendario)",
  "os.reason.realign": "Una reasignación que el donante ya aprobó",
  "os.reason.pending": "Una reasignación solicitada, en espera del donante",
  "os.reason.coding": "Un error de codificación que Finanzas moverá a la línea correcta",
  "os.reason.other": "Otro",
  "os.note": "Nota (opcional): una fecha, un monto o la carta del donante",
  "os.noteOther": "Di cuál es el motivo",
  "os.short": "Escribe al menos 10 caracteres.",
  "os.save": "Guardar el motivo",
  "os.clear": "Borrar el motivo",
  "os.saved": "Guardado. Aparece en cada informe trimestral mientras esta línea esté por encima del presupuesto.",
  "os.who": "Quien es responsable de MEL o líder de programa da el motivo. Aparece en cada informe trimestral mientras esta línea esté por encima del presupuesto.",
  "os.reads": "Motivo dado:",
  "os.line": "{code}: {spent} gastado de {budget} {currency} ({pct}%).",
};
