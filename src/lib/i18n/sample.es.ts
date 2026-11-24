/** Spanish for ./sample.ts, in its own module so English pages do not download it. */

import type { spEn } from "./sample";

export const spEs: Record<keyof typeof spEn, string> = {
  "sample.banner": "Proyecto de muestra con datos ficticios, para ver un informe terminado. Aquí no se puede cambiar nada.",
  "sample.see": "Ver un informe terminado",
  "sample.setUp": "Configurar tu proyecto",
  "sample.title": "Proyecto de muestra",
  "sample.help": "Un proyecto terminado con datos ficticios: metas, resultados aceptados con pruebas, un presupuesto con gastos y un informe trimestral publicado. Todos pueden abrirlo; nadie puede cambiarlo, y no cuenta en ningún total.",
  "sample.shown": "Visible para todos",
  "sample.hidden": "Oculto",
  "sample.hide": "Ocultarlo",
  "sample.show": "Mostrarlo de nuevo",
  "sample.reason": "Por qué (se guarda con el cambio)",
  "sample.since": "Desde el {date}, por {who}: {reason}",
  "sample.adminOnly": "Solo un administrador lo oculta o lo muestra.",
  "sample.history": "Cambios anteriores",
  "sample.changed": "{date}: {state} por {who}. {reason}",
  "sample.stateHidden": "ocultado",
  "sample.stateShown": "mostrado",
  "sample.doneHidden": "El proyecto de muestra está oculto",
  "sample.doneShown": "El proyecto de muestra está visible",
};
