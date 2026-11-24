/** Dari for ./kobo-suggest.ts, in its own module so English pages do not download it. */

import type { ksEn } from "./kobo-suggest";

type Keys = keyof typeof ksEn;

export const ksFa: Partial<Record<Keys, string>> = {
  "ks.suggest": "پیشنهاد تطبیق",
  "ks.suggesting": "در حال بررسی فورم‌ها… (تا یک دقیقه)",
  "ks.help": "Claude سؤال‌های فورم‌ها را (نه پاسخ‌ها را) می‌بیند و برای هر هدف یکی پیشنهاد می‌کند. تا پیشنهادی را نپذیرید و ذخیره نکنید، چیزی تغییر نمی‌کند.",
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
