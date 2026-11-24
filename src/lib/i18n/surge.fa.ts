/** Dari for ./surge.ts, in its own module so English pages do not download it. */

import type { hbEn, hkEn, pmEn, prEn, sgEn } from "./surge";

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

export const hbFa: Partial<Record<keyof typeof hbEn, string>> = {
  "home.b.title": "منتظر شما",
  "home.b.none": "چیزی منتظر شما نیست.",
  "home.b.approve": "تأیید",
  "home.b.fix": "اصلاح",
  "home.b.due": "موعددار",
  "home.b.blocks": "جلوی گزارش را می‌گیرد:",
  "home.b.now": "اکنون",
  "home.b.reportDue": "گزارش {report}: تا {date} آماده باشد",
  "home.b.reviewDue": "{review} در {date} بسته می‌شود",
  "home.b.days": "{n} روز",
  "home.b.today": "امروز",
  "home.b.late": "{n} روز دیر",
};

export const prFa: Partial<Record<keyof typeof prEn, string>> = {
  "prog.title": "هدف‌ها در {year}",
  "prog.target": "هدف",
  "prog.result": "نتیجه تا حالا",
  "prog.w.done": "انجام شده",
  "prog.w.on_track": "در مسیر",
  "prog.w.not_started": "شروع نشده",
  "prog.w.behind": "عقب‌مانده",
  "prog.w.no_data": "بدون داده",
  "prog.d.notDue": "هنوز وقتش نرسیده",
  "prog.d.dueNow": "وقتش همین ربع است",
  "prog.d.notPlanned": "در پلان کاری امسال نیست",
  "prog.d.delayed": "با تأخیر",
  "prog.d.notDone": "انجام نشده",
  "prog.last": "آخرین نتیجهٔ پذیرفته‌شده: {date}",
  "prog.noLast": "هنوز نتیجهٔ پذیرفته‌شده‌ای نیست",
  "prog.open": "روی یک ردیف بزنید تا ثبت‌ها و مدرک‌های آن را ببینید.",
};

export const pmFa: Partial<Record<keyof typeof pmEn, string>> = {
  "pf.clearNext": "چیزی جلوی این گزارش را نمی‌گیرد. آن را باز کنید، کامل بخوانید و سپس نهایی کنید.",
  "home.kobo.title": "داده‌های شما از راه KoboCollect می‌آید",
  "home.kobo.body": "مثل همیشه فورمه‌ها را در تلفون خود پر کنید. لازم نیست اینجا چیزی وارد کنید. آنچه فرستاده می‌شود پس از همگام‌سازی بعدی در پایین دیده می‌شود و سپس MEL آن را بررسی می‌کند.",
  "home.kobo.recent": "آخرین فورمه‌های رسیده برای این پروژه",
  "home.kobo.notYours": "برنامه هنوز نمی‌تواند بداند کدام فورمه‌ها از شماست، پس این فهرست از تمام پروژه است.",
  "home.kobo.none": "هنوز فورمه‌ای نرسیده است. اگر فرستاده‌اید، پس از همگام‌سازی بعدی اینجا دیده می‌شود.",
  "home.kobo.synced": "آخرین همگام‌سازی: {date}",
  "home.kobo.neverSynced": "هنوز همگام نشده",
  "home.kobo.pending": "منتظر MEL",
  "home.kobo.accepted": "شمرده شد",
  "home.kobo.queried": "MEL پرسشی دارد",
};

export const hkFa: Partial<Record<keyof typeof hkEn, string>> = {
  "health.kobo.title": "بررسی شبانهٔ KoboToolbox",
  "health.kobo.help": "هر شب برنامه فورمه‌های هر پروژهٔ وصل‌شده را دوباره می‌خواند تا پاسخ‌هایی را که پس از رسیدن در KoboToolbox ویرایش یا حذف شده پیدا کند. این کار هرگز یک نتیجهٔ پذیرفته‌شده را تغییر نمی‌دهد: آن را برای MEL نشانی می‌کند.",
  "health.kobo.none": "در هفتهٔ گذشته بررسی‌ای انجام نشده است. وقتی کار زمان‌بندی‌شده فعال شود و پروژه‌ای به KoboToolbox وصل باشد آغاز می‌شود.",
  "health.kobo.same": "{fetched} فورمه بررسی شد: چیزی تغییر نکرده بود.",
  "health.kobo.changed": "{fetched} فورمه بررسی شد: {added} نو، {updated} ویرایش‌شده، {removed} حذف‌شده در KoboToolbox.",
  "health.kobo.flagged": "نتیجه‌های پذیرفته‌شده که در KoboToolbox تغییر کرده و برای MEL نشانی شده: {n}.",
  "health.kobo.failed": "اجرا نشد: {error}",
};
