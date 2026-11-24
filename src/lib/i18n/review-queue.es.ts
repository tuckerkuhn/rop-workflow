/** Spanish for ./review-queue.ts, in its own module so English pages do not download it. */

import type { rqEn } from "./review-queue";

type Keys = keyof typeof rqEn;

export const rqEs: Partial<Record<Keys, string>> = {
  "rq.line": "{clean} sin alertas, {flagged} con alertas.",
  "rq.accept": "Aceptar {n}",
  "rq.review": "Revisar {n}",
  "rq.confirm": "¿Aceptar estos {n} resultados? Cada uno cuenta desde ahora en Progreso y en el informe. Los resultados con alertas se revisan uno por uno.",
  "rq.accepted": "{n} resultados aceptados.",
  "rq.of": "{k} de {n} con alertas",
  "rq.more": "+{n} más",
  "rq.less": "Ver menos",
  "rq.acceptOne": "Aceptar",
  "rq.query": "Consultar",
  "rq.what": "¿Qué hay que corregir?",
  "rq.send": "Enviar consulta",
  "rq.cancel": "Cancelar",
  "rq.back": "Volver a la lista",
  "rq.done": "Todos los resultados con alertas están decididos.",
};
