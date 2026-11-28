# Database connections before the 10 January demo (Part 4)

**The problem.** All copies of the app share Supabase's session pooler, which allows 15
connections in total. On 27 Nov Health showed "max clients reached": reads were refused outright.
The live site was set to hold 1 connection per instance as a holding measure.

**Done in the code (branch `build/part4-2026-11-28`).**
- A read refused because the pooler is full now waits a moment and tries again, twice (300 ms,
  then 900 ms), instead of failing the page. A request that has written anything is never run
  twice. (`server/guard` `handle`, tested in `pool-retry.test.ts`.)
- `scripts/load-check.mjs`: opens the busy screens many at once on a **preview** deployment and
  reports failures and timings. It refuses the live site's address.

**For Tucker (a preview deployment, fictional data, `DEMO_SIGN_IN=1`).**
1. Deploy this branch as a preview. Run:
   `PREVIEW_URL=https://<preview>.vercel.app ROUNDS=5 node scripts/load-check.mjs`
   Note the failures and the slowest times. This is the session pooler, as the live site runs.
2. Set `DB_POOL_MODE=transaction` and `DB_POOL_MAX=3` on the preview only, redeploy, run it again.
   The transaction pooler lost replies on 24 Nov; if a read hangs to the 30-second limit or fails,
   it still does, and the session pooler stays.
3. If the transaction pooler holds with no failures: use it on the live site (the same two settings),
   and the 1-connection limit can go up. If it does not: raise the session pool size in Supabase
   (Database, Connection pooling) from 15, which is a setting there, not a code change.
