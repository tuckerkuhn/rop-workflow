# KoboToolbox forms

XLSForm sources for field data collection (server: https://kf.kobotoolbox.org).
Field staff use KoboCollect (offline, Android) or Enketo web forms.

| Form | Workflow step | Status |
|---|---|---|
| `readiness_check.xlsx` | Verify readiness / recheck | **Built.** Accepted results move the farmer in Field activities. |
| `training_attendance.xlsx` | Train farmers | Planned |
| `distribution_form.xlsx` | Distribute inputs | **Draft for review.** Checked against the goods received note; the project manager approves each one (email link or Home). |
| `field_visit.xlsx` | Plant and follow up | Planned |

Conventions:

- Every form has a hidden `project_code` (e.g. `A-2027`) so submissions attach to the right project.
- Farmers are picked from `farmers.csv` (form media pushed by the app): **farmer ID, village and
  household-head initials. No names on devices.**
- Labels in English, Dari and Pashto. **The Dari and Pashto labels are drafts; have a native
  speaker review them before field use.**
- Each submission is stored once, keyed on Kobo's `_uuid`, and waits in the project's review
  queue (Project → Verify). Nothing changes in Field activities until the MEL owner accepts it.

## Setting up the distribution form

Same steps as the readiness check below, with `python3 kobo/build_distribution_form.py` and
`kobo/distribution_form.xlsx`, and in Setup mark the form **Input distribution**. Each submission is
checked against the goods received notes for the seed (budget line 2.1) and fertilizer (2.2)
purchases, flagged (same farmer twice, above the planned package, no photo of the signed list,
not signed), and emailed to the project manager with a single-use approval link. Approving it
counts the farmer toward the distribution target by sex, adds them to the purchase's distribution
list and gives finance a task to pay the supplier. **Push farmer list to Kobo** updates
`farmers.csv` on this form too.

## Setting up the readiness check

Each project links its own KoboToolbox account and forms in the app; nothing about Kobo goes in
`.env.local` except `KOBO_TOKEN_KEY` (which encrypts the saved tokens).

1. Rebuild the form if you change it: `python3 kobo/build_readiness_form.py`. Its hidden
   `project_code` is fixed to the project (`A-2027`); give each project its own copy with its code.
2. In Kobo: **New → Upload an XLSForm** → `kobo/readiness_check.xlsx` → **Deploy**.
3. In the app: **Setup → Connect KoboToolbox** with the API token (Kobo → Account settings →
   Security), choose the form and mark it **Readiness check**.
4. On the last Setup step, **Turn on automatic sync** and enter the address, username and password it
   shows in Kobo: the form → **Settings → REST Services → Register a new service** (JSON, Basic
   authentication). Each project has its own password.
5. Project → Verify → **Push farmer list to Kobo** uploads `farmers.csv` and redeploys the form.

Readiness submissions land in the review queue (Project → Verify) as pending, by automatic sync or
**Sync from Kobo**; both are safe to repeat. A check that has been accepted or queried is not
changed by later edits in Kobo; the edit is written to the audit log instead.
