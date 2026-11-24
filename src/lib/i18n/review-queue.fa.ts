/** Dari for ./review-queue.ts, in its own module so English pages do not download it. */

import type { rqEn } from "./review-queue";

type Keys = keyof typeof rqEn;

export const rqFa: Partial<Record<Keys, string>> = {
  "rq.line": "{clean} بدون هشدار، {flagged} با هشدار.",
  "rq.accept": "پذیرفتن {n}",
  "rq.review": "بررسی {n}",
  "rq.confirm": "این {n} نتیجه پذیرفته شوند؟ هر کدام از این پس در پیشرفت و گزارش شمرده می‌شود. نتایج دارای هشدار یکی‌یکی بررسی می‌شوند.",
  "rq.accepted": "{n} نتیجه پذیرفته شد.",
  "rq.of": "{k} از {n} دارای هشدار",
  "rq.more": "+{n} مورد دیگر",
  "rq.less": "کمتر",
  "rq.acceptOne": "پذیرفتن",
  "rq.query": "پرسش",
  "rq.what": "چه چیزی باید اصلاح شود؟",
  "rq.send": "فرستادن پرسش",
  "rq.cancel": "لغو",
  "rq.back": "بازگشت به فهرست",
  "rq.done": "دربارهٔ همهٔ نتایج دارای هشدار تصمیم گرفته شد.",
};
