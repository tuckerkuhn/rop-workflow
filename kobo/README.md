# KoboToolbox forms

XLSForm sources for field data collection (server: https://kf.kobotoolbox.org).
Field staff use KoboCollect (offline, Android) or Enketo web forms.

| Form | Workflow step | Status |
|---|---|---|
| `readiness_check.xlsx` | Verify readiness / recheck | **Built.** Accepted results move the farmer in Field activities. |
| `training_attendance.xlsx` | Train farmers | Planned |
| `input_distribution.xlsx` | Distribute inputs | Planned |
| `field_visit.xlsx` | Plant and follow up | Planned |

Conventions:

- Every form has a hidden `project_code` (e.g. `A-2027`) so submissions attach to the right project.
- Farmers are picked from `farmers.csv` (form media pushed by the app): **farmer ID, village and
  household-head initials. No names on devices.**
- Labels in English, Dari and Pashto. **The Dari and Pashto labels are drafts; have a native
  speaker review them before field use.**
- Each submission is stored once, keyed on Kobo's `_uuid`, and waits in the project's review
  queue (Project → Verify). Nothing changes in Field activities until the MEL owner accepts it.

## Setting up the readiness check

1. Rebuild the form if you change it: `python3 kobo/build_readiness_form.py`.
2. In Kobo: **New → Upload an XLSForm** → `kobo/readiness_check.xlsx` → **Deploy**.
3. Copy the form's asset UID from its URL (`.../#/forms/<UID>/...`) into `.env.local` as
   `KOBO_READINESS_ASSET_UID`, with `KOBO_API_TOKEN` from Kobo → Account settings → Security.
4. In the app, sign in as Omar (MEL owner), open Project → Verify and click
   **Push farmer list to Kobo**. This uploads `farmers.csv` and redeploys the form.
5. Fill in the form (Kobo → the form → **Open** the web form), then click **Sync from Kobo**.

Submissions reach the app in two ways, both safe to repeat:

- **Sync from Kobo** (manual, works on localhost): pulls every submission on the form.
- **Webhook** (once the app is reachable from the internet): a Kobo REST Service pointing at
  `https://<your-app>/api/kobo/webhook` with Basic auth (`KOBO_WEBHOOK_USER` / `KOBO_WEBHOOK_PASSWORD`).
