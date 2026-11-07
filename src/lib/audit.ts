/** Plain-language lines for audit trail entries, for the screen and the CSV export. */

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
    case "proof_added":
      return `Added proof to the ${str(d.indicator)} result of ${str(d.date)}: ${[...((d.files as string[]) ?? []), ...((d.links as { title: string }[]) ?? []).map((l) => l.title)].join("; ")}`;
    case "update_added":
      return `Activity update for ${str(d.activity)} on ${str(d.date)}`;
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
    case "review_signed_off":
      return `Signed off the ${str(d.month)} monthly review (${num(d.changes)} change(s) applied)`;
    case "accepted":
    case "queried":
      return `${action === "accepted" ? "Accepted" : "Queried"} a ${str(d.form)} submission${d.farmer ? ` for farmer ${str(d.farmer)}` : ""}${d.note ? `: ${str(d.note)}` : ""}${d.applied ? ` (${str(d.applied)})` : ""}`;
    case "edited_in_kobo_after_review":
      return "A reviewed Kobo submission was edited in KoboToolbox afterwards";
    default:
      if (action.startsWith("plan_")) return `Procurement calendar: ${action.slice(5).replace(/_/g, " ")} ${str(d.key)}`;
      return `${entity}: ${action.replace(/_/g, " ")}`;
  }
}
