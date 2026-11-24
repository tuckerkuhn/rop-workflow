/** Dari for ./sample.ts, in its own module so English pages do not download it. */

import type { spEn } from "./sample";

export const spFa: Record<keyof typeof spEn, string> = {
  "sample.banner": "پروژهٔ نمونه با معلومات ساختگی، برای دیدن یک گزارش تکمیل‌شده. اینجا چیزی تغییر داده نمی‌شود.",
  "sample.see": "دیدن یک گزارش تکمیل‌شده",
  "sample.setUp": "پروژهٔ خود را تنظیم کنید",
  "sample.title": "پروژهٔ نمونه",
  "sample.help": "یک پروژهٔ تکمیل‌شده با معلومات ساختگی: اهداف، نتایج پذیرفته‌شده با اسناد، بودجه با مصارف و یک گزارش ربعوار نشرشده. همه می‌توانند آن را باز کنند؛ هیچ‌کس نمی‌تواند آن را تغییر دهد و در هیچ مجموعه‌ای حساب نمی‌شود.",
  "sample.shown": "برای همه نمایش داده می‌شود",
  "sample.hidden": "پنهان",
  "sample.hide": "پنهان کردن",
  "sample.show": "دوباره نمایش دادن",
  "sample.reason": "چرا (با تغییر نگه داشته می‌شود)",
  "sample.since": "از {date}، توسط {who}: {reason}",
  "sample.adminOnly": "فقط مدیر سیستم آن را پنهان یا نمایان می‌کند.",
  "sample.history": "تغییرات قبلی",
  "sample.changed": "{date}: {state} توسط {who}. {reason}",
  "sample.stateHidden": "پنهان شد",
  "sample.stateShown": "نمایان شد",
  "sample.doneHidden": "پروژهٔ نمونه پنهان است",
  "sample.doneShown": "پروژهٔ نمونه نمایان است",
};
