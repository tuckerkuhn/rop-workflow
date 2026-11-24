/** Pashto for ./sample.ts, in its own module so English pages do not download it. */

import type { spEn } from "./sample";

export const spPs: Record<keyof typeof spEn, string> = {
  "sample.banner": "د بېلګې پروژه له جوړو معلوماتو سره، د یو بشپړ راپور د لیدو لپاره. دلته هېڅ نه بدلېږي.",
  "sample.see": "یو بشپړ راپور وګورئ",
  "sample.setUp": "خپله پروژه جوړه کړئ",
  "sample.title": "د بېلګې پروژه",
  "sample.help": "یوه بشپړه پروژه له جوړو معلوماتو سره: موخې، د اسنادو سره منل شوې پایلې، د لګښتونو سره بودجه او یو خپور شوی درې‌میاشتنی راپور. هرڅوک یې پرانیستلی شي؛ هېڅوک یې نه شي بدلولی، او په هېڅ ټولګه کې نه شمېرل کېږي.",
  "sample.shown": "ټولو ته ښکاري",
  "sample.hidden": "پټ",
  "sample.hide": "پټ یې کړئ",
  "sample.show": "بیا یې وښایئ",
  "sample.reason": "ولې (له بدلون سره ساتل کېږي)",
  "sample.since": "له {date} راهیسې، د {who} له خوا: {reason}",
  "sample.adminOnly": "یوازې اداره کوونکی یې پټولی یا ښودلی شي.",
  "sample.history": "پخواني بدلونونه",
  "sample.changed": "{date}: د {who} له خوا {state}. {reason}",
  "sample.stateHidden": "پټ شو",
  "sample.stateShown": "وښودل شو",
  "sample.doneHidden": "د بېلګې پروژه پټه ده",
  "sample.doneShown": "د بېلګې پروژه ښکاري",
};
