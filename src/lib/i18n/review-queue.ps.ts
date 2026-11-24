/** Pashto for ./review-queue.ts, in its own module so English pages do not download it. */

import type { rqEn } from "./review-queue";

type Keys = keyof typeof rqEn;

export const rqPs: Partial<Record<Keys, string>> = {
  "rq.line": "{clean} پرته له خبرتیا، {flagged} له خبرتیا سره.",
  "rq.accept": "{n} ومنئ",
  "rq.review": "{n} وګورئ",
  "rq.confirm": "دا {n} پایلې ومنل شي؟ هره یوه له اوس څخه په پرمختګ او راپور کې شمېرل کېږي. د خبرتیا لرونکې پایلې یو په یو کتل کېږي.",
  "rq.accepted": "{n} پایلې ومنل شوې.",
  "rq.of": "{k} له {n} خبرتیا لرونکو",
  "rq.more": "+{n} نور",
  "rq.less": "لږ",
  "rq.acceptOne": "منل",
  "rq.query": "پوښتنه",
  "rq.what": "څه باید سم شي؟",
  "rq.send": "پوښتنه ولېږئ",
  "rq.cancel": "لغوه",
  "rq.back": "لېست ته بېرته",
  "rq.done": "د ټولو خبرتیا لرونکو پایلو پرېکړه وشوه.",
};
