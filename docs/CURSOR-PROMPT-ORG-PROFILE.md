# Cursor prompt: one install per organization

Written 2026-11-09 against `main` at commit `2a19f0b`. Run this after the 15 items in `docs/CURSOR-PROMPT-2026-11-09.md`, or before a partner organization's real data goes in, whichever comes first.

---

You are working in the `rop-workflow` repo. Decision made: **each organization gets its own install** (its own Supabase database and its own Vercel site, from this same repo). We are not building a shared multi-organization platform now.

The goal: a second organization can stand up its own install and see nothing of Roots of Peace in it unless it chooses to. ROP becomes the first organization profile, not the hardcoded default.

## How to work

1. Step 1 is an audit with **no code changes**. Stop after it and wait for my go.
2. After that, one branch per step, named `feature/<short-name>`, in order. Finish, show me, merge, then start the next.
3. ROP's own install must behave exactly as it does today after every step. Nothing ROP uses is removed. It moves from code into ROP's profile.
4. Keep the house rules: four languages through i18n, voice rules, personal data rules in `docs/DATA-PROTECTION.md`, audit log on every change, schema changes through `src/db/schema.ts` and `npm run db:generate`, synthetic data only in seeds.
5. Lint, typecheck and build pass before you call a step done.

## Do not do

- Do not add organization checks to every query or build cross-organization sign-up. One install holds one organization.
- Do not remove the `organization_id` columns that exist. Leave them for later.
- Do not remove or hide any feature. HR, payroll, procurement, lens review, Timeline, Resources, market windows and opportunities all stay.

---

## Step 1. Audit (no code)
**Output:** `docs/ORG-TWO-AUDIT.md`

List everything in the code that is specific to Roots of Peace, as one table: file, line, what it is, which group below it belongs to and how you would move it to a profile. Search for at least: `Roots of Peace`, `ROP`, `ACRP`, `UNDP`, `CBARD`, `ARLP`, `AMP`, `Kandahar`, `Helmand`, `AFN`, `Afghani`, `rootsofpeace`, `SharePoint`, `NetSuite`, `BambooHR`, `ADP`.

Groups:
- **Identity:** name, logo, addresses, email domain, `ORG_ID = "rop"` in `src/lib/demo.ts`, share pages, about page
- **Voice:** `src/lib/voice.ts` and every prompt that uses it; the ROP description in `src/server/opportunities-store.ts`
- **Reports:** the section list in `src/lib/qpr.ts` (UNDP ACRP headings), the due date fixed at the 10th in `src/server/next-report.ts`, calendar quarters in `src/lib/results.ts`, the single format in `src/lib/report-formats.ts`, the FACE form
- **Money:** `AFN_PER_USD` and the `Currency` type in `src/lib/demo.ts`, the default currency in `src/lib/bva.ts`, the ICE workbook reader
- **Donor rules:** `src/lib/donors.ts` (three profiles citing ROP's agreements)
- **Policy:** `src/lib/procurement.ts`, `procurement-docs.ts`, `policy.ts`, `payments.ts`, `authority.ts`
- **People:** `hr-store.ts`, `payroll.ts`, `timesheet.ts`, `expense.ts`, `leave.ts`, `bamboo-import.ts`
- **Data:** `src/db/acrp-official-targets.ts`, `acrp-fix-annual-report-results.ts`, anything in seeds that is real rather than fictional
- **Content:** `src/lib/resources.ts`, `market-windows.ts`

Also list:
- every place that picks "the first organization in the database" (for example `project-store.ts`, `staff.ts`, `plans.ts`, `policy-store.ts`, `org-settings-store.ts`, `people-admin.ts`). In a one-organization install this is acceptable. Say whether each is safe or should read the profile.
- every setting that is an environment variable today and should be an in-app setting.
- anything you found that I did not list.

End the audit with a count per group and your proposed order of work. Then stop.

## Step 2. The organization profile
**Branch:** `feature/org-profile`

One profile per install, stored in the existing organization settings (`org-settings-store.ts`, `organization_state`), editable by an organization admin under Settings and written to the audit log on every change.

Fields: organization name, short name, logo, country, default language, languages offered, default currency and the currencies it works in, exchange rates with a date, reporting calendar (calendar year or a fiscal year start month), default report due day, sender email name.

Replace each hardcoded identity and money value found in the audit with a read from the profile. ROP's install gets its current values through a seeded ROP profile.

## Step 3. Voice per organization
**Branch:** `feature/org-voice`

Move the rules in `src/lib/voice.ts` into the profile as that organization's voice: a short description of who they are, how they write and words to avoid. Keep a neutral default voice (plain, direct, specific) for organizations that set nothing. Every AI prompt that writes for people reads the profile's voice. ROP's Brand Foundation voice becomes ROP's profile value, unchanged.

## Step 4. Report templates
**Branch:** `feature/report-templates`

Turn the fixed section list in `src/lib/qpr.ts` into a template: ordered sections with heading, help text and whether AI may draft it. Ship two: the current UNDP ACRP template, unchanged, and a short general template (summary, progress against targets, spending, challenges, next period, story). A project picks its template per donor. Due day and period come from the profile and the project's donor settings, not from code. The checks in `qpr.ts` must work with any template.

## Step 5. Donor rules and policy as data
**Branch:** `feature/rules-as-data`

Move the three profiles in `src/lib/donors.ts` and the ROP thresholds in the procurement and policy files into records the organization owns. Split what is generally true of a donor (kept as a starter library any install can load) from what cites ROP's own agreements (ROP's install only). A new install starts with the starter library and an empty policy that an admin fills in or loads from documents.

## Step 6. Optional areas
**Branch:** `feature/optional-areas`

Let an admin turn whole areas on or off for the install: People (HR, payroll, leave, timesheets, expenses), Procurement, Opportunities, Market windows, Photos and posts. Off means hidden from navigation and Home, with data kept. All are on for ROP. A new install starts with Projects, Results, Budget and Reports on and the rest off.

## Step 7. A clean new install
**Branch:** `feature/new-install`

- `npm run db:seed` no longer loads anything of ROP's. ROP's data loads only through a separate, clearly named script.
- A first-run screen on an empty database: create the organization profile and the first admin, then go to project setup.
- Rewrite the install section of `README.md` as steps a technical volunteer at a small organization could follow in under an hour: Supabase, Vercel, environment variables, first run.
- Add `docs/NEW-INSTALL-CHECK.md`: a checklist that proves the install shows no ROP name, logo, donor, currency or policy anywhere.

## Step 8. AI cost per install
**Branch:** `feature/ai-cost`

- Choose the model by job: the strongest model only for report drafting and setup from documents; a smaller, cheaper model for checks, flags, mapping suggestions and translation. Put the choice in one file.
- Each install uses its own `ANTHROPIC_API_KEY`. Show month-to-date AI runs on the health page.
- Keep the per-person and per-day limits in `src/server/limits.ts`, with the numbers editable by an admin.

## Done when

On a fresh database with a new organization called "Asociación Prueba", working in Spanish and quetzales, I can set up a project from documents, accept results, import spending, write and export a report with the general template, and I never see Roots of Peace, UNDP, ACRP or Afghani anywhere. And ROP's own install looks and works exactly as it did before.

Start with Step 1 only. No code until I say go.
