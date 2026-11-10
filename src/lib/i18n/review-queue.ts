/**
 * The review queue at the top of Results and proof (B1). English is the source; Dari, Pashto and
 * Spanish are drafts that need review by a native speaker before field use.
 */

export const rqEn = {
  "rq.line": "{clean} clean, {flagged} flagged.",
  "rq.accept": "Accept {n}",
  "rq.review": "Review {n}",
  "rq.confirm": "Accept these {n} results? Each counts in Progress and the report from now on. Flagged results still need a look one by one.",
  "rq.accepted": "Accepted {n} results.",
  "rq.of": "{k} of {n} flagged",
  "rq.more": "+{n} more",
  "rq.less": "Show less",
  "rq.acceptOne": "Accept",
  "rq.query": "Query",
  "rq.what": "What needs fixing?",
  "rq.send": "Send query",
  "rq.cancel": "Cancel",
  "rq.back": "Back to the list",
  "rq.done": "All flagged results are decided.",
};
type Keys = keyof typeof rqEn;
export const rqEs: Partial<Record<Keys, string>> = {
  "rq.line": "{clean} sin alertas, {flagged} con alertas.",
  "rq.accept": "Aceptar {n}",
  "rq.review": "Revisar {n}",
  "rq.confirm": "¿Aceptar estos {n} resultados? Cada uno cuenta desde ahora en Progreso y en el informe. Los resultados con alertas se revisan uno por uno.",
  "rq.accepted": "{n} resultados aceptados.",
  "rq.of": "{k} de {n} con alertas",
  "rq.more": "+{n} más",
  "rq.less": "Ver menos",
  "rq.acceptOne": "Aceptar",
  "rq.query": "Consultar",
  "rq.what": "¿Qué hay que corregir?",
  "rq.send": "Enviar consulta",
  "rq.cancel": "Cancelar",
  "rq.back": "Volver a la lista",
  "rq.done": "Todos los resultados con alertas están decididos.",
};
export const rqFa: Partial<Record<Keys, string>> = {
  "rq.line": "{clean} بدون هشدار، {flagged} با هشدار.",
  "rq.accept": "پذیرفتن {n}",
  "rq.review": "بررسی {n}",
  "rq.confirm": "این {n} نتیجه پذیرفته شوند؟ هر کدام از این پس در پیشرفت و گزارش شمرده می‌شود. نتایج دارای هشدار یکی‌یکی بررسی می‌شوند.",
  "rq.accepted": "{n} نتیجه پذیرفته شد.",
  "rq.of": "{k} از {n} دارای هشدار",
  "rq.more": "+{n} مورد دیگر",
  "rq.less": "کمتر",
  "rq.acceptOne": "پذیرفتن",
  "rq.query": "پرسش",
  "rq.what": "چه چیزی باید اصلاح شود؟",
  "rq.send": "فرستادن پرسش",
  "rq.cancel": "لغو",
  "rq.back": "بازگشت به فهرست",
  "rq.done": "دربارهٔ همهٔ نتایج دارای هشدار تصمیم گرفته شد.",
};
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
