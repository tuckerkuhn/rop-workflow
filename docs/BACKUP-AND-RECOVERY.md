# Backup and recovery

What protects ROP Workflow's records, and what to do when something goes wrong.

## What is backed up

| What | Where | How often | Who |
|---|---|---|---|
| The whole database (projects, results, procurement, HR book, participants) | Supabase backups for project `ntqkwucgmcyvtgjcacff` | Daily on the Pro plan, kept 7 days. Point-in-time recovery is an add-on; turn it on before the pilot ends. | Automatic; check in Supabase → Database → Backups |
| Project records as a file (no personal records) | Downloaded from Settings → Health → Download the records, saved in SharePoint | Monthly, after the monthly review is signed off | An administrator |
| HR book integrity | The daily HR seal (cron at 02:00 UTC) emails a hash of the book to HR_SEAL_TO | Daily | Automatic |
| Proof files: attendance sheets, photos, consent forms, HR files | In the app's database (since SharePoint ran out of space in November 2026), each checked against its fingerprint and locked against change | Included in the database backups above | Automatic |
| Older evidence documents | SharePoint (procurements and older results link to them) | SharePoint's own retention | ROP IT |
| Code | GitHub, tuckerkuhn/rop-workflow | Every save | Automatic |

## Before the pilot demo (10 December 2026)

1. In Supabase, confirm the plan includes daily backups, and turn on point-in-time recovery.
2. Download the records once from Settings → Health and save the file in SharePoint.
3. Restore last night's backup into a new Supabase project once, to prove it works, then delete that project.

## If records are lost or damaged

1. Stop changes: tell staff not to use the app.
2. Find when it happened: Progress → Audit trail shows every change with who and when.
3. Restore in Supabase to just before that time (point-in-time recovery), or to last night's backup.
4. Re-enter anything recorded since then, using the audit trail and the latest export to see what it was.
5. Record what happened in the lessons record.

## Limits and monitoring

- Server errors are kept in the audit trail and shown on Settings → Health; Vercel keeps the full logs.
- AI runs are limited per person per hour (AI_PER_PERSON_HOUR, default 20) and for everyone per day (AI_PER_DAY, default 300).
- Changes are limited per address per minute (WRITES_PER_MINUTE, default 120).
