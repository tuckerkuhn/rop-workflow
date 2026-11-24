/** Pashto for ./surge.ts, in its own module so English pages do not download it. */

import type { hbEn, hkEn, pmEn, prEn, sgEn } from "./surge";

export const sgPs: Partial<Record<keyof typeof sgEn, string>> = {
  "pf.uncheckedConfirm": "له لېږلو مخکې کتنه همدا اوس ونه شوه، نو اپلیکیشن نه پوهېږي چې کوم شی دا راپور دروي که نه. فایل به د «مسوده، نه ده کتل شوې» نښه ولري. بیا هم ښکته یې کړو؟",
  "pf.c.typedSpend": "د دې ربع لګښت په لاس {typed} لیکل شوی، خو د مالي څانګې فایل {imported} وایي. راپور به لیکل شوی رقم وښيي: هغه پاک کړئ چې د مالي څانګې رقم وکارول شي، یا یې وساتئ او د توپیر تشریح ته چمتو اوسئ.",
  "err.title": "دا پاڼه خلاصه نه شوه",
  "err.body": "هغه څه چې تاسو خوندي کړي له منځه نه دي تللي. خپله اړیکه وګورئ او بیا هڅه وکړئ. که بیا هم وشوه، مدیر ته ووایاست.",
  "err.retry": "بیا هڅه وکړئ",
  "err.home": "کور پاڼې ته ولاړ شئ",
  "load.wait": "راپورته کېږي…",
  "tasks.loadFailed": "په دې پروژه کې ستاسو کارونه رانه غلل، نو ښايي دا لېست بشپړ نه وي. خپله اړیکه وګورئ او بیا هڅه وکړئ.",
  "closeout.loadFailed": "بلونه رانه غلل، نو ښايي ځینې سندونه په دې لېست کې نه وي. خپله اړیکه وګورئ او پاڼه بیا خلاصه کړئ.",
  "field.saveFailed": "وروستی بدلون خوندي نه شو: {error} خپله اړیکه وګورئ او بدلون بیا وکړئ.",
  "report.loading": "راپور راپورته کېږي…",
  "report.blocked": "{n} ټکي دا راپور دروي، نو لا یې وروستی کول نه شي. «له لېږلو مخکې کتنه» هر یو او د سمولو ځای یې ښيي.",
  "report.blockedOne": "۱ ټکی دا راپور دروي، نو لا یې وروستی کول نه شي. «له لېږلو مخکې کتنه» ښيي چې څه دی او چېرته سمېږي.",
  "setup.saveFailed": "پروژه خوندي نه شوه. هغه څه چې تاسو لیکلي له منځه نه دي تللي: خپله اړیکه وګورئ او بیا «خوندي کړئ» کېکاږئ.",
};

export const hbPs: Partial<Record<keyof typeof hbEn, string>> = {
  "home.b.title": "ستاسو په تمه",
  "home.b.none": "هېڅ شی ستاسو په تمه نه دی.",
  "home.b.approve": "تایید",
  "home.b.fix": "سمول",
  "home.b.due": "نېټه لرونکي",
  "home.b.blocks": "راپور دروي:",
  "home.b.now": "اوس",
  "home.b.reportDue": "د {report} راپور: تر {date} پورې چمتو وي",
  "home.b.reviewDue": "{review} په {date} تړل کېږي",
  "home.b.days": "{n} ورځې",
  "home.b.today": "نن",
  "home.b.late": "{n} ورځې ناوخته",
};

export const prPs: Partial<Record<keyof typeof prEn, string>> = {
  "prog.title": "په {year} کې هدفونه",
  "prog.target": "هدف",
  "prog.result": "تر اوسه پایله",
  "prog.w.done": "بشپړ شوی",
  "prog.w.on_track": "په لاره",
  "prog.w.not_started": "نه دی پیل شوی",
  "prog.w.behind": "وروسته پاتې",
  "prog.w.no_data": "معلومات نشته",
  "prog.d.notDue": "لا یې وخت نه دی رارسېدلی",
  "prog.d.dueNow": "وخت یې همدا ربع دی",
  "prog.d.notPlanned": "د سږ کال په کاري پلان کې نشته",
  "prog.d.delayed": "ځنډېدلی",
  "prog.d.notDone": "نه دی ترسره شوی",
  "prog.last": "وروستۍ منل شوې پایله: {date}",
  "prog.noLast": "لا منل شوې پایله نشته",
  "prog.open": "په یوه کرښه کېکاږئ چې ثبتونه او ثبوتونه یې وګورئ.",
};

export const pmPs: Partial<Record<keyof typeof pmEn, string>> = {
  "pf.clearNext": "هېڅ شی دا راپور نه دروي. خلاص یې کړئ، ټول یې ولولئ او بیا یې وروستی کړئ.",
  "home.kobo.title": "ستاسو معلومات د KoboCollect له لارې راځي",
  "home.kobo.body": "لکه د تل په څېر په خپل تلیفون کې فورمې ډکې کړئ. دلته د څه داخلولو اړتیا نشته. څه چې لېږل کېږي له راتلونکي همغږۍ وروسته لاندې ښکاري او بیا یې MEL ګوري.",
  "home.kobo.recent": "د دې پروژې لپاره وروستۍ رارسېدلې فورمې",
  "home.kobo.notYours": "اپلیکیشن لا نه شي پوهېدلی چې کومې فورمې ستاسو دي، نو دا لېست د ټولې پروژې دی.",
  "home.kobo.none": "لا هېڅ فورمه نه ده رارسېدلې. که مو لېږلې وي، له راتلونکي همغږۍ وروسته به دلته ښکاره شي.",
  "home.kobo.synced": "وروستۍ همغږي: {date}",
  "home.kobo.neverSynced": "لا نه ده همغږې شوې",
  "home.kobo.pending": "د MEL په تمه",
  "home.kobo.accepted": "وشمېرل شوه",
  "home.kobo.queried": "MEL پوښتنه لري",
};

export const hkPs: Partial<Record<keyof typeof hkEn, string>> = {
  "health.kobo.title": "د KoboToolbox شپنۍ کتنه",
  "health.kobo.help": "هره شپه اپلیکیشن د هرې نښلول شوې پروژې فورمې بیا لولي، څو هغه ځوابونه ومومي چې له رارسېدو وروسته په KoboToolbox کې سم شوي یا ړنګ شوي. دا کار هېڅکله منل شوې پایله نه بدلوي: د MEL لپاره یې په نښه کوي.",
  "health.kobo.none": "په تېره اونۍ کې هېڅ کتنه نه ده شوې. هغه وخت پیلېږي چې مهالوېش شوی کار فعال شي او یوه پروژه له KoboToolbox سره ونښلول شي.",
  "health.kobo.same": "{fetched} فورمې وکتل شوې: هېڅ شی نه و بدل شوی.",
  "health.kobo.changed": "{fetched} فورمې وکتل شوې: {added} نوې، {updated} سمې شوې، {removed} په KoboToolbox کې ړنګې شوې.",
  "health.kobo.flagged": "منل شوې پایلې چې په KoboToolbox کې بدلې شوې او د MEL لپاره په نښه شوې: {n}.",
  "health.kobo.failed": "ونه چلېده: {error}",
};
