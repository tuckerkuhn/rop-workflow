/**
 * The nightly KoboToolbox reconcile (B4, server/kobo-reconcile.ts), run by hand for the projects
 * named: the same sync and the same audit row as the nightly run, marked "by hand". Name at least
 * one project, so a test run never touches a real project by accident.
 *
 *   npm run kobo:reconcile -- SSOP-2027
 */
import { reconcileAll, reconcileLine } from "@/server/kobo-reconcile";

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!only.length) throw new Error("Name the project(s) to reconcile, e.g. npm run kobo:reconcile -- SSOP-2027");
  const runs = await reconcileAll({ only, by: "by hand" });
  const missing = only.filter((c) => !runs.some((r) => r.project === c));
  for (const r of runs) console.log(`${r.project}: ${reconcileLine(r)}`);
  if (missing.length) console.log(`Not connected to KoboToolbox: ${missing.join(", ")}`);
  if (runs.some((r) => !r.ok)) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
