/**
 * Organization plans, set by hand until billing exists.
 *   npm run plan                          show each organization's plan
 *   npm run plan -- paid                  put the only organization on the paid plan
 *   npm run plan -- free --org "Name"     put a named organization on the free plan
 */
import { isPlan } from "@/lib/plans";
import { listPlans, setPlan } from "@/server/plans";

const [cmd, ...rest] = process.argv.slice(2);
const org = rest.indexOf("--org") >= 0 ? rest[rest.indexOf("--org") + 1] : undefined;

async function main() {
  if (!cmd) return console.log((await listPlans()).join("\n") || "No organizations. Run npm run db:seed.");
  if (!isPlan(cmd)) throw new Error("Usage: npm run plan -- free|paid [--org <name>]");
  console.log(`${await setPlan(cmd, org)} is now on the ${cmd} plan.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
