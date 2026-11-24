/** Pashto for ./agreement.ts, in its own module so English pages do not download it. */

import type { agEn } from "./agreement";

type Keys = keyof typeof agEn;

export const agPs: Partial<Record<Keys, string>> = {
  "ag.title": "له اسنادو پیل",
  "ag.help": "لاسلیک شوی تړون، منطقي چوکاټ یا د پایلو چوکاټ، او بودیجه پورته کړئ (PDF، Word یا Excel). یو یې هم بس دی. Claude هره برخه د سرچینې سره وړاندیز کوي؛ تاسو هره برخه له خوندي کولو مخکې تاییدوئ.",
  "ag.helpRunning": "لاسلیک شوی تړون پورته کړئ (او بودیجه، که پروژه لا نه لري). Claude د راپور وروستۍ نېټې او د مرسته کوونکي قواعد د سرچینې سره وړاندیز کوي؛ تاسو یې تاییدوئ.",
  "ag.slot.agreement": "تړون",
  "ag.slot.logframe": "منطقي چوکاټ یا د پایلو چوکاټ",
  "ag.slot.budget": "بودیجه",
  "ag.choose": "فایل وټاکئ",
  "ag.read": "اسناد ولولئ",
  "ag.reading": "لوستل روان دي… (تر ۲ دقیقو)",
  "ag.partFailed": "{part} ونه لوستل شو: {error}",
  "ag.done": "ولوستل شو. هر ګام وګورئ: تر څو تایید نه کړئ، هېڅ نه خوندي کېږي.",
  "ag.sources": "د هر ځواب سرچینه",
  "ag.budgetFrom": "له {file} وړاندیز شوی: کرښې وګورئ او خوندي یې کړئ، یا یې پرېږدئ.",
  "ag.deadlines.title": "د راپور وروستۍ نېټې",
  "ag.deadlines.help": "هغه راپورونه چې تړون یې غواړي، د پروژې په اوږدو کې د نېټو سره. هر یو چې وساتئ، په دندو کې د راپور وروستۍ نېټه کېږي.",
  "ag.deadlines.none": "د راپور هېڅ مکلفیت وړاندیز نه شو. تړون پورته کړئ، یا په دندو کې نېټې ور زیاتې کړئ.",
  "ag.deadlines.days": "د هرې دورې له پای {days} ورځې وروسته",
  "ag.deadlines.format": "بڼه: {format}",
  "ag.deadlines.save": "{n} نېټې دندو ته ور زیاتې کړئ",
  "ag.deadlines.saved": "{n} نېټې دندو ته ور زیاتې شوې.",
  "ag.rules.title": "د مرسته کوونکي قواعد",
  "ag.rules.help": "د تړون هغه قواعد چې اپ یې کتلی شي. هر یو چې وساتئ، په تنظیماتو، پالیسۍ کې د دې پروژې قاعده کېږي، د خپلې مادې سره.",
  "ag.rules.none": "هېڅ قاعده وړاندیز نه شوه. تړون پورته کړئ، یا یې په تنظیماتو، پالیسۍ کې وټاکئ.",
  "ag.rules.terms": "نور شرطونه",
  "ag.rules.termsHelp": "د ټیم لپاره د پالیسۍ په پاڼه کې لیکل کېږي؛ اپ یې نه کتي.",
  "ag.rules.save": "{n} قواعد او {m} شرطونه خوندي کړئ",
  "ag.rules.saved": "د پروژې په پالیسۍ کې خوندي شو.",
  "ag.questions": "د روښانه کولو لپاره",
  "ag.skip": "پرېښودل",
  "ag.keep": "ساتل",
  "ag.source": "سرچینه: {source}",
};
