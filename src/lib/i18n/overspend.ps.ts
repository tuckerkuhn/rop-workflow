/** Pashto for ./overspend.ts, in its own module so English pages do not download it. */

import type { osEn } from "./overspend";

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
