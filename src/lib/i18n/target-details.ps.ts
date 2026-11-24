/** Pashto for ./target-details.ts, in its own module so English pages do not download it. */

import type { tdEn } from "./target-details";

export const tdPs: Partial<Record<keyof typeof tdEn, string>> = {
  "td.title": "د هدفونو جزئیات",
  "td.intro": "د هر هدف په اړه شپږ معلومات چې راپورونه او کتنې پرې ولاړې دي. د پلان تاییدوونکی یې ټاکي او هر بدلون د پلټنې په ثبت کې راځي.",
  "td.readOnly": "تاسو دا لوستلی شئ. د پلان تاییدوونکی یې بدلوي.",
  "td.empty": "دا پروژه لا هدفونه نه لري. د پروژې په تنظیم کې یې ورزیات کړئ.",
  "td.demo": "هغه پروژه وټاکئ چې په ډیټابیس کې خوندي ده.",
  "td.baseline": "بنسټیز رقم",
  "td.baseline.help": "د پروژې له پیل مخکې رقم. که نشته، تش یې پرېږدئ.",
  "td.baseline.bad": "رقم له ټکي سره او تر دوو اعشاري رقمونو پورې ولیکئ، لکه 1250.5. کامه مه لیکئ.",
  "td.breakdown": "راپور په توپیر",
  "td.by.sex": "ښځې او نارینه",
  "td.by.province": "ولایت",
  "td.by.district": "ولسوالي",
  "td.breakdown.help": "هغه پایله چې له دې څخه یو ونه لري د MEL لپاره نښه کېږي.",
  "td.breakdown.other": "دا هم ساتل کېږي: {list}",
  "td.verification": "د ثبوت اسناد",
  "td.verification.help": "هغه څه چې پایله ثابتوي، لکه د حاضرۍ پاڼې یا د ساحې د تصدیق راپور.",
  "td.budgetRef": "د بودجې هغه قلم چې لګښت یې ورکوي",
  "td.budgetRef.help": "د بودجې پاڼه او ربعوار راپور د دې قلم لګښت د هدف تر څنګ ښيي.",
  "td.workplanCode": "د کاري پلان هغه ګام چې دا ترسره کوي",
  "td.workplanCode.help": "راپور ته دا توان ورکوي چې ځنډېدلی کار له هغه کار څخه بېل کړي چې د وروستۍ ربع لپاره پلان شوی.",
  "td.none": "نه دی ټاکل شوی",
  "td.inQpr": "د تمویلوونکي په ربعوار جدول کې",
  "td.inQpr.help": "که هدف یوازې د نورو راپورونو لپاره څارل کېږي، نښه لرې کړئ.",
  "td.baselineMissing": "هغه بنسټیز رقمونه چې په — نښه شوي ثبت شوي نه دي. دلته یې ورزیات کړئ:",
  "td.save": "خوندي کړئ",
  "td.saved": "خوندي شو.",
};
