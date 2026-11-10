# Current state

Written 10 Nov 2026 from the code on `surge/2026-11-09`, not from the original spec. **Built** means the screens, routes and storage exist and were read. It does not mean used in the field: the pilot is two people on ACRP. Nothing here was checked by running the app against a database.

| Area | Status | Main files | Open questions |
|---|---|---|---|
| Sign-in, roles, "View as" | Built | `src/server/auth.ts`, `src/lib/access.ts`, `src/lib/authority.ts` | Staff, session and timesheet routes are not yet scoped to an organization; safe with one organization only |
| One guard for routes | Built 9 Nov | `src/server/guard.ts` | Older routes call the same checks directly rather than the new helpers |
| Audit log | Built | `src/server/audit.ts` | Opportunities and payroll export still write no audit row |
| Project setup from three uploads | Built | `src/server/setup-extract.ts`, `src/components/setup/` | Six fields of a target (baseline, breakdown, proof documents, budget line, workplan link, "in quarterly report") can only be set by a script |
| Results with proof, MEL review | Built | `src/lib/results.ts`, `src/lib/data-checks.ts`, `src/server/results-store.ts`, `src/components/progress/results-page.tsx` | When may a result be accepted with no proof? |
| KoboToolbox link, sync, mapping suggestions | Built | `src/server/kobo-link.ts`, `src/server/kobo-results.ts`, `src/server/kobo-suggest.ts` | The app does not keep who sent a submission |
| Kobo nightly reconcile | Built 10 Nov, never run | `src/server/kobo-reconcile.ts`, `vercel.json` | Does the Vercel plan allow a third scheduled job? |
| Progress: one row per target | Built | `src/components/progress/indicator-table.tsx`, `src/lib/target-status.ts` | Donor accounts and demo projects still see cards that judge "on track" a second way |
| Number to proof, evidence pack | Built | `src/lib/evidence.ts`, `src/server/proof.ts`, `src/server/outputs.ts` | |
| Budget and spending | Built | `src/lib/bva.ts`, `src/lib/budget-view.ts`, `src/lib/spend-map.ts` | The afghani rate is a fixed 70 in three places; the report's total and the Budget page's total differ by design and neither says so |
| Monthly review | Built | `src/server/monthly-review-store.ts`, `src/components/progress/review-page.tsx` | |
| Quarterly report, claim check, release | Built | `src/lib/qpr.ts`, `src/server/qpr-store.ts`, `src/components/progress/qpr-page.tsx` | Title, duration, agreement number and director are typed on the report, not taken from the project |
| Pre-flight | Built | `src/lib/preflight.ts`, `src/server/preflight.ts` | |
| Annual and final reports, FACE form | Built | `src/server/period-report-store.ts`, `src/server/face-store.ts` | |
| Donor share links | Built | `src/server/share-store.ts` | May a link go out before release? |
| Weekly update, stories, photos and posts | Built | `src/server/weekly-store.ts`, `src/server/stories-store.ts`, `src/server/photos-store.ts` | Photos go to the AI for coaching, which the data protection note says never happens |
| Home | Built | `src/components/home/`, `src/server/home-store.ts`, `src/lib/home-buckets.ts` | Most of Home's sentences are English only |
| Work: tasks, activities, timeline | Built | `src/components/tasks/`, `src/server/work-store.ts` | |
| Procurement calendar and purchases | Built | `src/lib/procurement.ts`, `src/lib/procurement-plan.ts`, `src/server/procurement-guard.ts` | Many checks cite Draft 1.0 of the policy, which is not approved |
| Bills, suppliers, monthly close | Built | `src/lib/bills.ts`, `src/lib/suppliers.ts`, `src/lib/closeout.ts` | The bill book is saved whole, with no lock against two people saving at once |
| Policy layers (organization and donor) | Built | `src/lib/policy.ts`, `src/server/policy-store.ts` | |
| Solo mode for sign-offs | Built | `src/server/solo.ts` | Not in the written policy |
| HR record, leave, timesheets, expenses, payroll, onboarding, offboarding | Built | `src/lib/hr.ts`, `src/server/hr-store.ts`, `src/components/people/` | A person exists in both `staff` and the HR record with no link kept in step |
| Opportunities and track record | Built | `src/server/opportunities-store.ts`, `src/server/track-record.ts` | |
| Learning and lessons, lens review, market windows | Built | `src/lib/learning.ts`, `src/lib/lens-review.ts`, `src/lib/market-windows.ts` | |
| AI, one door | Built 9 Nov | `src/server/ai.ts`, `src/lib/ai-jobs.ts` | Translation sends Dari and Pashto notes as written |
| "Why we ask" help | Partly built | `src/lib/field-help.ts` | Photos and HR fields have none yet |
| Four languages | Partly built | `src/lib/i18n/` | About 460 places in the screens are still English only; Spanish lacks 64 strings, Dari and Pashto 89; all translations need a native reader |
| Plain words (Target, Result, Proof) | Planned (C4) | | The before-and-after list of strings has not been written |
| Sample project for a new organization | Planned (C5) | | |
| Field activities (farmer steps, readiness, distribution) | Demo project only | `src/lib/field.ts`, `src/components/field/` | Farmers are kept twice, in `farmers` and in `field_items` |
| Tests | Built 9 Nov | `src/lib/__tests__/` | Rules only; no screen or database test |

## Where the code and the v1 spec disagree

Each needs your answer; nothing was decided here.

1. **Pilot project.** The spec names the Western Highlands project; the code and the data are set up for ACRP in Afghanistan.
2. **Release before anything goes to a donor.** The spec says release comes first; the app lets a share link be made from a practice copy (`src/server/share-store.ts`).
3. **Proof before release.** The spec asks for proof behind accepted results; the app lists an accepted result with no proof under Worth fixing and does not block release (`src/server/preflight.ts`).

I compared only what the audit touched; the spec was not read line by line against the code, so this list is not complete.

The full list of decisions with no written ROP rule is in section 5 of `docs/AUDIT-2026-11-09.md`.
