# 03. Plan: ranked backlog

Order: what blocks the farm input distribution demo, then what hurts it, then connections across workflows, then polish. Each batch is one commit and can be reviewed and reverted alone. Issue numbers are from `02-audit.md`.

**Rule for this branch:** no schema migration. Everything below fits in tables that exist. Where a fix truly needs a new column it is marked and left for a decision.

## Tier 1. Blocks the demo

| Batch | What | Issues | Effort | Status |
|---|---|---|---|---|
| 1 | **Nobody approves a distribution they recorded or collected.** The manager step uses the same rule as every other approval: the recorder is taken out; with no other manager it goes to the person the recorder reports to. Email, Home row and the approval page follow the same list. | A1 | S | Built |
| 2 | **A distribution cannot close without the signed note.** Approve is refused while the recipient's signature or thumbprint is not confirmed; the page says so before the tap and offers Send back. The fix-and-resend path already lets the recorder confirm it. | A2, C1 | S | Built |
| 3 | **Demo cast and projects.** A fictional Director of MEL. A-2027 saved with "one named person: Director of MEL, stand-in the MEL officer". A-2027 seeded at Execute. A second database project, just won, with nothing set up. | D1, D2, D3, B6 (server side) | S | Built |
| 4 | **Start a project from another project's setup.** One step copies the input package (as a draft to confirm against the new budget), the KoboCollect approval rule and, when the new project has none, the targets. On the empty Field activities screen and by API. | T1, C3 | M | Built |

## Tier 2. Hurts the demo

| Batch | What | Issues | Effort | Status |
|---|---|---|---|---|
| 5 | **Field records as a data set.** A second download beside the farmer table: one row per record (training, readiness, visit, distribution) with farmer ID, date, collector, decision, who decided, days to decision and the form's own answers. No names. | F2, F1 (partly), F4 | S | Built |
| 6 | **Correction goes to the agent who made the visit** when their KoboCollect account is matched; otherwise as now. | A5 | S | Built |
| 7 | **Settings the demo needs are written down.** `RESEND_API_KEY`, `NOTIFY_FROM`, `APP_URL`, `CRON_SECRET` in `.env.example` with what each switches on. | A6 | S | Built |
| 8 | Approval page, Field setup and the KoboCollect approval setting in Dari, Pashto and Spanish. Needs a native reader, so the strings should be moved to the translation layer first and translated second. | G2 | M | Not started |
| 9 | Demo picker shows database projects only when a database is connected. | C6 | S | Not started. Touches `lib/demo.ts` consumers in many screens; left for review |
| 10 | Store issue voucher as a number, kept on the distribution and shown to Finance. | B3 | S | Waits on your decision about voucher names (open since 14 Nov) |
| 11 | Warn when a linked field form counts toward no target. | F5 | S | Not started |
| 12 | Remind an administrator of unmatched KoboCollect accounts on Home. | A7 | S | Not started |

## Tier 3. Connections across workflows

| Batch | What | Issues | Effort | Status |
|---|---|---|---|---|
| 13 | One farmer record: make `field_items` the working copy and `farmers` the register, with one write path for village and enrollment. | B1 | L | Not started. Needs a design note first |
| 14 | Staff and HR: one source for `reportsTo`, read by approvals. | B2 | M | Not started |
| 15 | Report header facts (agreement number, director, locations, partner) stored on the project and reused each quarter. | B7 | M | Not started. Likely needs columns on `projects`: a migration, so your call |
| 16 | Training sessions as a thing: date, place, topic, trainer, with attendance under it. | F3 | M | Not started. Can live in `project_state` without a migration |
| 17 | Season steps from a template instead of code. | T3 | L | Not started. The biggest template item |
| 18 | KoboCollect forms generated in the app from the package, no Python by hand. | T2 | L | Not started |
| 19 | Exchange rates per currency and month in organization settings. | T4 | M | Not started |

## Tier 4. Polish

| Batch | What | Issues | Effort |
|---|---|---|---|
| 20 | Home opens with fewer requests (one combined call). | G1 | M |
| 21 | Wording: "field forms" not "from KoboCollect" for typed records. | C2 | S |
| 22 | Remove demo constants from the dashboard cards. | T5, T6 | S |
| 23 | Second-level reporting-line fallback and a notice when nobody can decide. | A4 | S |
| 24 | Expense claims carry a budget line. | B4 | M |

## What I will not do without you

- Anything that adds a migration (the README says pushing to `main` applies it to the live database).
- Renaming real staff in the public demo cast (H1): logged as a decision.
- Changing the default approver for existing real projects (A3): logged as a decision. The demo project and the copy-setup step carry the Director of MEL rule.
