import type { AppUser } from "@/lib/demo";

/** Plain-language lines for audit trail entries, for the screen and the CSV export. */

/** Who may read a project's audit trail: the people who sign things off or review them. The menu and the server use this one rule. */
export const mayViewAudit = (u: AppUser) => u.kind === "employee" && (!!u.admin || u.project.some((r) => ["plan-approver", "report-release", "monthly-review", "mel-owner"].includes(r)));

type D = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown) => (typeof v === "number" ? v.toLocaleString("en-US") : str(v));

export function describeAudit(entity: string, action: string, d: D): string {
  switch (action) {
    case "result_recorded":
      return `Recorded result for ${str(d.indicator)}: ${num(d.value)} on ${str(d.date)}${d.proof ? ` with ${num(d.proof)} proof item(s)` : ", no proof yet"}`;
    case "result_accepted":
      return `Accepted result for ${str(d.indicator)} (${num(d.value)} on ${str(d.date)}); it now counts`;
    case "result_queried":
      return `Queried result for ${str(d.indicator)} (${num(d.value)} on ${str(d.date)}): ${str(d.note)}`;
    case "result_corrected":
      return `Corrected the ${str(d.indicator)} result after MEL's query (${num((d.before as D)?.value)} to ${num((d.after as D)?.value)}): ${str(d.reply)}`;
    case "proof_added":
      return `Added proof to the ${str(d.indicator)} result of ${str(d.date)}: ${[...((d.files as string[]) ?? []), ...((d.links as { title: string }[]) ?? []).map((l) => l.title)].join("; ")}`;
    case "update_added":
      return `Activity update for ${str(d.activity)} on ${str(d.date)}`;
    case "project_modules_set":
      return `Changed what the project uses: ${Object.entries((d.after as D) ?? {}).map(([k, v]) => `${k} ${v ? "on" : "off"}`).join(", ")}`;
    case "feedback_recorded":
      return `Recorded a ${str(d.kind)} from a ${str(d.from)} in the feedback log${d.serious ? " (a serious matter)" : ""}`;
    case "feedback_answered":
      return "Recorded the answer to an entry in the feedback log";
    case "qpr_released":
      return `Released the ${str(d.quarter)} quarterly report`;
    case "qpr_ai_drafted":
      return `AI drafted ${((d.keys as string[]) ?? []).join(", ")} in the ${str(d.quarter)} report (draft, to review)`;
    case "qpr_edited":
      return `Edited ${str(d.part)}${d.key ? ` ${str(d.key)}` : ""} in the ${str(d.quarter)} report`;
    case "actuals_imported":
      return `Imported spending from ${str(d.file)} (${str(d.period)}): ${num(d.actual)} of ${num(d.budget)} ${str(d.currency)}`;
    case "stage_changed":
      return d.signedOff ? `Signed off the plan and budget: ${str(d.from)} to ${str(d.to)}${d.note ? ` (${str(d.note)})` : ""}` : `Moved the project from ${str(d.from)} to ${str(d.to)}${d.note ? ` (${str(d.note)})` : ""}`;
    case "review_edited":
      return `Edited the ${str(d.month)} monthly review (${str(d.part)})`;
    case "review_change_proposed":
      return `Proposed in the ${str(d.month)} review: ${str(d.change)} (${str(d.reason)})`;
    case "review_change_withdrawn":
      return `Withdrew from the ${str(d.month)} review: ${str(d.change)}`;
    case "review_change_approved":
      return `Approved and applied from the ${str(d.month)} review: ${str(d.change)}${d.note ? ` (${str(d.note)})` : ""}`;
    case "review_change_rejected":
      return `Rejected in the ${str(d.month)} review: ${str(d.change)}${d.note ? ` (${str(d.note)})` : ""}`;
    case "review_ai_drafted":
      return `AI drafted the ${str(d.month)} monthly review's summary and needs-attention note (${str(d.model)}; draft, to review)`;
    case "ai_drafted":
      return `AI drafted the ${str(d.document)} for procurement ${str(d.procurement)} (${str(d.model)}; draft, to review)`;
    case "ai_checked":
      return `AI checked procurement ${str(d.procurement)} at step ${str(d.step)}: ${num(d.findings)} finding(s) for its owner (${str(d.model)})`;
    case "lens_review_run":
      return `AI reviewed the plan through ROP's lenses (${str(d.model)}): ${num(d.findings)} finding(s), ${num(d.high)} high (draft, to decide)`;
    case "lens_finding_acted":
      return `Will act on a lens finding (${str(d.severity)}): ${str(d.gap)} (${str(d.note)})`;
    case "lens_finding_dismissed":
      return `Dismissed a lens finding (${str(d.severity)}): ${str(d.gap)} (${str(d.note)})`;
    case "plan_edited":
      return `Edited the plan in setup (${str(d.part)})`;
    case "plan_changed_after_signoff":
      return `Changed the signed-off plan in setup (${str(d.part)}): ${str(d.reason)}`;
    case "procurement_saved": {
      const st = d.step as { from?: string; to?: string } | string;
      const moved = typeof st === "object" && st ? ` moved from ${st.from} to ${st.to};` : "";
      const signed = ((d.signed as string[]) ?? []).length ? ` signed ${((d.signed as string[]) ?? []).join(", ")};` : "";
      return d.created ? `Requested purchase ${str(d.procurement)}: ${str(d.title)}` : `Procurement ${str(d.procurement)}:${moved}${signed}${num(d.checks)} check(s) changed${((d.fields as string[]) ?? []).length ? `; edited ${((d.fields as string[]) ?? []).join(", ")}` : ""}`;
    }
    case "review_signed_off":
      return `Signed off the ${str(d.month)} monthly review (${num(d.changes)} change(s) applied)`;
    case "accepted":
    case "queried":
      return `${action === "accepted" ? "Accepted" : "Queried"} a ${str(d.form)} submission${d.farmer ? ` for farmer ${str(d.farmer)}` : ""}${d.note ? `: ${str(d.note)}` : ""}${d.applied ? ` (${str(d.applied)})` : ""}`;
    case "edited_in_kobo_after_review":
      return "A reviewed Kobo submission was edited in KoboToolbox afterwards";
    case "distribution_recorded":
    case "distribution_sent_to_manager":
    case "distribution_resubmitted": {
      const what = action === "distribution_resubmitted" ? "Fixed and sent again the input distribution" : action === "distribution_sent_to_manager" ? "Checked KoboCollect record sent to the manager: input distribution" : "Recorded an input distribution";
      const flags = Array.isArray(d.flags) && d.flags.length ? `; ${d.flags.length} flag(s)` : "";
      return `${what}${d.farmer ? ` to farmer ${str(d.farmer)}` : ""}${d.recordedBy ? ` (recorded by ${str(d.recordedBy)})` : ""}${d.blocked ? "; held by the store check" : ""}${flags}${d.emailed ? "; approver emailed" : d.why ? `; not emailed: ${str(d.why)}` : ""}${d.fixed ? `; fix: ${str(d.fixed)}` : ""}`;
    }
    case "distribution_kobo_checked":
      return `Checked the KoboCollect input distribution record for farmer ${str(d.farmer)}`;
    case "distribution_approved":
      return `Approved the input distribution to farmer ${str(d.farmer)}${d.target ? `; one result made for target ${str(d.target)}, waiting for MEL` : ""}${d.note ? `: ${str(d.note)}` : ""}`;
    case "distribution_sent_back":
      return `Sent back the input distribution to farmer ${str(d.farmer)}${d.note ? `: ${str(d.note)}` : ""}`;
    case "share_created":
      return `Made a donor link to the ${str(d.quarter)} report${d.expires ? `, open until ${str(d.expires).slice(0, 10)}` : ""} (link ${str(d.token)}…)`;
    case "share_revoked":
      return `Closed the donor link to the ${str(d.quarter)} report (link ${str(d.token)}…)`;
    case "share_viewed":
      return `The ${str(d.quarter)} report was opened from its donor link (link ${str(d.token)}…)`;
    case "donor_report_viewed":
      return `Opened the released ${str(d.quarter)} report in the donor's own account (${str(d.donor)})`;
    case "donor_funding_set":
      return `Set what ${str(d.name)} funds: ${str(d.funds)}${Number(d.costShare) > 0 ? `, with ${num(d.costShare)} cost-share line(s)` : ""}`;
    case "month_closed":
      return `Closed ${str(d.month)}: ${num(d.vouchers)} voucher(s), ${num(d.totalUsd)} USD`;
    case "bill_recorded":
      return `Recorded bill ${str(d.bill ?? d.ref)}: ${num(d.amount)} ${str(d.currency)}${d.budgetLine ? ` on budget line ${str(d.budgetLine)}` : ""}`;
    case "kobo_approval_set":
      return "Changed who approves KoboCollect data on this project";
    case "policy_conflict_decided":
      return `Decided a conflict between the organization's and the donor's rules (${str(d.key)}): ${str(d.value)}${d.reason ? `, because ${str(d.reason)}` : ""}`;
    default: {
      if (action.startsWith("plan_")) return `Procurement calendar: ${action.slice(5).replace(/_/g, " ")} ${str(d.key)}`;
      // No line written for this entry yet: say what happened in words, with the facts the entry carries.
      const words = action.replace(/_/g, " ");
      const facts = FACTS.filter((k) => (typeof d[k] === "string" || typeof d[k] === "number") && String(d[k]).length <= 120)
        .slice(0, 4)
        .map((k) => `${k.replace(/([A-Z])/g, " $1").toLowerCase()} ${num(d[k])}`);
      return `${words.charAt(0).toUpperCase()}${words.slice(1)}${facts.length ? ` (${facts.join(", ")})` : ""}`;
    }
  }
}

/** Facts an entry may carry, in the order worth reading, for entries with no line of their own. */
const FACTS = ["ref", "farmer", "indicator", "target", "quarter", "month", "period", "donor", "supplier", "name", "title", "file", "form", "budgetLine", "amount", "usd", "value", "from", "to", "reason", "note"];
