/**
 * Suggested KoboToolbox mappings (lib/kobo-suggest). English is the source; Dari, Pashto and
 * Spanish are drafts that need review by a native speaker before field use.
 */

export const ksEn = {
  "ks.suggest": "Suggest mappings",
  "ks.suggesting": "Looking at the forms… (up to a minute)",
  "ks.help": "Claude looks at the forms' questions (never the answers) and suggests one for each indicator. Nothing changes until you accept a suggestion and save.",
  "ks.acceptHigh": "Accept all high-confidence ({n})",
  "ks.accept": "Accept",
  "ks.accepted": "Accepted",
  "ks.none": "No good match: {reason}",
  "ks.conf.high": "High confidence",
  "ks.conf.medium": "Medium: check it",
  "ks.conf.low": "Low: a guess",
  "ks.risks": "Check these",
  "ks.origin.suggested": "Suggested",
  "ks.origin.suggested-edited": "Suggested, then changed",
};
type Keys = keyof typeof ksEn;
export const ksEs: Partial<Record<Keys, string>> = {
  "ks.suggest": "Sugerir correspondencias",
  "ks.suggesting": "Revisando los formularios… (hasta un minuto)",
  "ks.help": "Claude revisa las preguntas de los formularios (nunca las respuestas) y sugiere una para cada indicador. Nada cambia hasta que acepte una sugerencia y guarde.",
  "ks.acceptHigh": "Aceptar todas las de confianza alta ({n})",
  "ks.accept": "Aceptar",
  "ks.accepted": "Aceptada",
  "ks.none": "Sin buena coincidencia: {reason}",
  "ks.conf.high": "Confianza alta",
  "ks.conf.medium": "Media: revísela",
  "ks.conf.low": "Baja: una suposición",
  "ks.risks": "Revise esto",
  "ks.origin.suggested": "Sugerida",
  "ks.origin.suggested-edited": "Sugerida y cambiada",
};
export const ksFa: Partial<Record<Keys, string>> = {
  "ks.suggest": "پیشنهاد تطبیق",
  "ks.suggesting": "در حال بررسی فورم‌ها… (تا یک دقیقه)",
  "ks.help": "Claude سؤال‌های فورم‌ها را (نه پاسخ‌ها را) می‌بیند و برای هر شاخص یکی پیشنهاد می‌کند. تا پیشنهادی را نپذیرید و ذخیره نکنید، چیزی تغییر نمی‌کند.",
  "ks.acceptHigh": "پذیرفتن همهٔ پیشنهادهای با اطمینان بالا ({n})",
  "ks.accept": "پذیرفتن",
  "ks.accepted": "پذیرفته شد",
  "ks.none": "تطبیق خوبی نیست: {reason}",
  "ks.conf.high": "اطمینان بالا",
  "ks.conf.medium": "متوسط: بررسی کنید",
  "ks.conf.low": "پایین: یک حدس",
  "ks.risks": "این‌ها را بررسی کنید",
  "ks.origin.suggested": "پیشنهادی",
  "ks.origin.suggested-edited": "پیشنهادی، سپس تغییر داده شد",
};
export const ksPs: Partial<Record<Keys, string>> = {
  "ks.suggest": "د سمون وړاندیز",
  "ks.suggesting": "فورمې کتل کېږي… (تر یوې دقیقې)",
  "ks.help": "Claude د فورمو پوښتنې (نه ځوابونه) ګوري او د هر شاخص لپاره یوه وړاندیز کوي. تر هغه چې وړاندیز ونه منئ او خوندي یې نه کړئ، هېڅ نه بدلېږي.",
  "ks.acceptHigh": "ټول لوړ باور لرونکي ومنئ ({n})",
  "ks.accept": "منل",
  "ks.accepted": "ومنل شو",
  "ks.none": "ښه سمون نشته: {reason}",
  "ks.conf.high": "لوړ باور",
  "ks.conf.medium": "منځنی: وګورئ",
  "ks.conf.low": "ټیټ: اټکل",
  "ks.risks": "دا وګورئ",
  "ks.origin.suggested": "وړاندیز شوی",
  "ks.origin.suggested-edited": "وړاندیز شوی، بیا بدل شوی",
};
