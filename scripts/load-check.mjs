// Part 4: a load check of the database connections, for a PREVIEW deployment only (never the live
// site). It opens the screens a busy morning opens, many at once, and counts slow and failed answers.
//
//   PREVIEW_URL=https://<preview>.vercel.app USERS=nadia,omar,farida ROUNDS=5 node scripts/load-check.mjs
//
// The preview must have DEMO_SIGN_IN=1 (fictional data only). Run it twice: once with the preview's
// DB_POOL_MODE unset (session pooler, the default), once with DB_POOL_MODE=transaction, and compare.
// Nothing is written: every request is a read.
const base = (process.env.PREVIEW_URL ?? "").replace(/\/$/, "");
if (!/^https:\/\/.+\.vercel\.app$/.test(base) || /rop-workflow\.vercel\.app$/.test(base)) {
  console.error("Set PREVIEW_URL to a preview deployment (https://<something>.vercel.app), never the live site.");
  process.exit(1);
}
const users = (process.env.USERS ?? "nadia,omar,farida,hamid").split(",");
const rounds = Number(process.env.ROUNDS ?? 5);
const code = process.env.PROJECT ?? "A-2027";
const paths = [`/api/projects/${code}/home`, `/api/projects/${code}/field`, `/api/projects/${code}/results`, `/api/projects/${code}/submissions`, `/api/projects/${code}/progress`, `/api/session`];

const results = [];
for (let r = 0; r < rounds; r++) {
  await Promise.all(
    users.flatMap((u) =>
      paths.map(async (p) => {
        const t = Date.now();
        try {
          const res = await fetch(base + p, { headers: { "x-demo-user": u }, signal: AbortSignal.timeout(30_000) });
          results.push({ p, ms: Date.now() - t, ok: res.ok, status: res.status, body: res.ok ? "" : (await res.text()).slice(0, 120) });
        } catch (e) {
          results.push({ p, ms: Date.now() - t, ok: false, status: 0, body: String(e).slice(0, 120) });
        }
      }),
    ),
  );
}
const ms = results.map((x) => x.ms).sort((a, b) => a - b);
const pct = (q) => ms[Math.min(ms.length - 1, Math.floor(q * ms.length))];
const bad = results.filter((x) => !x.ok);
console.log(`${results.length} reads: ${bad.length} failed; median ${pct(0.5)} ms, slowest 5% over ${pct(0.95)} ms, slowest ${ms.at(-1)} ms.`);
for (const b of bad.slice(0, 10)) console.log(`  ${b.status} ${b.p}: ${b.body}`);
process.exit(bad.length ? 1 : 0);
