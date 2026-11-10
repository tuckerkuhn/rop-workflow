/**
 * Text added in the November 2026 clean-up: what a screen says when something could not load or
 * be checked, and what to do next. English is the source; Spanish, Dari and Pashto are drafts
 * that need review by a native speaker before field use. A missing string falls back to English.
 */

export const sgEn = {
  "pf.uncheckedConfirm": "Pre-flight could not be checked just now, so the app cannot tell whether anything blocks this report. The file will be marked \"Draft, not checked\". Download it anyway?",
  "pf.c.typedSpend": "This quarter's spending is typed in as {typed}, but Finance's import says {imported}. The report will print the typed figure: clear it to use Finance's, or keep it and be ready to explain the difference.",
  "err.title": "This page could not load",
  "err.body": "Nothing you saved is lost. Check your connection and try again. If it keeps happening, tell an administrator.",
  "err.retry": "Try again",
  "err.home": "Go to Home",
  "load.wait": "Loading…",
  "tasks.loadFailed": "Your work on this project could not be loaded, so this list may be missing things. Check your connection and try again.",
  "closeout.loadFailed": "The bills could not be loaded, so vouchers may be missing from this list. Check your connection and reload the page.",
  "field.saveFailed": "The last change was not saved: {error} Check your connection, then make the change again.",
  "report.loading": "Loading the report…",
  "report.blocked": "{n} things block this report, so it cannot be marked final yet. Pre-flight lists each one and where to fix it.",
  "report.blockedOne": "1 thing blocks this report, so it cannot be marked final yet. Pre-flight shows what it is and where to fix it.",
  "setup.saveFailed": "The project was not saved. Nothing you entered is lost: check your connection and press Save again.",
};

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

export const sgFa: Partial<Record<keyof typeof sgEn, string>> = {
  "pf.uncheckedConfirm": "بررسی پیش از ارسال همین حالا انجام نشد، پس برنامه نمی‌داند چیزی جلوی این گزارش را می‌گیرد یا نه. فایل با نشان «پیش‌نویس، بررسی نشده» ساخته می‌شود. با این حال دانلود شود؟",
  "pf.c.typedSpend": "مصرف این ربع با دست {typed} نوشته شده، اما فایل بخش مالی {imported} می‌گوید. گزارش رقم نوشته‌شده را نشان می‌دهد: آن را پاک کنید تا رقم بخش مالی به کار رود، یا نگه دارید و برای توضیح تفاوت آماده باشید.",
  "err.title": "این صفحه باز نشد",
  "err.body": "چیزی که ذخیره کرده‌اید از بین نرفته است. اتصال خود را ببینید و دوباره کوشش کنید. اگر تکرار شد، به مدیر سیستم بگویید.",
  "err.retry": "دوباره کوشش کنید",
  "err.home": "رفتن به صفحهٔ اصلی",
  "load.wait": "در حال بارگیری…",
  "tasks.loadFailed": "کارهای شما در این پروژه بارگیری نشد، پس شاید این فهرست کامل نباشد. اتصال خود را ببینید و دوباره کوشش کنید.",
  "closeout.loadFailed": "بل‌ها بارگیری نشد، پس شاید بعضی سندها در این فهرست نباشد. اتصال خود را ببینید و صفحه را دوباره باز کنید.",
  "field.saveFailed": "آخرین تغییر ذخیره نشد: {error} اتصال خود را ببینید و تغییر را دوباره انجام دهید.",
  "report.loading": "گزارش در حال بارگیری است…",
  "report.blocked": "{n} مورد جلوی این گزارش را می‌گیرد، پس هنوز نمی‌توان آن را نهایی کرد. «بررسی پیش از ارسال» هر مورد و جای اصلاح آن را نشان می‌دهد.",
  "report.blockedOne": "۱ مورد جلوی این گزارش را می‌گیرد، پس هنوز نمی‌توان آن را نهایی کرد. «بررسی پیش از ارسال» نشان می‌دهد چیست و کجا اصلاح می‌شود.",
  "setup.saveFailed": "پروژه ذخیره نشد. چیزی که نوشته‌اید از بین نرفته است: اتصال خود را ببینید و دوباره «ذخیره» را بزنید.",
};

export const sgPs: Partial<Record<keyof typeof sgEn, string>> = {
  "pf.uncheckedConfirm": "له لېږلو مخکې کتنه همدا اوس ونه شوه، نو اپلیکیشن نه پوهېږي چې کوم شی دا راپور دروي که نه. فایل به د «مسوده، نه ده کتل شوې» نښه ولري. بیا هم ښکته یې کړو؟",
  "pf.c.typedSpend": "د دې ربع لګښت په لاس {typed} لیکل شوی، خو د مالي څانګې فایل {imported} وایي. راپور به لیکل شوی رقم وښيي: هغه پاک کړئ چې د مالي څانګې رقم وکارول شي، یا یې وساتئ او د توپیر تشریح ته چمتو اوسئ.",
  "err.title": "دا پاڼه خلاصه نه شوه",
  "err.body": "هغه څه چې تاسو خوندي کړي له منځه نه دي تللي. خپله اړیکه وګورئ او بیا هڅه وکړئ. که بیا هم وشوه، مدیر ته ووایاست.",
  "err.retry": "بیا هڅه وکړئ",
  "err.home": "کور پاڼې ته ولاړ شئ",
  "load.wait": "راپورته کېږي…",
  "tasks.loadFailed": "په دې پروژه کې ستاسو کارونه رانه غلل، نو ښايي دا لېست بشپړ نه وي. خپله اړیکه وګورئ او بیا هڅه وکړئ.",
  "closeout.loadFailed": "بلونه رانه غلل، نو ښايي ځینې سندونه په دې لېست کې نه وي. خپله اړیکه وګورئ او پاڼه بیا خلاصه کړئ.",
  "field.saveFailed": "وروستی بدلون خوندي نه شو: {error} خپله اړیکه وګورئ او بدلون بیا وکړئ.",
  "report.loading": "راپور راپورته کېږي…",
  "report.blocked": "{n} ټکي دا راپور دروي، نو لا یې وروستی کول نه شي. «له لېږلو مخکې کتنه» هر یو او د سمولو ځای یې ښيي.",
  "report.blockedOne": "۱ ټکی دا راپور دروي، نو لا یې وروستی کول نه شي. «له لېږلو مخکې کتنه» ښيي چې څه دی او چېرته سمېږي.",
  "setup.saveFailed": "پروژه خوندي نه شوه. هغه څه چې تاسو لیکلي له منځه نه دي تللي: خپله اړیکه وګورئ او بیا «خوندي کړئ» کېکاږئ.",
};

/** Home: what is waiting on a person, in three groups (C1). */
export const hbEn = {
  "home.b.title": "Waiting on you",
  "home.b.none": "Nothing is waiting on you.",
  "home.b.approve": "Approve",
  "home.b.fix": "Fix",
  "home.b.due": "Due",
  "home.b.blocks": "Blocks the report:",
  "home.b.now": "Now",
  "home.b.reportDue": "{report} report: have it ready by {date}",
  "home.b.reviewDue": "{review} closes on {date}",
  "home.b.days": "{n} days",
  "home.b.today": "Today",
  "home.b.late": "{n} days late",
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

export const hbFa: Partial<Record<keyof typeof hbEn, string>> = {
  "home.b.title": "منتظر شما",
  "home.b.none": "چیزی منتظر شما نیست.",
  "home.b.approve": "تأیید",
  "home.b.fix": "اصلاح",
  "home.b.due": "موعددار",
  "home.b.blocks": "جلوی گزارش را می‌گیرد:",
  "home.b.now": "اکنون",
  "home.b.reportDue": "گزارش {report}: تا {date} آماده باشد",
  "home.b.reviewDue": "{review} در {date} بسته می‌شود",
  "home.b.days": "{n} روز",
  "home.b.today": "امروز",
  "home.b.late": "{n} روز دیر",
};

export const hbPs: Partial<Record<keyof typeof hbEn, string>> = {
  "home.b.title": "ستاسو په تمه",
  "home.b.none": "هېڅ شی ستاسو په تمه نه دی.",
  "home.b.approve": "تایید",
  "home.b.fix": "سمول",
  "home.b.due": "نېټه لرونکي",
  "home.b.blocks": "راپور دروي:",
  "home.b.now": "اوس",
  "home.b.reportDue": "د {report} راپور: تر {date} پورې چمتو وي",
  "home.b.reviewDue": "{review} په {date} تړل کېږي",
  "home.b.days": "{n} ورځې",
  "home.b.today": "نن",
  "home.b.late": "{n} ورځې ناوخته",
};

/** Progress: one row per target (C3). */
export const prEn = {
  "prog.title": "Targets in {year}",
  "prog.target": "Target",
  "prog.result": "Result so far",
  "prog.w.on_track": "On track",
  "prog.w.behind": "Behind",
  "prog.w.no_data": "No data",
  "prog.d.met": "target met",
  "prog.d.notDue": "not due yet",
  "prog.d.dueNow": "due this quarter",
  "prog.d.notPlanned": "not in this year's workplan",
  "prog.d.delayed": "delayed",
  "prog.d.notDone": "not done",
  "prog.last": "Last accepted result: {date}",
  "prog.noLast": "No accepted result yet",
  "prog.open": "Tap a row to see the records and proof behind it.",
};

export const prEs: Partial<Record<keyof typeof prEn, string>> = {
  "prog.title": "Metas en {year}",
  "prog.target": "Meta",
  "prog.result": "Resultado hasta ahora",
  "prog.w.on_track": "En marcha",
  "prog.w.behind": "Atrasada",
  "prog.w.no_data": "Sin datos",
  "prog.d.met": "meta cumplida",
  "prog.d.notDue": "todavía no toca",
  "prog.d.dueNow": "toca este trimestre",
  "prog.d.notPlanned": "no está en el plan de trabajo de este año",
  "prog.d.delayed": "con retraso",
  "prog.d.notDone": "no se hizo",
  "prog.last": "Último resultado aceptado: {date}",
  "prog.noLast": "Todavía no hay un resultado aceptado",
  "prog.open": "Toca una fila para ver los registros y las pruebas.",
};

export const prFa: Partial<Record<keyof typeof prEn, string>> = {
  "prog.title": "هدف‌ها در {year}",
  "prog.target": "هدف",
  "prog.result": "نتیجه تا حالا",
  "prog.w.on_track": "در مسیر",
  "prog.w.behind": "عقب‌مانده",
  "prog.w.no_data": "بدون داده",
  "prog.d.met": "هدف پوره شده",
  "prog.d.notDue": "هنوز وقتش نرسیده",
  "prog.d.dueNow": "وقتش همین ربع است",
  "prog.d.notPlanned": "در پلان کاری امسال نیست",
  "prog.d.delayed": "با تأخیر",
  "prog.d.notDone": "انجام نشده",
  "prog.last": "آخرین نتیجهٔ پذیرفته‌شده: {date}",
  "prog.noLast": "هنوز نتیجهٔ پذیرفته‌شده‌ای نیست",
  "prog.open": "روی یک ردیف بزنید تا ثبت‌ها و مدرک‌های آن را ببینید.",
};

export const prPs: Partial<Record<keyof typeof prEn, string>> = {
  "prog.title": "په {year} کې هدفونه",
  "prog.target": "هدف",
  "prog.result": "تر اوسه پایله",
  "prog.w.on_track": "په لاره",
  "prog.w.behind": "وروسته پاتې",
  "prog.w.no_data": "معلومات نشته",
  "prog.d.met": "هدف پوره شوی",
  "prog.d.notDue": "لا یې وخت نه دی رارسېدلی",
  "prog.d.dueNow": "وخت یې همدا ربع دی",
  "prog.d.notPlanned": "د سږ کال په کاري پلان کې نشته",
  "prog.d.delayed": "ځنډېدلی",
  "prog.d.notDone": "نه دی ترسره شوی",
  "prog.last": "وروستۍ منل شوې پایله: {date}",
  "prog.noLast": "لا منل شوې پایله نشته",
  "prog.open": "په یوه کرښه کېکاږئ چې ثبتونه او ثبوتونه یې وګورئ.",
};

/** Project manager's path and the short Home for field staff who only use KoboCollect (C2). */
export const pmEn = {
  "pf.clearNext": "Nothing blocks this report. Open it, read it through, then mark it final.",
  "home.kobo.title": "Your data comes in through KoboCollect",
  "home.kobo.body": "Keep filling in the forms on your phone as you do now. You do not need to enter anything here. What is sent shows below after the next sync, and MEL then checks it.",
  "home.kobo.recent": "Latest submissions received for this project",
  "home.kobo.notYours": "The app cannot yet tell which submissions are yours, so this list is the whole project's.",
  "home.kobo.none": "No submissions have arrived yet. If you have sent some, they show here after the next sync.",
  "home.kobo.synced": "Last synced {date}",
  "home.kobo.neverSynced": "Not synced yet",
  "home.kobo.pending": "Waiting for MEL",
  "home.kobo.accepted": "Counted",
  "home.kobo.queried": "MEL has a question",
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

export const pmFa: Partial<Record<keyof typeof pmEn, string>> = {
  "pf.clearNext": "چیزی جلوی این گزارش را نمی‌گیرد. آن را باز کنید، کامل بخوانید و سپس نهایی کنید.",
  "home.kobo.title": "داده‌های شما از راه KoboCollect می‌آید",
  "home.kobo.body": "مثل همیشه فورمه‌ها را در تلفون خود پر کنید. لازم نیست اینجا چیزی وارد کنید. آنچه فرستاده می‌شود پس از همگام‌سازی بعدی در پایین دیده می‌شود و سپس MEL آن را بررسی می‌کند.",
  "home.kobo.recent": "آخرین فورمه‌های رسیده برای این پروژه",
  "home.kobo.notYours": "برنامه هنوز نمی‌تواند بداند کدام فورمه‌ها از شماست، پس این فهرست از تمام پروژه است.",
  "home.kobo.none": "هنوز فورمه‌ای نرسیده است. اگر فرستاده‌اید، پس از همگام‌سازی بعدی اینجا دیده می‌شود.",
  "home.kobo.synced": "آخرین همگام‌سازی: {date}",
  "home.kobo.neverSynced": "هنوز همگام نشده",
  "home.kobo.pending": "منتظر MEL",
  "home.kobo.accepted": "شمرده شد",
  "home.kobo.queried": "MEL پرسشی دارد",
};

export const pmPs: Partial<Record<keyof typeof pmEn, string>> = {
  "pf.clearNext": "هېڅ شی دا راپور نه دروي. خلاص یې کړئ، ټول یې ولولئ او بیا یې وروستی کړئ.",
  "home.kobo.title": "ستاسو معلومات د KoboCollect له لارې راځي",
  "home.kobo.body": "لکه د تل په څېر په خپل تلیفون کې فورمې ډکې کړئ. دلته د څه داخلولو اړتیا نشته. څه چې لېږل کېږي له راتلونکي همغږۍ وروسته لاندې ښکاري او بیا یې MEL ګوري.",
  "home.kobo.recent": "د دې پروژې لپاره وروستۍ رارسېدلې فورمې",
  "home.kobo.notYours": "اپلیکیشن لا نه شي پوهېدلی چې کومې فورمې ستاسو دي، نو دا لېست د ټولې پروژې دی.",
  "home.kobo.none": "لا هېڅ فورمه نه ده رارسېدلې. که مو لېږلې وي، له راتلونکي همغږۍ وروسته به دلته ښکاره شي.",
  "home.kobo.synced": "وروستۍ همغږي: {date}",
  "home.kobo.neverSynced": "لا نه ده همغږې شوې",
  "home.kobo.pending": "د MEL په تمه",
  "home.kobo.accepted": "وشمېرل شوه",
  "home.kobo.queried": "MEL پوښتنه لري",
};

/** Health page: the nightly KoboToolbox reconcile (B4). */
export const hkEn = {
  "health.kobo.title": "KoboToolbox nightly check",
  "health.kobo.help": "Each night the app reads every connected project's forms again, to catch answers edited or deleted in KoboToolbox after they first arrived. An accepted result is never changed by this: it is flagged for MEL.",
  "health.kobo.none": "No run in the last week. It starts once the scheduled job is live and a project is connected to KoboToolbox.",
  "health.kobo.same": "{fetched} submissions checked: nothing had changed.",
  "health.kobo.changed": "{fetched} submissions checked: {added} new, {updated} edited, {removed} deleted in KoboToolbox.",
  "health.kobo.flagged": "Accepted results changed in KoboToolbox and flagged for MEL: {n}.",
  "health.kobo.failed": "Did not run: {error}",
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

export const hkFa: Partial<Record<keyof typeof hkEn, string>> = {
  "health.kobo.title": "بررسی شبانهٔ KoboToolbox",
  "health.kobo.help": "هر شب برنامه فورمه‌های هر پروژهٔ وصل‌شده را دوباره می‌خواند تا پاسخ‌هایی را که پس از رسیدن در KoboToolbox ویرایش یا حذف شده پیدا کند. این کار هرگز یک نتیجهٔ پذیرفته‌شده را تغییر نمی‌دهد: آن را برای MEL نشانی می‌کند.",
  "health.kobo.none": "در هفتهٔ گذشته بررسی‌ای انجام نشده است. وقتی کار زمان‌بندی‌شده فعال شود و پروژه‌ای به KoboToolbox وصل باشد آغاز می‌شود.",
  "health.kobo.same": "{fetched} فورمه بررسی شد: چیزی تغییر نکرده بود.",
  "health.kobo.changed": "{fetched} فورمه بررسی شد: {added} نو، {updated} ویرایش‌شده، {removed} حذف‌شده در KoboToolbox.",
  "health.kobo.flagged": "نتیجه‌های پذیرفته‌شده که در KoboToolbox تغییر کرده و برای MEL نشانی شده: {n}.",
  "health.kobo.failed": "اجرا نشد: {error}",
};

export const hkPs: Partial<Record<keyof typeof hkEn, string>> = {
  "health.kobo.title": "د KoboToolbox شپنۍ کتنه",
  "health.kobo.help": "هره شپه اپلیکیشن د هرې نښلول شوې پروژې فورمې بیا لولي، څو هغه ځوابونه ومومي چې له رارسېدو وروسته په KoboToolbox کې سم شوي یا ړنګ شوي. دا کار هېڅکله منل شوې پایله نه بدلوي: د MEL لپاره یې په نښه کوي.",
  "health.kobo.none": "په تېره اونۍ کې هېڅ کتنه نه ده شوې. هغه وخت پیلېږي چې مهالوېش شوی کار فعال شي او یوه پروژه له KoboToolbox سره ونښلول شي.",
  "health.kobo.same": "{fetched} فورمې وکتل شوې: هېڅ شی نه و بدل شوی.",
  "health.kobo.changed": "{fetched} فورمې وکتل شوې: {added} نوې، {updated} سمې شوې، {removed} په KoboToolbox کې ړنګې شوې.",
  "health.kobo.flagged": "منل شوې پایلې چې په KoboToolbox کې بدلې شوې او د MEL لپاره په نښه شوې: {n}.",
  "health.kobo.failed": "ونه چلېده: {error}",
};
