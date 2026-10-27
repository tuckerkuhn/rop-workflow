# KoboToolbox forms

XLSForm sources for field data collection (server: https://kf.kobotoolbox.org).
Field staff use KoboCollect (offline, Android) or Enketo web forms.

Planned forms (Phase 2):

| Form | Workflow step | Writes to |
|---|---|---|
| `training_attendance.xlsx` | 2. Train farmers | `training_attendance`, `evidence` |
| `readiness_check.xlsx` | 4. Verify readiness / 5b recheck | `readiness_checks`, `evidence` |
| `input_distribution.xlsx` | 5a. Distribute inputs | `input_distributions`, `evidence` |
| `field_visit.xlsx` | 6. Plant and follow up | `field_visits`, `evidence` |

Conventions:

- Every form has a hidden `project_code` field and selects farmers/plots with
  `select_one_from_file farmers.csv` / `plots.csv`. The app pushes those CSVs to
  each form as media files so field staff pick real IDs instead of typing them.
- Every form is multi-language (`label::English (en)`, `label::Kiswahili (sw)`, ...).
- Submissions reach the app via a Kobo REST Service pointing at
  `https://<your-app>.vercel.app/api/kobo/webhook` with Basic auth.
