# ROP Workflow

A web app for running a development project from its agreement to its donor report, so that every reported number opens the records and proof behind it. Built for Roots of Peace; the pilot project is ACRP in Afghanistan.

**Status, November 2026:** a working app on a live database, in pilot with two people. It is not finished. What is built, partly built and planned is in [docs/CURRENT-STATE.md](docs/CURRENT-STATE.md). The original design is [docs/ROP-PROJECT-HARNESS-BUILD-SPEC-v1.md](docs/ROP-PROJECT-HARNESS-BUILD-SPEC-v1.md); where the two differ, CURRENT-STATE is what exists.

## What it does

- **Set up a project** from three uploads: the agreement, the logframe and the budget. The app proposes targets, budget lines, report deadlines and donor rules, each with where it came from. A person confirms each section.
- **Record results with proof**, by hand or from KoboToolbox forms. A result counts only after the MEL owner accepts it. Fixed rules flag possible double counts, figures that do not add up and missing proof.
- **Follow progress**: one row per target, with its status, and one tap to the records and proof.
- **Compare budget and spending** from Finance's monthly workbook or any accounting export.
- **Write the donor report**: quarterly, annual and the FACE form. A pre-flight check lists what blocks the report and who fixes it. Release locks the copy the donor receives. An evidence pack holds the proof and the audit log for the period.
- **Buy things by the rules**: a procurement calendar and step-by-step purchases with the checks ROP's policy and the donor's rules require.
- **People**: an HR record, leave, timesheets, expenses, payroll preparation, onboarding and offboarding.

AI reads documents, drafts text, checks text against the evidence and suggests mappings. It never decides: a named person confirms everything, and every AI run and every change is in the audit log. People's names and villages are replaced before notes go to the AI ([docs/DATA-PROTECTION.md](docs/DATA-PROTECTION.md)).

The interface is in English, Spanish, Dari and Pashto. It is made for a phone first.

## Where things are

| In the app | Address |
|---|---|
| Home: what is waiting on you, the next report | `/home` |
| Work: tasks, activities, procurement calendar, bills, suppliers, close-out, opportunities | `/work` |
| Progress: targets, results and proof, monthly review, budget | `/progress` |
| Reports: weekly update, quarterly, annual, FACE, stories, photos, pre-flight | `/progress/report`, `/progress/preflight` |
| Organization: people, payroll, settings, policy, health | `/organization`, `/settings` |
| Project setup | `/setup` |
| A donor's read-only link to a released report | `/share/<code>/<token>` |

## How it is built

| Layer | Tool |
|---|---|
| Web app and API | Next.js (React, TypeScript) on Vercel |
| Database and sign-in | Supabase (Postgres, Auth) |
| Data access and input checks | Drizzle ORM, Zod |
| Field data collection, offline | KoboToolbox and KoboCollect |
| AI | Claude, through one module, `src/server/ai.ts` |
| Tests | Vitest (`src/lib/__tests__`) |

Code layout: `src/lib` holds the rules with no database in them (results, budget, pre-flight, policy, procurement); `src/server` holds the database and AI code; `src/app/api` holds the routes, which all go through `src/server/guard.ts`; `src/components` holds the screens.

## Run it on a laptop

1. Create a Supabase project. Use one with fictional data only.
2. `cp .env.example .env.local` and fill it in. Never commit `.env.local`.
3. Then:

   ```bash
   npm install
   npm run db:migrate    # applies the migrations in drizzle/
   npm run db:seed       # loads a fictional project
   npm run dev
   ```

4. Open http://localhost:3000.

`DEMO_SIGN_IN=1` lets you pick a fictional person without a password. It is for a laptop on fictional data. Never set it on the live site.

Before you push: `npm run lint && npm run typecheck && npm test && npm run build`.

## Deploying

The live site is on Vercel. **Pushing to `main` applies any new migration in `drizzle/` to the live database** (the `migrate` job in `.github/workflows/ci.yml`, after the checks pass). So work on a branch, and merge to `main` only what you mean to go live.

To change the schema: edit `src/db/schema.ts`, run `npm run db:generate`, and commit the new file in `drizzle/`. Migrations add; they do not drop or rename.

Scheduled jobs are in `vercel.json` and need `CRON_SECRET` set on the server.

## More

- [docs/CURRENT-STATE.md](docs/CURRENT-STATE.md): every feature area, its status and its main files.
- [docs/DATA-PROTECTION.md](docs/DATA-PROTECTION.md): what protects people's data, and what to do if it leaks.
- [docs/BACKUP-AND-RECOVERY.md](docs/BACKUP-AND-RECOVERY.md)
- [docs/BUILD-LIST-2026-11.md](docs/BUILD-LIST-2026-11.md): what is being built now.
- [docs/AUDIT-2026-11-09.md](docs/AUDIT-2026-11-09.md): an audit of the whole app, with what was fixed in [docs/SURGE-LOG.md](docs/SURGE-LOG.md).

## License

MIT
