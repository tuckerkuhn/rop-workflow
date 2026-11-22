/**
 * Organization plans, set by hand until billing exists.
 *   npm run plan                              show each organization's plan and trial
 *   npm run plan -- paid                      put the only organization on the paid plan
 *   npm run plan -- free --org "Name"         put a named organization on the free plan
 *   npm run plan -- trial                     a free trial of the paid plan (2 months) for the only organization
 *   npm run plan -- trial 2 --all             a 2-month trial for every organization
 *   npm run plan -- end-trial --org "Name"    end a trial now
 */
import { isPlan, TRIAL_MONTHS } from "@/lib/plans";
import { endTrial, listPlans, setPlan, startTrial } from "@/server/plans";

const [cmd, ...rest] = process.argv.slice(2);
const org = rest.indexOf("--org") >= 0 ? rest[rest.indexOf("--org") + 1] : undefined;
const all = rest.includes("--all");

async function main() {
  if (!cmd) return console.log((await listPlans()).join("\n") || "No organizations. Run npm run db:seed.");
  if (cmd === "trial") {
    const months = Number(rest[0] !== undefined && /^\d+$/.test(rest[0]) ? rest[0] : TRIAL_MONTHS);
    if (!(months >= 1 && months <= 24)) throw new Error("A trial is 1 to 24 months.");
    for (const o of await startTrial(months, { name: org, all })) console.log(`${o.name}: paid-plan trial until ${o.until.slice(0, 10)}.`);
    return;
  }
  if (cmd === "end-trial") return console.log(`Trial ended for ${(await endTrial({ name: org, all })).join(", ")}.`);
  if (!isPlan(cmd)) throw new Error("Usage: npm run plan -- free|paid|trial [months]|end-trial [--org <name> | --all]");
  console.log(`${await setPlan(cmd, org)} is now on the ${cmd} plan.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
