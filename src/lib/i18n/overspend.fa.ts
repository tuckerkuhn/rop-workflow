/** Dari for ./overspend.ts, in its own module so English pages do not download it. */

import type { osEn } from "./overspend";

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
