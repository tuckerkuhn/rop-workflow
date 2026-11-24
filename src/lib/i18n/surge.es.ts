/** Spanish for ./surge.ts, in its own module so English pages do not download it. */

import type { hbEn, hkEn, pmEn, prEn, sgEn } from "./surge";

export const sgEs: Partial<Record<keyof typeof sgEn, string>> = {
  "pf.uncheckedConfirm": "No se pudo hacer la revisión previa en este momento, así que la aplicación no sabe si algo bloquea este informe. El archivo llevará la marca \"Borrador, sin revisar\". ¿Descargarlo de todos modos?",
  "pf.c.typedSpend": "El gasto de este trimestre está escrito a mano como {typed}, pero el archivo de Finanzas dice {imported}. El informe mostrará la cifra escrita: bórrala para usar la de Finanzas, o déjala y prepárate para explicar la diferencia.",
  "err.title": "No se pudo cargar esta página",
  "err.body": "No se perdió nada de lo que guardaste. Revisa tu conexión e inténtalo de nuevo. Si sigue pasando, avisa a un administrador.",
  "err.retry": "Intentar de nuevo",
  "err.home": "Ir a Inicio",
  "load.wait": "Cargando…",
  "tasks.loadFailed": "No se pudo cargar tu trabajo en este proyecto, así que a esta lista le pueden faltar cosas. Revisa tu conexión e inténtalo de nuevo.",
  "closeout.loadFailed": "No se pudieron cargar las facturas, así que pueden faltar comprobantes en esta lista. Revisa tu conexión y vuelve a cargar la página.",
  "field.saveFailed": "El último cambio no se guardó: {error} Revisa tu conexión y haz el cambio otra vez.",
  "report.loading": "Cargando el informe…",
  "report.blocked": "{n} cosas bloquean este informe, así que todavía no se puede marcar como final. La revisión previa muestra cada una y dónde corregirla.",
  "report.blockedOne": "1 cosa bloquea este informe, así que todavía no se puede marcar como final. La revisión previa muestra cuál es y dónde corregirla.",
  "setup.saveFailed": "El proyecto no se guardó. No se perdió nada de lo que escribiste: revisa tu conexión y pulsa Guardar otra vez.",
};

export const hbEs: Partial<Record<keyof typeof hbEn, string>> = {
  "home.b.title": "Te está esperando",
  "home.b.none": "Nada te está esperando.",
  "home.b.approve": "Aprobar",
  "home.b.fix": "Corregir",
  "home.b.due": "Por entregar",
  "home.b.blocks": "Bloquea el informe:",
  "home.b.now": "Ahora",
  "home.b.reportDue": "Informe {report}: tenerlo listo para el {date}",
  "home.b.reviewDue": "{review} cierra el {date}",
  "home.b.days": "{n} días",
  "home.b.today": "Hoy",
  "home.b.late": "{n} días de atraso",
};

export const prEs: Partial<Record<keyof typeof prEn, string>> = {
  "prog.title": "Metas en {year}",
  "prog.target": "Meta",
  "prog.result": "Resultado hasta ahora",
  "prog.w.done": "Cumplida",
  "prog.w.on_track": "En marcha",
  "prog.w.not_started": "Sin empezar",
  "prog.w.behind": "Atrasada",
  "prog.w.no_data": "Sin datos",
  "prog.d.notDue": "todavía no toca",
  "prog.d.dueNow": "toca este trimestre",
  "prog.d.notPlanned": "no está en el plan de trabajo de este año",
  "prog.d.delayed": "con retraso",
  "prog.d.notDone": "no se hizo",
  "prog.last": "Último resultado aceptado: {date}",
  "prog.noLast": "Todavía no hay un resultado aceptado",
  "prog.open": "Toca una fila para ver los registros y las pruebas.",
};

export const pmEs: Partial<Record<keyof typeof pmEn, string>> = {
  "pf.clearNext": "Nada bloquea este informe. Ábrelo, léelo completo y márcalo como final.",
  "home.kobo.title": "Tus datos llegan por KoboCollect",
  "home.kobo.body": "Sigue llenando los formularios en tu teléfono como hasta ahora. No tienes que escribir nada aquí. Lo enviado aparece abajo después de la próxima sincronización, y luego lo revisa MEL.",
  "home.kobo.recent": "Últimos envíos recibidos para este proyecto",
  "home.kobo.notYours": "La aplicación todavía no puede saber cuáles envíos son tuyos, así que esta lista es de todo el proyecto.",
  "home.kobo.none": "Todavía no ha llegado ningún envío. Si ya enviaste alguno, aparecerá aquí después de la próxima sincronización.",
  "home.kobo.synced": "Última sincronización: {date}",
  "home.kobo.neverSynced": "Todavía sin sincronizar",
  "home.kobo.pending": "Esperando a MEL",
  "home.kobo.accepted": "Contado",
  "home.kobo.queried": "MEL tiene una pregunta",
};

export const hkEs: Partial<Record<keyof typeof hkEn, string>> = {
  "health.kobo.title": "Revisión nocturna de KoboToolbox",
  "health.kobo.help": "Cada noche la aplicación vuelve a leer los formularios de cada proyecto conectado, para detectar respuestas editadas o borradas en KoboToolbox después de llegar. Esto nunca cambia un resultado aceptado: lo marca para MEL.",
  "health.kobo.none": "Ninguna revisión en la última semana. Empieza cuando la tarea programada esté activa y haya un proyecto conectado a KoboToolbox.",
  "health.kobo.same": "{fetched} envíos revisados: nada había cambiado.",
  "health.kobo.changed": "{fetched} envíos revisados: {added} nuevos, {updated} editados, {removed} borrados en KoboToolbox.",
  "health.kobo.flagged": "Resultados aceptados que cambiaron en KoboToolbox y se marcaron para MEL: {n}.",
  "health.kobo.failed": "No se ejecutó: {error}",
};
