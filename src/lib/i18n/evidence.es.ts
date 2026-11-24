/** Spanish for ./evidence.ts, in its own module so English pages do not download it. */

import type { evEn } from "./evidence";

type Keys = keyof typeof evEn;

export const evEs: Partial<Record<Keys, string>> = {
  "ev.title": "Detrás de esta cifra",
  "ev.summary": "Resultados aceptados: {count} · total {n} {unit}",
  "ev.period": "Del {from} al {to}",
  "ev.since": "Hasta el {to}",
  "ev.recorded": "Registrado por {who}",
  "ev.accepted": "Aceptado por {who}, {date}",
  "ev.notAccepted": "No aceptado",
  "ev.noProof": "Sin prueba todavía",
  "ev.noFile": "Sin archivo: {why}",
  "ev.kobo": "Envío de KoboToolbox {id}",
  "ev.open": "Abrir en Resultados y pruebas",
  "ev.close": "Cerrar",
  "ev.loading": "Cargando…",
  "ev.none": "No hay resultados aceptados detrás de esta cifra.",
  "ev.show": "Ver los registros y pruebas detrás de {n}",
  "ev.money.title": "De dónde salen las cifras de gasto",
  "ev.money.hint":
    "El gasto sale del libro de presupuesto frente a gasto real de Finanzas, tal como se importó, sumado por línea presupuestaria.",
  "ev.money.file": "{file}, importado por {who} el {date}",
  "ev.money.months": "Meses {from} a {to} · {lines} líneas · {currency}",
  "ev.money.none": "Todavía no se ha importado gasto de Finanzas.",
  "ev.money.sharepoint": "Abrir en SharePoint",
  "ev.money.show": "De dónde sale",
};
