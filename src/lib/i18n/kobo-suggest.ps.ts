/** Pashto for ./kobo-suggest.ts, in its own module so English pages do not download it. */

import type { ksEn } from "./kobo-suggest";

type Keys = keyof typeof ksEn;

export const ksPs: Partial<Record<Keys, string>> = {
  "ks.suggest": "د سمون وړاندیز",
  "ks.suggesting": "فورمې کتل کېږي… (تر یوې دقیقې)",
  "ks.help": "Claude د فورمو پوښتنې (نه ځوابونه) ګوري او د هرې موخې لپاره یوه وړاندیز کوي. تر هغه چې وړاندیز ونه منئ او خوندي یې نه کړئ، هېڅ نه بدلېږي.",
  "ks.acceptHigh": "ټول لوړ باور لرونکي ومنئ ({n})",
  "ks.accept": "منل",
  "ks.accepted": "ومنل شو",
  "ks.none": "ښه سمون نشته: {reason}",
  "ks.conf.high": "لوړ باور",
  "ks.conf.medium": "منځنی: وګورئ",
  "ks.conf.low": "ټیټ: اټکل",
  "ks.risks": "دا وګورئ",
  "ks.origin.suggested": "وړاندیز شوی",
  "ks.origin.suggested-edited": "وړاندیز شوی، بیا بدل شوی",
};
