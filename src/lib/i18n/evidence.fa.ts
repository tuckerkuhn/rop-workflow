/** Dari for ./evidence.ts, in its own module so English pages do not download it. */

import type { evEn } from "./evidence";

type Keys = keyof typeof evEn;

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
