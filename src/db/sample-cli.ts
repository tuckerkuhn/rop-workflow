/**
 * Builds an organization's sample project (C5, server/sample-project.ts): a finished, fictional,
 * read-only project. Safe to run again: it finishes a sample that stopped part-way and changes
 * nothing that is already there. With no organization named, it uses the only one there is.
 *
 *   npm run sample                       the organization, when there is one
 *   npm run sample -- <org id>           a named organization
 *   npm run sample -- --rebuild-report   make the sample's released report again (after its content changes)
 */
import { asc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { createSampleProject } from "@/server/sample-project";

async function main() {
  const args = process.argv.slice(2);
  const rebuildReport = args.includes("--rebuild-report");
  const asked = args.find((a) => !a.startsWith("--"));
  const orgs = await db.select({ id: s.organizations.id, name: s.organizations.name }).from(s.organizations).where(asked ? eq(s.organizations.id, asked) : undefined).orderBy(asc(s.organizations.createdAt));
  if (!orgs.length) throw new Error(asked ? `No organization ${asked}.` : "No organization is set up yet.");
  if (!asked && orgs.length > 1) throw new Error(`There are ${orgs.length} organizations: name one.\n${orgs.map((o) => `  ${o.id}  ${o.name}`).join("\n")}`);
  const org = orgs[0];
  // The organization's own name goes in the report as the partner, without "(demo)".
  const code = await createSampleProject(org.id, org.name.replace(/\s*\(demo\)\s*$/i, ""), "sample-cli", { rebuildReport });
  console.log(`Sample project ${code} is ready for ${org.name}.${rebuildReport ? " Its report was made again." : ""}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
