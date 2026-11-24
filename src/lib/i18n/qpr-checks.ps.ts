/** Pashto for ./qpr-checks.ts, in its own module so English pages do not download it. */

import type { qcEn } from "./qpr-checks";

export const qcPs: Record<keyof typeof qcEn, string> = {
  "qc.pending": "{code}: د دې ربعې {n} پایلې لا هم د MEL کتنې ته انتظار دي، نو نه شمېرل کېږي.",
  "qc.queried": "{code}: MEL د دې ربعې پر {n} پایلو پوښتنه کړې، نو تر سمولو پورې نه شمېرل کېږي.",
  "qc.noProof": "{code}: د دې ربعې {n} پایلې ثبوت نه لري{note}.",
  "qc.completedShort": "{code}: «بشپړ شوی» نښه شوی، خو د سږکال پایله د {target} {unit} هدف څخه {done} ده.",
  "qc.notImplemented": "{code}: «نه دی پلي شوی» نښه شوی، خو د سږکال پایله {done} {unit} ده.",
  "qc.commentPct": "{code}: تبصره {pcts}% وايي، خو د سږکال پایله د هدف {real}% ده.",
  "qc.commentStatus": "{code}: تبصره باید د خپل حالت ({status}) سره پیل شي.",
  "qc.overBudget": "تر اوسه لګښت ({spent}) له بودجې ({budget}) څخه زیات دی.",
  "qc.quarterOverTotal": "د دې ربعې لګښت تر اوسه له ټول لګښت څخه زیات دی.",
  "qc.noQuarterSpend": "د دې ربعې لګښت نه دی داخل شوی: د مالي څانګې د بودجې او لګښت فایل راوړئ، یا یې د پروژې معلوماتو کې ولیکئ.",
  "qc.lineOver": "د بودجې کرښې {code} د {budget} {currency} څخه {spent} لګښت کړی ({pct}%): د پروژې معلوماتو کې ولیکئ چې ولې له بودجې زیات دی، یا د بودجې تعدیل ورکړئ.",
  "qc.missingMonths": "راوړل شوی لګښت {months} نه لري: د مالي څانګې وروستی فایل راوړئ.",
  "qc.typedSpend": "د دې ربعې لګښت {typed} لیکل شوی، خو د مالي څانګې راوړل شوی فایل {imported} وايي.",
  "qc.sectionEmpty": "{heading} لا نه دی لیکل شوی.",
  "qc.sectionCopied": "{heading} له {from} څخه کاپي شوی: وګورئ چې د دې ربعې لپاره سم دی.",
  "qc.activityText": "فعالیت {code} په دې ربعه کې پایلې لري، خو د هغو په اړه څه نه دي لیکل شوي.",
  "qc.risks": "د خطرونو جدول خالي دی.",
  "qc.grm": "د شکایتونو (GRM) شمېرې نه دي ډکې شوې.",
};
