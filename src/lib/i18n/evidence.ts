/**
 * The proof panel's text (lib/evidence). English is the source; Dari, Pashto and Spanish are
 * drafts that need review by a native speaker before field use. A missing string falls back to English.
 */

export const evEn = {
  "ev.title": "Behind this figure",
  "ev.summary": "Accepted results: {count} · total {n} {unit}",
  "ev.period": "{from} to {to}",
  "ev.since": "Up to {to}",
  "ev.recorded": "Recorded by {who}",
  "ev.accepted": "Accepted by {who}, {date}",
  "ev.notAccepted": "Not accepted",
  "ev.noProof": "No proof yet",
  "ev.noFile": "No file: {why}",
  "ev.kobo": "KoboToolbox submission {id}",
  "ev.open": "Open in Results and proof",
  "ev.close": "Close",
  "ev.loading": "Loading…",
  "ev.none": "No accepted results behind this figure.",
  "ev.show": "See the records and proof behind {n}",
  "ev.money.title": "Where the spending figures come from",
  "ev.money.hint":
    "Spending comes from Finance's budget against actual workbook, as imported, summed by budget line.",
  "ev.money.file": "{file}, imported by {who} on {date}",
  "ev.money.months": "Months {from} to {to} · {lines} lines · {currency}",
  "ev.money.none": "No spending imported from Finance yet.",
  "ev.money.sharepoint": "Open in SharePoint",
  "ev.money.show": "Where this comes from",
};

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

export const evFa: Partial<Record<Keys, string>> = {
  "ev.title": "پشت این رقم",
  "ev.summary": "نتایج پذیرفته‌شده: {count} · مجموع {n} {unit}",
  "ev.period": "از {from} تا {to}",
  "ev.since": "تا {to}",
  "ev.recorded": "ثبت‌شده توسط {who}",
  "ev.accepted": "پذیرفته‌شده توسط {who}، {date}",
  "ev.notAccepted": "پذیرفته نشده",
  "ev.noProof": "هنوز سندی نیست",
  "ev.noFile": "بدون فایل: {why}",
  "ev.kobo": "ارسال KoboToolbox شماره {id}",
  "ev.open": "باز کردن در نتایج و اسناد",
  "ev.close": "بستن",
  "ev.loading": "در حال بارگذاری…",
  "ev.none": "هیچ نتیجهٔ پذیرفته‌شده‌ای پشت این رقم نیست.",
  "ev.show": "دیدن ثبت‌ها و اسناد پشت {n}",
  "ev.money.title": "ارقام مصرف از کجا می‌آید",
  "ev.money.hint":
    "مصرف از فایل بودجه در برابر مصرف واقعی بخش مالی می‌آید، همان‌طور که وارد شده، به تفکیک خط بودجه.",
  "ev.money.file": "{file}، واردشده توسط {who} در {date}",
  "ev.money.months": "ماه‌های {from} تا {to} · {lines} خط · {currency}",
  "ev.money.none": "هنوز مصرفی از بخش مالی وارد نشده است.",
  "ev.money.sharepoint": "باز کردن در SharePoint",
  "ev.money.show": "از کجا می‌آید",
};

export const evPs: Partial<Record<Keys, string>> = {
  "ev.title": "د دې شمېرې تر شا",
  "ev.summary": "منل شوې پایلې: {count} · ټول {n} {unit}",
  "ev.period": "له {from} څخه تر {to}",
  "ev.since": "تر {to} پورې",
  "ev.recorded": "ثبت کوونکی: {who}",
  "ev.accepted": "منونکی: {who}، {date}",
  "ev.notAccepted": "نه دی منل شوی",
  "ev.noProof": "لا سند نشته",
  "ev.noFile": "فایل نشته: {why}",
  "ev.kobo": "د KoboToolbox لېږنه {id}",
  "ev.open": "په پایلو او اسنادو کې پرانیزئ",
  "ev.close": "بندول",
  "ev.loading": "پورته کېږي…",
  "ev.none": "د دې شمېرې تر شا هېڅ منل شوې پایله نشته.",
  "ev.show": "د {n} تر شا ثبتونه او اسناد وګورئ",
  "ev.money.title": "د لګښت شمېرې له کومه راځي",
  "ev.money.hint":
    "لګښت د مالي څانګې د بودیجې او اصلي لګښت له فایل څخه راځي، لکه څنګه چې راوړل شوی، د بودیجې د کرښې له مخې.",
  "ev.money.file": "{file}، راوړونکی {who} په {date}",
  "ev.money.months": "میاشتې {from} تر {to} · {lines} کرښې · {currency}",
  "ev.money.none": "لا د مالي څانګې څخه لګښت نه دی راوړل شوی.",
  "ev.money.sharepoint": "په SharePoint کې پرانیزئ",
  "ev.money.show": "له کومه راځي",
};
