/**
 * The quarterly report's checks before it goes out (lib/qpr checksFor), shown on the report page and
 * in pre-flight. English is the source; Spanish, Dari and Pashto are drafts that need review by a
 * native speaker before field use. Codes, figures, section names and status names arrive as vars.
 */

export const qcEn = {
  "qc.pending": "{code}: {n} result(s) this quarter are still waiting for MEL to check, so they are not counted.",
  "qc.queried": "{code}: MEL queried {n} result(s) this quarter, so they are not counted until corrected.",
  "qc.noProof": "{code}: {n} result(s) this quarter have no proof attached{note}.",
  "qc.completedShort": "{code}: marked Completed, but this year's result is {done} of a target of {target} {unit}.",
  "qc.notImplemented": "{code}: marked Not implemented, but this year's result is {done} {unit}.",
  "qc.commentPct": "{code}: the comment says {pcts}%, but this year's result is {real}% of the target.",
  "qc.commentStatus": "{code}: the comment should start with its status ({status}).",
  "qc.overBudget": "Spending so far ({spent}) is more than the budget ({budget}).",
  "qc.quarterOverTotal": "This quarter's spending is more than all spending so far.",
  "qc.noQuarterSpend": "This quarter's spending is not entered: import Finance's budget and spending workbook, or type it in under Project information.",
  "qc.lineOver": "Budget line {code} has spent {spent} of {budget} {currency} ({pct}%): say why it is over budget, or give the budget revision, under Project information.",
  "qc.missingMonths": "The spending import does not include {months}: import Finance's latest workbook.",
  "qc.typedSpend": "This quarter's spending is typed in as {typed}, but Finance's import says {imported}.",
  "qc.sectionEmpty": "{heading} is not written yet.",
  "qc.sectionCopied": "{heading} is copied from {from}: check it still fits this quarter.",
  "qc.activityText": "Activity {code} has results this quarter but nothing written about them.",
  "qc.risks": "The risk table is empty.",
  "qc.grm": "The complaints (GRM) numbers are not filled in.",
};

export const qcEs: Record<keyof typeof qcEn, string> = {
  "qc.pending": "{code}: {n} resultado(s) de este trimestre siguen esperando la revisión de MEL, así que no se cuentan.",
  "qc.queried": "{code}: MEL cuestionó {n} resultado(s) de este trimestre, así que no se cuentan hasta que se corrijan.",
  "qc.noProof": "{code}: {n} resultado(s) de este trimestre no tienen prueba adjunta{note}.",
  "qc.completedShort": "{code}: marcada como Completada, pero el resultado de este año es {done} de una meta de {target} {unit}.",
  "qc.notImplemented": "{code}: marcada como No implementada, pero el resultado de este año es {done} {unit}.",
  "qc.commentPct": "{code}: el comentario dice {pcts}%, pero el resultado de este año es el {real}% de la meta.",
  "qc.commentStatus": "{code}: el comentario debe empezar con su estado ({status}).",
  "qc.overBudget": "El gasto hasta ahora ({spent}) es mayor que el presupuesto ({budget}).",
  "qc.quarterOverTotal": "El gasto de este trimestre es mayor que todo el gasto hasta ahora.",
  "qc.noQuarterSpend": "El gasto de este trimestre no está ingresado: importa el libro de presupuesto y gasto de Finanzas, o escríbelo en Información del proyecto.",
  "qc.lineOver": "La línea presupuestaria {code} ha gastado {spent} de {budget} {currency} ({pct}%): di por qué está por encima del presupuesto, o indica la revisión del presupuesto, en Información del proyecto.",
  "qc.missingMonths": "La importación de gasto no incluye {months}: importa el libro más reciente de Finanzas.",
  "qc.typedSpend": "El gasto de este trimestre se escribió como {typed}, pero la importación de Finanzas dice {imported}.",
  "qc.sectionEmpty": "{heading} todavía no está escrita.",
  "qc.sectionCopied": "{heading} está copiada de {from}: revisa que sirva para este trimestre.",
  "qc.activityText": "La actividad {code} tiene resultados este trimestre, pero no hay nada escrito sobre ellos.",
  "qc.risks": "La tabla de riesgos está vacía.",
  "qc.grm": "Las cifras de quejas (GRM) no están completadas.",
};

export const qcFa: Record<keyof typeof qcEn, string> = {
  "qc.pending": "{code}: {n} نتیجهٔ این ربع هنوز منتظر بررسی MEL است، بنابراین شمرده نمی‌شود.",
  "qc.queried": "{code}: MEL بر {n} نتیجهٔ این ربع سوال گذاشته است، بنابراین تا اصلاح نشود شمرده نمی‌شود.",
  "qc.noProof": "{code}: {n} نتیجهٔ این ربع مدرک ضمیمه ندارد{note}.",
  "qc.completedShort": "{code}: «تکمیل شده» نشانی شده، اما نتیجهٔ امسال {done} از هدف {target} {unit} است.",
  "qc.notImplemented": "{code}: «تطبیق نشده» نشانی شده، اما نتیجهٔ امسال {done} {unit} است.",
  "qc.commentPct": "{code}: تبصره {pcts}% می‌گوید، اما نتیجهٔ امسال {real}% هدف است.",
  "qc.commentStatus": "{code}: تبصره باید با وضعیت آن ({status}) شروع شود.",
  "qc.overBudget": "مصارف تا حال ({spent}) بیشتر از بودجه ({budget}) است.",
  "qc.quarterOverTotal": "مصارف این ربع بیشتر از تمام مصارف تا حال است.",
  "qc.noQuarterSpend": "مصارف این ربع درج نشده است: فایل بودجه و مصارف بخش مالی را وارد کنید، یا آن را در معلومات پروژه بنویسید.",
  "qc.lineOver": "خط بودجهٔ {code} مبلغ {spent} از {budget} {currency} ({pct}%) را مصرف کرده است: در معلومات پروژه بنویسید چرا از بودجه بیشتر است، یا تعدیل بودجه را بدهید.",
  "qc.missingMonths": "مصارف واردشده {months} را ندارد: آخرین فایل بخش مالی را وارد کنید.",
  "qc.typedSpend": "مصارف این ربع {typed} نوشته شده، اما فایل واردشدهٔ بخش مالی {imported} می‌گوید.",
  "qc.sectionEmpty": "{heading} هنوز نوشته نشده است.",
  "qc.sectionCopied": "{heading} از {from} کاپی شده است: ببینید که برای این ربع مناسب است.",
  "qc.activityText": "فعالیت {code} در این ربع نتیجه دارد، اما چیزی در مورد آن نوشته نشده است.",
  "qc.risks": "جدول خطرات خالی است.",
  "qc.grm": "ارقام شکایات (GRM) درج نشده است.",
};

export const qcPs: Record<keyof typeof qcEn, string> = {
  "qc.pending": "{code}: د دې ربعې {n} پایلې لا هم د MEL کتنې ته انتظار دي، نو نه شمېرل کېږي.",
  "qc.queried": "{code}: MEL د دې ربعې پر {n} پایلو پوښتنه کړې، نو تر سمولو پورې نه شمېرل کېږي.",
  "qc.noProof": "{code}: د دې ربعې {n} پایلې ثبوت نه لري{note}.",
  "qc.completedShort": "{code}: «بشپړ شوی» نښه شوی، خو د سږکال پایله د {target} {unit} هدف څخه {done} ده.",
  "qc.notImplemented": "{code}: «نه دی پلي شوی» نښه شوی، خو د سږکال پایله {done} {unit} ده.",
  "qc.commentPct": "{code}: تبصره {pcts}% وايي، خو د سږکال پایله د هدف {real}% ده.",
  "qc.commentStatus": "{code}: تبصره باید د خپل حالت ({status}) سره پیل شي.",
  "qc.overBudget": "تر اوسه لګښت ({spent}) له بودجې ({budget}) څخه زیات دی.",
  "qc.quarterOverTotal": "د دې ربعې لګښت تر اوسه له ټول لګښت څخه زیات دی.",
  "qc.noQuarterSpend": "د دې ربعې لګښت نه دی داخل شوی: د مالي څانګې د بودجې او لګښت فایل راوړئ، یا یې د پروژې معلوماتو کې ولیکئ.",
  "qc.lineOver": "د بودجې کرښې {code} د {budget} {currency} څخه {spent} لګښت کړی ({pct}%): د پروژې معلوماتو کې ولیکئ چې ولې له بودجې زیات دی، یا د بودجې تعدیل ورکړئ.",
  "qc.missingMonths": "راوړل شوی لګښت {months} نه لري: د مالي څانګې وروستی فایل راوړئ.",
  "qc.typedSpend": "د دې ربعې لګښت {typed} لیکل شوی، خو د مالي څانګې راوړل شوی فایل {imported} وايي.",
  "qc.sectionEmpty": "{heading} لا نه دی لیکل شوی.",
  "qc.sectionCopied": "{heading} له {from} څخه کاپي شوی: وګورئ چې د دې ربعې لپاره سم دی.",
  "qc.activityText": "فعالیت {code} په دې ربعه کې پایلې لري، خو د هغو په اړه څه نه دي لیکل شوي.",
  "qc.risks": "د خطرونو جدول خالي دی.",
  "qc.grm": "د شکایتونو (GRM) شمېرې نه دي ډکې شوې.",
};
