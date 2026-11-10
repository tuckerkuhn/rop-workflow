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
