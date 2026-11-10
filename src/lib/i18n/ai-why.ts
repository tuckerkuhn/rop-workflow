/**
 * Every flag and suggestion says why, what it looked at, and gives two actions (C6). English is the
 * source; Spanish, Dari and Pashto are drafts that need review by a native speaker before field
 * use. A missing string falls back to English.
 */

export const awEn = {
  "ai.why": "Why:",
  "ai.looked": "It looked at:",
  "ai.looks.dataChecks": "this target's other records, the women and men counts, the proof and the photo dates. These are fixed rules, not AI: the same record always gets the same flags.",
  "ai.looks.claimCheck": "the report's text, this quarter's accepted results and the weekly updates, with people's names replaced. AI flags; you decide.",
  "ai.looks.procurementCheck": "this purchase's record: the item, value, budget line, dates, supplier and signatures. AI flags; you decide.",
  "ai.looks.koboSuggest": "form names, question labels and answer choices. Never the answers people gave.",
  "cc.fix": "Fix the text",
  "cc.keep": "The text is right",
  "cc.fixing": "To fix. Marked by {name}.",
  "cc.kept": "Kept as written. Decided by {name}.",
  "cc.undo": "Change",
  "ks.decline": "Not this one",
  "ks.declined": "Left for you to map by hand",
};

export const awEs: Partial<Record<keyof typeof awEn, string>> = {
  "ai.why": "Por qué:",
  "ai.looked": "Qué revisó:",
  "ai.looks.dataChecks": "los otros registros de esta meta, las cifras de mujeres y hombres, las pruebas y las fechas de las fotos. Son reglas fijas, no IA: el mismo registro siempre recibe los mismos avisos.",
  "ai.looks.claimCheck": "el texto del informe, los resultados aceptados de este trimestre y las actualizaciones semanales, con los nombres de las personas reemplazados. La IA avisa; tú decides.",
  "ai.looks.procurementCheck": "el registro de esta compra: el artículo, el valor, la línea de presupuesto, las fechas, el proveedor y las firmas. La IA avisa; tú decides.",
  "ai.looks.koboSuggest": "los nombres de los formularios, las preguntas y las opciones de respuesta. Nunca las respuestas de las personas.",
  "cc.fix": "Corregir el texto",
  "cc.keep": "El texto está bien",
  "cc.fixing": "Por corregir. Marcado por {name}.",
  "cc.kept": "Se queda como está. Decidido por {name}.",
  "cc.undo": "Cambiar",
  "ks.decline": "Esta no",
  "ks.declined": "Queda para que la asignes a mano",
};

export const awFa: Partial<Record<keyof typeof awEn, string>> = {
  "ai.why": "چرا:",
  "ai.looked": "چه را دید:",
  "ai.looks.dataChecks": "ثبت‌های دیگر همین هدف، شمار زنان و مردان، مدرک‌ها و تاریخ عکس‌ها. این‌ها قاعده‌های ثابت است، نه هوش مصنوعی: یک ثبت همیشه همان هشدارها را می‌گیرد.",
  "ai.looks.claimCheck": "متن گزارش، نتیجه‌های پذیرفته‌شدهٔ این ربع و گزارش‌های هفته‌وار، با نام‌های افراد جایگزین‌شده. هوش مصنوعی هشدار می‌دهد؛ تصمیم با شماست.",
  "ai.looks.procurementCheck": "سابقهٔ این خرید: جنس، ارزش، ردیف بودجه، تاریخ‌ها، فروشنده و امضاها. هوش مصنوعی هشدار می‌دهد؛ تصمیم با شماست.",
  "ai.looks.koboSuggest": "نام فورمه‌ها، متن پرسش‌ها و گزینه‌های پاسخ. هرگز پاسخ‌هایی که مردم داده‌اند.",
  "cc.fix": "متن را اصلاح می‌کنم",
  "cc.keep": "متن درست است",
  "cc.fixing": "برای اصلاح. علامت‌گذاری: {name}.",
  "cc.kept": "همان‌طور که نوشته شده می‌ماند. تصمیم: {name}.",
  "cc.undo": "تغییر",
  "ks.decline": "این یکی نه",
  "ks.declined": "برای شما مانده تا با دست وصل کنید",
};

export const awPs: Partial<Record<keyof typeof awEn, string>> = {
  "ai.why": "ولې:",
  "ai.looked": "څه یې وکتل:",
  "ai.looks.dataChecks": "د همدې هدف نور ثبتونه، د ښځو او نارینه وو شمېر، ثبوتونه او د عکسونو نېټې. دا ټاکلي قواعد دي، مصنوعي ځیرکتیا نه ده: یو ثبت تل همغه خبرداري اخلي.",
  "ai.looks.claimCheck": "د راپور متن، د دې ربع منل شوې پایلې او اونیز راپورونه، د خلکو نومونه پکې بدل شوي. مصنوعي ځیرکتیا خبرداری ورکوي؛ پرېکړه ستاسو ده.",
  "ai.looks.procurementCheck": "د دې پېرود ریکارډ: جنس، ارزښت، د بودیجې کرښه، نېټې، عرضه کوونکی او لاسلیکونه. مصنوعي ځیرکتیا خبرداری ورکوي؛ پرېکړه ستاسو ده.",
  "ai.looks.koboSuggest": "د فورمو نومونه، د پوښتنو متن او د ځواب انتخابونه. هېڅکله هغه ځوابونه نه چې خلکو ورکړي.",
  "cc.fix": "متن سموم",
  "cc.keep": "متن سم دی",
  "cc.fixing": "د سمولو لپاره. نښه کوونکی: {name}.",
  "cc.kept": "لکه څنګه چې لیکل شوی پاتې کېږي. پرېکړه: {name}.",
  "cc.undo": "بدلول",
  "ks.decline": "دا یو نه",
  "ks.declined": "تاسو ته پاتې دی چې په لاس یې ونښلوئ",
};
