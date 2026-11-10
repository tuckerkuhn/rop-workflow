# Build list, November 2026

The order agreed on 9 Nov 2026, from the four-additions, five-streamlines, six-UX-fixes prompt, plus C7. One branch per item, shown and merged before the next.

| # | Item | Branch | Status |
|---|---|---|---|
| A1 | Report pre-flight check | `feature/report-preflight` | Merged 9 Nov |
| A2 | Click any number, see its proof | `feature/number-to-proof` | Merged 9 Nov |
| A3 | Three uploads to a running project | `feature/setup-three-uploads` | Merged 9 Nov |
| A4 | Kobo question-to-indicator suggestions | `feature/kobo-mapping-suggest` | Merged 9 Nov |
| B1 | Review queue: accept the clean, review the flagged | `feature/review-queue-batch` | Merged |
| B2 | Solo mode for sign-offs | `feature/solo-signoff` | Merged |
| B3 | Spend import from any spreadsheet | `feature/spend-import-generic` | Merged |
| B4 | Kobo nightly reconcile | `feature/kobo-nightly-reconcile` | Merged 10 Nov (via surge). Tested by hand on SSOP-2027's sandbox form 10 Nov: new, edited and deleted submissions all caught, after fixing duplicates on edit. Run by hand: `npm run kobo:reconcile -- <code>` |
| B5 | One source of truth for the docs | `feature/docs-current` | Merged 10 Nov (via surge) |
| C1 | Home: Approve, Fix, Due | `feature/home-three-buckets` | Merged 10 Nov (via surge) |
| C2 | Project manager first | `feature/pm-path` | Merged 10 Nov (via surge) |
| C3 | Progress: one row per target | `feature/progress-rows` | Merged 10 Nov (via surge) |
| C4 | Plain words | `feature/plain-words` | Merged 10 Nov: Target, Result, spending and "How many" in the app's own screens, in four languages; the report's checks translated. Left for later: MEL, Pre-flight, claim check, query |
| C5 | A sample project for every new organization | `feature/sample-project` | Merged 10 Nov. SAMPLE-446CEE built for ROP (`npm run sample`) |
| C6 | Every AI flag says why | `feature/flag-reasons` | Merged 10 Nov (via surge) |
| C7 | "Why we ask" help on sensitive fields | `feature/field-help` | Merged 10 Nov: Results, Stories, Weekly and farmer photos. Left out (do-not-touch list): HR forms, the photo library's consent form |

## Decisions, 10 Nov 2026

- **Plain words (C4):** one word, Target; "How many" for the number beside it; "market window" for the window a plan starts from; Approve for period and plan sign-offs, Accept for single results. Donor exports, AI prompts and lens review keep their words.
- **Access:** Spencer Baird added as an administrator (programming support); listed in DATA-PROTECTION.md with Tucker and Daniel.

- **Sample project (C5):** a fictional "Highland Apricot Value Chain" in an unnamed province, read-only for everyone, left out of every total, hidden by an administrator in Settings. Projects now have a kind (real, sample, sandbox); SFTP-2026 and SSOP-2027 are sandboxes, left out of totals but writable. Still to decide: leave the sample out of the time, expense, payroll and bill charge lists (on the do-not-touch list).
- **Kobo results** are dated by the form's own date question (install_date, training_date...) when it has one, else the day KoboToolbox received the submission. An edit in KoboToolbox updates its result in place.
- **Open:** the Weekly photo caption suggests naming the village, which the rest of the app says never to do.

- **Surge branch reviewed and merged** to main (`09ca5a2`), with fixes: farmer photos by plan (800px free, 2000px paid), sample records reviewable again, the Kobo reconcile survives a failed run row, Home's report tile and rows translated.
- **Overspend reason** is chosen from a list (prices or exchange rate, work brought forward, approved realignment, realignment waiting for the donor, coding error, other) with a note, and belongs to the budget line, not a quarter. A released report keeps its own.
- **Budget flexibility** is per donor in policy (`budgetRevisionPct`): UNDP/ACRP 20% per line (RPA Art. 3.5); ROP starting value 10% where a donor sets none. The 0.5% "explain it" flag is unchanged.
- **Names for the AI:** story drafts (with consent) and post drafts keep first names; last names and villages are removed. Other AI jobs remove whole names.

## Decisions, 9 Nov 2026

- **Report deadlines** come from policy: the donor's rule (`quarterlyReportDays`, `annualReportDays`; UNDP quarterly 15 days, article to cite), or a "Report deadline" milestone in Tasks, which wins for its period. Every deadline keeps time for the internal review (`reviewDays`, ROP starting value 5 days): the team aims for the earlier date.
- **A near or missed deadline** is a warning at the top of pre-flight, not a blocker.
- **Translation:** pre-flight's screen and its new checks are in all four languages now; the quarterly report's older check sentences move in C4, so the wording is settled and translated once.
- **Sandbox:** a fictional project, `SFTP-2026` ("SANDBOX: fictional test project (not real data)"), in the live database for testing. Created 9 Nov 2026 with Tucker's approval.

## C7. "Why we ask" help on sensitive fields

**Branch:** `feature/field-help`

A small "?" after a field opens up to three short lines:

- **Why we ask:** what the field is for, and who uses it.
- **How we protect it:** the ethical choices made for it (who sees it, what never leaves the app, what the AI never gets).
- **Source:** where the requirement comes from (donor template and section, ROP policy, law).

A line with nothing real to say is left out, never filled.

Only where it matters:

- fields that collect personal or sensitive data (sex, age, location and GPS, phone, consent, photos of people, HR);
- values the AI proposes (A3 extraction, A4 mappings, B3 column mapping), where the source line is the point;
- fields a donor requires that look like extra work to a new user.

Plain fields (a date, a title, a note) get none. Where a single value came from is not this help's job: that is A2 (number to proof) and A3 (each extracted value's source).

All the text lives in one register, keyed by field, in the four languages, and the same register is the "what we collect and why" part of `docs/DATA-PROTECTION.md`, so the policy and the screens cannot drift apart. One shared component; no field gets its own.

**Done when:** every personal-data field in Record, Results, Stories, Photos and HR has its "?", each line is true to the code, and the data protection document is generated from the same register.
