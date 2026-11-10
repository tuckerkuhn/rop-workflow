/**
 * The reason a budget line is over budget, chosen from a list (lib/overspend.ts). English is the
 * source; Spanish, Dari and Pashto are drafts that need review by a native speaker before field use.
 * The report itself prints the English (it goes to the donor in English).
 */

export const osEn = {
  "os.label": "Why is this line over budget?",
  "os.choose": "Choose a reason",
  "os.reason.price": "Prices or the exchange rate came in higher than budgeted",
  "os.reason.early": "Work brought forward from a later quarter (timing only)",
  "os.reason.realign": "A realignment the donor has already approved",
  "os.reason.pending": "A realignment requested and waiting for the donor",
  "os.reason.coding": "A coding error that Finance will move to the right line",
  "os.reason.other": "Other",
  "os.note": "Note (optional): a date, an amount or the donor's letter",
  "os.noteOther": "Say what the reason is",
  "os.short": "Write at least 10 characters.",
  "os.save": "Save the reason",
  "os.clear": "Clear the reason",
  "os.saved": "Saved. It goes in each quarterly report while this line is over budget.",
  "os.who": "The MEL owner or a programme lead gives the reason. It goes in each quarterly report while this line is over budget.",
  "os.reads": "Reason given:",
  "os.line": "{code}: {spent} spent of {budget} {currency} ({pct}%).",
};

export const osEs: Record<keyof typeof osEn, string> = {
  "os.label": "¿Por qué esta línea está por encima del presupuesto?",
  "os.choose": "Elige un motivo",
  "os.reason.price": "Los precios o el tipo de cambio fueron más altos de lo presupuestado",
  "os.reason.early": "Trabajo adelantado de un trimestre posterior (solo calendario)",
  "os.reason.realign": "Una reasignación que el donante ya aprobó",
  "os.reason.pending": "Una reasignación solicitada, en espera del donante",
  "os.reason.coding": "Un error de codificación que Finanzas moverá a la línea correcta",
  "os.reason.other": "Otro",
  "os.note": "Nota (opcional): una fecha, un monto o la carta del donante",
  "os.noteOther": "Di cuál es el motivo",
  "os.short": "Escribe al menos 10 caracteres.",
  "os.save": "Guardar el motivo",
  "os.clear": "Borrar el motivo",
  "os.saved": "Guardado. Aparece en cada informe trimestral mientras esta línea esté por encima del presupuesto.",
  "os.who": "Quien es responsable de MEL o líder de programa da el motivo. Aparece en cada informe trimestral mientras esta línea esté por encima del presupuesto.",
  "os.reads": "Motivo dado:",
  "os.line": "{code}: {spent} gastado de {budget} {currency} ({pct}%).",
};

export const osFa: Record<keyof typeof osEn, string> = {
  "os.label": "چرا این سطر از بودجه بیشتر مصرف شده است؟",
  "os.choose": "یک دلیل انتخاب کنید",
  "os.reason.price": "قیمت‌ها یا نرخ اسعار بیشتر از بودجه بود",
  "os.reason.early": "کار از یک ربع بعدی پیش‌تر انجام شد (فقط زمان‌بندی)",
  "os.reason.realign": "جابجایی بودجه که تمویل‌کننده قبلاً تأیید کرده است",
  "os.reason.pending": "جابجایی بودجه درخواست شده و منتظر تأیید تمویل‌کننده است",
  "os.reason.coding": "اشتباه کدگذاری که بخش مالی آن را به سطر درست منتقل می‌کند",
  "os.reason.other": "دیگر",
  "os.note": "یادداشت (اختیاری): یک تاریخ، یک مبلغ یا نامهٔ تمویل‌کننده",
  "os.noteOther": "دلیل را بنویسید",
  "os.short": "حداقل ۱۰ حرف بنویسید.",
  "os.save": "ذخیرهٔ دلیل",
  "os.clear": "پاک کردن دلیل",
  "os.saved": "ذخیره شد. تا وقتی این سطر از بودجه بیشتر است، در هر گزارش ربعوار می‌آید.",
  "os.who": "مسئول MEL یا رهبر برنامه دلیل را می‌دهد. تا وقتی این سطر از بودجه بیشتر است، در هر گزارش ربعوار می‌آید.",
  "os.reads": "دلیل داده شده:",
  "os.line": "{code}: {spent} مصرف از {budget} {currency} ({pct}٪).",
};

export const osPs: Record<keyof typeof osEn, string> = {
  "os.label": "ولې دا کرښه له بودجې ډېره لګول شوې ده؟",
  "os.choose": "یو دلیل وټاکئ",
  "os.reason.price": "بیې یا د اسعارو نرخ له بودجې لوړ و",
  "os.reason.early": "کار له وروستي ربع څخه مخکې ترسره شو (یوازې مهال‌وېش)",
  "os.reason.realign": "د بودجې بیا وېش چې تمویلوونکي مخکې منظور کړی",
  "os.reason.pending": "د بودجې بیا وېش غوښتل شوی او د تمویلوونکي منظورۍ ته انتظار دی",
  "os.reason.coding": "د کوډ کولو تېروتنه چې مالي برخه به یې سمې کرښې ته یوسي",
  "os.reason.other": "نور",
  "os.note": "یادښت (اختیاري): یوه نېټه، یوه اندازه یا د تمویلوونکي لیک",
  "os.noteOther": "دلیل ولیکئ",
  "os.short": "لږ تر لږه ۱۰ توري ولیکئ.",
  "os.save": "دلیل خوندي کړئ",
  "os.clear": "دلیل پاک کړئ",
  "os.saved": "خوندي شو. تر هغه چې دا کرښه له بودجې ډېره وي، په هر درې‌میاشتني راپور کې راځي.",
  "os.who": "د MEL مسؤل یا د پروګرام مشر دلیل ورکوي. تر هغه چې دا کرښه له بودجې ډېره وي، په هر درې‌میاشتني راپور کې راځي.",
  "os.reads": "ورکړل شوی دلیل:",
  "os.line": "{code}: {spent} لګول شوي له {budget} {currency} ({pct}٪).",
};
