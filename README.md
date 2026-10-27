# ROP Workflow

An open-source tool for running agricultural development projects from farm preparation
through MEL (monitoring, evaluation & learning) and management follow-up.

> **Status:** untested prototype using **synthetic data only**. See
> [docs/ROP-END-TO-END-WORKFLOW-DRAFT.md](docs/ROP-END-TO-END-WORKFLOW-DRAFT.md) for the workflow design.
> The connected procurement workflow is in
> [docs/ROP-PROCUREMENT-BLUEPRINT.md](docs/ROP-PROCUREMENT-BLUEPRINT.md) (target-state design reconciled
> with ROP Procurement Policy Draft 1.0, which is not approved) and shown at `/procurement`.

## Architecture

| Layer | Tool |
|---|---|
| Field data collection (offline) | [KoboToolbox](https://www.kobotoolbox.org/) + XLSForms (`kobo/`) |
| Web app + API | Next.js (React, TypeScript) on Vercel |
| Database, auth, file storage | Supabase (Postgres) |
| ORM / validation | Drizzle ORM, Zod |

```
KoboCollect / Enketo ──webhook──▶ /api/kobo/webhook ──▶ Supabase Postgres ◀──▶ Next.js UI
```

## Getting started

1. Create a free [Supabase](https://supabase.com) project.
2. `cp .env.example .env.local` and fill in the connection strings and keys.
3. Install and set up the database:

   ```bash
   npm install
   npm run db:generate   # create SQL migrations from src/db/schema.ts
   npm run db:migrate    # apply them
   npm run db:seed       # load one fictional project/season
   npm run dev
   ```

4. Open http://localhost:3000.

## Deploying

Import the GitHub repo into [Vercel](https://vercel.com/new), add the variables from
`.env.example` in Project Settings → Environment Variables, and deploy. Every pull
request gets a preview URL.

### Database migrations

Pushing to `main` automatically applies any new migrations in `drizzle/` to Supabase
(the `migrate` job in `.github/workflows/ci.yml`, after lint/typecheck/build pass).
It requires a repository secret `DIRECT_DATABASE_URL` set to the Supabase **session
pooler** connection string (port 5432). Without the secret, the job is skipped.

To change the schema: edit `src/db/schema.ts`, run `npm run db:generate`, commit the
new file in `drizzle/`, and push.

## Roadmap

- [x] **Phase 0** – Repo, CI, schema, synthetic seed, Kobo webhook stub
- [ ] **Phase 1** – Synthetic MVP screens: season plan → readiness gate → correction/recheck → distribution ↔ expenditure → MEL finding → management action; farmer timeline
- [ ] **Phase 2** – Kobo XLSForms, submission mapping, daily sync, farmer/plot CSV push
- [ ] **Phase 3** – MEL review queue, management action board, optional AI-assisted drafts (MEL validates)
- [ ] **Phase 4** – Roles & approvals, audit, privacy/consent, pilot
- [ ] **Procurement** – Replay one completed Large goods procurement through the payment-ready gate (see blueprint §11); schema waits on the decisions in §12

## License

MIT
