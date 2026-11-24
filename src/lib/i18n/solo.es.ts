/** Spanish for ./solo.ts, in its own module so English pages do not download it. */

import type { soEn } from "./solo";

export const soEs: Record<keyof typeof soEn, string> = {
  "so.title": "Aprobación individual (equipos pequeños)",
  "so.help": "Por defecto firman dos personas: quien prepara algo no lo aprueba. Para un equipo pequeño en el que una persona tiene varias funciones, un administrador puede permitir que esa persona apruebe su propio resultado, cambio de la revisión mensual, factura o compra. Cada vez lo confirma, y queda marcado como autoaprobado en el registro de auditoría, la comprobación previa y los paquetes de evidencia.",
  "so.never": "Nunca a solas, ni en modo individual: adjudicaciones grandes, fuente única y excepciones, y cualquier proyecto cuyo donante exija una segunda persona.",
  "so.on": "El modo individual está activado",
  "so.off": "El modo individual está desactivado",
  "so.since": "Desde el {date}, por {who}: {reason}",
  "so.turnOn": "Activar",
  "so.turnOff": "Desactivar",
  "so.reason": "Motivo (se guarda con el cambio)",
  "so.adminOnly": "Solo un administrador lo activa o desactiva.",
  "so.history": "Cambios anteriores",
  "so.changed": "{date}: {state} por {who}. {reason}",
  "so.stateOn": "activado",
  "so.stateOff": "desactivado",
  "so.confirmTitle": "Aprobar su propio trabajo",
  "so.statement": "Yo preparé esto y lo apruebo yo mismo/a.",
  "so.note": "Nota (opcional)",
  "so.notePh": "Por ejemplo: nadie más en el equipo tiene esta función.",
  "so.approve": "Aprobar",
  "so.cancel": "Cancelar",
  "so.marked": "Queda marcado como autoaprobado en el registro de auditoría y los paquetes de evidencia.",
  "so.yours": "Usted registró esto. El modo individual le permite aceptarlo.",
  "so.self": "Autoaprobado",
  "so.pf": "{n} aprobaciones del período las hizo la misma persona que las preparó (modo individual): conviene una segunda mirada antes de publicar",
  "so.pf1": "1 aprobación del período la hizo la misma persona que la preparó (modo individual): conviene una segunda mirada antes de publicar",
};
