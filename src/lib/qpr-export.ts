import { SECTIONS, STATUS_LABEL, type Qpr, type Row } from "@/lib/qpr";
import { quarterRange } from "@/lib/results";

/**
 * The quarterly report as a Word document (HTML that Word opens as .doc), in the order ROP sends
 * it. Each figure in the indicator table links to the records and proof behind it in the app.
 */

export type ExportInput = {
  project: { code: string; name: string; start: string | null; end: string | null };
  quarter: string;
  saved: Qpr;
  rows: Row[];
  spend: { currency: string; budget: number; cumulative: number; asOf: string | null };
  activities: { code: string; name: string }[];
  /** e.g. https://rop-workflow.vercel.app, for the links to evidence. */
  origin: string;
};

const esc = (s: string | number) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const long = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const paras = (text: string | undefined) =>
  text?.trim()
    ? text
        .trim()
        .split(/\n{2,}/)
        .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
        .join("")
    : `<p class="todo">[To be written]</p>`;

export function qprHtml(d: ExportInput) {
  const { from, to } = quarterRange(d.quarter);
  const qn = d.quarter.slice(5);
  const year = d.quarter.slice(0, 4);
  const link = (code: string, f: string, t: string, text: string) => `<a href="${esc(`${d.origin}/progress/results?indicator=${code}&from=${f}&to=${t}`)}">${esc(text)}</a>`;
  const sec = (key: string) => d.saved.sections[key]?.text;
  const heading = (key: string) => SECTIONS.find((s) => s.key === key)!.heading;
  const i = d.saved.info;
  const money = (v: number | null) => (v === null ? "[to be entered]" : `${n(v)} ${d.spend.currency}`);

  // Indicator table, grouped by output then activity, as in ROP's report.
  const outputs = [...new Set(d.rows.map((r) => r.output))];
  const table = outputs
    .map((o) => {
      const head = `<tr class="group"><td colspan="6">${esc(o || "Outputs")}</td></tr>`;
      const acts = [...new Set(d.rows.filter((r) => r.output === o).map((r) => r.activity))];
      return (
        head +
        acts
          .map((a) => {
            const name = d.activities.find((x) => x.code === a)?.name ?? "";
            const rows = d.rows.filter((r) => r.output === o && r.activity === a);
            return rows
              .map(
                (r, k) =>
                  `<tr>${k === 0 ? `<td rowspan="${rows.length}">Activity ${esc(a)}: ${esc(name)}</td>` : ""}<td>${esc(r.donorCode)} ${esc(r.name)} (${esc(r.unit)})</td><td class="num">${n(r.yearTarget)}</td><td class="num">${link(r.code, from, to, n(r.quarter))}</td><td class="num">${link(r.code, `${year}-01-01`, to, n(r.year))}</td><td>${esc(r.comment)}</td></tr>`,
              )
              .join("");
          })
          .join("")
      );
    })
    .join("");

  const narrative = d.activities
    .map((a) => `<h3>Activity ${esc(a.code)}: ${esc(a.name)}</h3>${paras(sec(`act.${a.code}`))}`)
    .join("");

  const risks = d.saved.risks.length
    ? `<table><thead><tr><th>Risks</th><th>Mitigation Measures</th></tr></thead><tbody>${d.saved.risks.map((r) => `<tr><td>${esc(r.risk)}</td><td>${esc(r.mitigation)}</td></tr>`).join("")}</tbody></table>`
    : `<p class="todo">[Risk table to be completed]</p>`;
  const grm = d.saved.grm;
  const grmLine = grm.received === null ? "" : `<p>Cases received this quarter: ${grm.received}. Resolved: ${grm.resolved ?? "[to be entered]"}. Open: ${grm.resolved === null ? "[to be entered]" : grm.received - grm.resolved}.</p>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(d.project.name)} QPR ${esc(d.quarter)}</title>
<style>
body{font-family:Calibri,"Segoe UI",Arial,sans-serif;font-size:11pt;color:#111;line-height:1.4;max-width:900px;margin:24px auto;padding:0 24px}
h1{font-size:20pt;margin:0 0 4pt}h2{font-size:14pt;margin:20pt 0 6pt;color:#1f4e3d}h3{font-size:12pt;margin:14pt 0 4pt}
table{width:100%;border-collapse:collapse;font-size:10pt;margin:6pt 0}th,td{border:1px solid #999;padding:4pt 6pt;vertical-align:top;text-align:left}
th{background:#dfe9e3}tr.group td{background:#f1efe8;font-weight:bold}td.num{text-align:right;white-space:nowrap}
.cover{border-bottom:2px solid #1f4e3d;padding-bottom:10pt;margin-bottom:12pt}.todo{color:#a33}.note{font-size:9pt;color:#555}
a{color:#1f4e3d}
</style></head><body>
<div class="cover"><p>${esc(d.project.name)}</p><h1>QUARTERLY PROGRESS REPORT</h1><p><b>(${esc(qn)}: ${esc(long(from))} – ${esc(long(to))})</b></p><p>${esc(i.partner)}</p></div>
<h2>Project Information</h2>
<table><tbody>
<tr><th>Project title</th><td>${esc(i.title || d.project.name)}</td></tr>
<tr><th>Agreement number</th><td>${esc(i.agreement || "[to be entered]")}</td></tr>
<tr><th>Project duration</th><td>${d.project.start && d.project.end ? `${esc(long(d.project.start))} – ${esc(long(d.project.end))}` : "[to be entered]"}</td></tr>
<tr><th>Total budget</th><td>${money(d.spend.budget)}</td></tr>
<tr><th>Expenditure this quarter</th><td>${money(d.saved.quarterSpend)}</td></tr>
<tr><th>Cumulative expenditure</th><td>${money(d.spend.cumulative)}${d.spend.asOf ? ` <span class="note">(from the budget file imported on ${esc(d.spend.asOf)})</span>` : ""}</td></tr>
<tr><th>Project locations</th><td>${esc(i.locations || "[to be entered]")}</td></tr>
<tr><th>Responsible party</th><td>${esc(i.partner)}</td></tr>
<tr><th>Country director</th><td>${esc(i.director || "[to be entered]")}</td></tr>
</tbody></table>
<h2>${esc(heading("summary"))}</h2>${paras(sec("summary"))}
<h2>${esc(heading("background"))}</h2>${paras(sec("background"))}
<h2>II. Progress Towards Results</h2>
<table><thead><tr><th>Project Output &amp; Activity</th><th>Output Indicator</th><th>${esc(year)} Target</th><th>${esc(qn)} Achieved</th><th>Annual achievement</th><th>Comments [${Object.values(STATUS_LABEL).join(", ")}]</th></tr></thead><tbody>${table}</tbody></table>
<p class="note">Figures are from results checked by MEL. Each figure links to the records and proof behind it.</p>
<h2>Narrative Description</h2>${narrative}
<h2>III. Cross-cutting Issues</h2>
<h3>${esc(heading("gender"))}</h3>${paras(sec("gender"))}
<h3>${esc(heading("principled"))}</h3>${paras(sec("principled"))}
<h3>${esc(heading("partnerships"))}</h3>${paras(sec("partnerships"))}
<h3>${esc(heading("safeguards"))}</h3>${paras(sec("safeguards"))}
<h3>${esc(heading("grm"))}</h3>${grmLine}${paras(sec("grm"))}
${sec("story")?.trim() ? `<h3>${esc(heading("story"))}</h3>${paras(sec("story"))}` : ""}
<h2>${esc(heading("challenges"))}</h2>${paras(sec("challenges"))}
<h2>V. Risk Management</h2>${risks}
<h2>${esc(heading("lessons"))}</h2>${paras(sec("lessons"))}
<h2>${esc(heading("next"))}</h2>${paras(sec("next"))}
</body></html>`;
}
