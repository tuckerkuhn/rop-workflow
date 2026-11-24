/** Pashto for ./evidence.ts, in its own module so English pages do not download it. */

import type { evEn } from "./evidence";

type Keys = keyof typeof evEn;

export const evPs: Partial<Record<Keys, string>> = {
  "ev.title": "د دې شمېرې تر شا",
  "ev.summary": "منل شوې پایلې: {count} · ټول {n} {unit}",
  "ev.period": "له {from} څخه تر {to}",
  "ev.since": "تر {to} پورې",
  "ev.recorded": "ثبت کوونکی: {who}",
  "ev.accepted": "منونکی: {who}، {date}",
  "ev.notAccepted": "نه دی منل شوی",
  "ev.noProof": "لا سند نشته",
  "ev.noFile": "فایل نشته: {why}",
  "ev.kobo": "د KoboToolbox لېږنه {id}",
  "ev.open": "په پایلو او اسنادو کې پرانیزئ",
  "ev.close": "بندول",
  "ev.loading": "پورته کېږي…",
  "ev.none": "د دې شمېرې تر شا هېڅ منل شوې پایله نشته.",
  "ev.show": "د {n} تر شا ثبتونه او اسناد وګورئ",
  "ev.money.title": "د لګښت شمېرې له کومه راځي",
  "ev.money.hint":
    "لګښت د مالي څانګې د بودیجې او اصلي لګښت له فایل څخه راځي، لکه څنګه چې راوړل شوی، د بودیجې د کرښې له مخې.",
  "ev.money.file": "{file}، راوړونکی {who} په {date}",
  "ev.money.months": "میاشتې {from} تر {to} · {lines} کرښې · {currency}",
  "ev.money.none": "لا د مالي څانګې څخه لګښت نه دی راوړل شوی.",
  "ev.money.sharepoint": "په SharePoint کې پرانیزئ",
  "ev.money.show": "له کومه راځي",
};
