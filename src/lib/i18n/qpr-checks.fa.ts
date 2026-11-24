/** Dari for ./qpr-checks.ts, in its own module so English pages do not download it. */

import type { qcEn } from "./qpr-checks";

export const qcFa: Record<keyof typeof qcEn, string> = {
  "qc.pending": "{code}: {n} نتیجهٔ این ربع هنوز منتظر بررسی MEL است، بنابراین شمرده نمی‌شود.",
  "qc.queried": "{code}: MEL بر {n} نتیجهٔ این ربع سوال گذاشته است، بنابراین تا اصلاح نشود شمرده نمی‌شود.",
  "qc.noProof": "{code}: {n} نتیجهٔ این ربع مدرک ضمیمه ندارد{note}.",
  "qc.completedShort": "{code}: «تکمیل شده» نشانی شده، اما نتیجهٔ امسال {done} از هدف {target} {unit} است.",
  "qc.notImplemented": "{code}: «تطبیق نشده» نشانی شده، اما نتیجهٔ امسال {done} {unit} است.",
  "qc.commentPct": "{code}: تبصره {pcts}% می‌گوید، اما نتیجهٔ امسال {real}% هدف است.",
  "qc.commentStatus": "{code}: تبصره باید با وضعیت آن ({status}) شروع شود.",
  "qc.overBudget": "مصارف تا حال ({spent}) بیشتر از بودجه ({budget}) است.",
  "qc.quarterOverTotal": "مصارف این ربع بیشتر از تمام مصارف تا حال است.",
  "qc.noQuarterSpend": "مصارف این ربع درج نشده است: فایل بودجه و مصارف بخش مالی را وارد کنید، یا آن را در معلومات پروژه بنویسید.",
  "qc.lineOver": "خط بودجهٔ {code} مبلغ {spent} از {budget} {currency} ({pct}%) را مصرف کرده است: در معلومات پروژه بنویسید چرا از بودجه بیشتر است، یا تعدیل بودجه را بدهید.",
  "qc.missingMonths": "مصارف واردشده {months} را ندارد: آخرین فایل بخش مالی را وارد کنید.",
  "qc.typedSpend": "مصارف این ربع {typed} نوشته شده، اما فایل واردشدهٔ بخش مالی {imported} می‌گوید.",
  "qc.sectionEmpty": "{heading} هنوز نوشته نشده است.",
  "qc.sectionCopied": "{heading} از {from} کاپی شده است: ببینید که برای این ربع مناسب است.",
  "qc.activityText": "فعالیت {code} در این ربع نتیجه دارد، اما چیزی در مورد آن نوشته نشده است.",
  "qc.risks": "جدول خطرات خالی است.",
  "qc.grm": "ارقام شکایات (GRM) درج نشده است.",
};
