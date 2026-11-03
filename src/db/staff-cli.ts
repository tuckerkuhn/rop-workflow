/**
 * Who can sign in.
 *   npm run staff -- seed                                   demo people as staff profiles (no emails)
 *   npm run staff -- add --email you@org --person tucker    give an email access as that person
 *   npm run staff -- add --email d@fdn.org --person ana --name "Ana Ruiz" --title "Program officer" --org "Foundation" --like elena
 *   npm run staff -- remove --person ana                    turn access off (history is kept)
 */
import { addPerson, removePerson, seedStaff } from "@/server/staff";

const [cmd, ...rest] = process.argv.slice(2);
const arg = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

async function main() {
  if (cmd === "seed") return console.log(`Staff profiles ready for ${await seedStaff()} demo people.`);
  if (cmd === "add") {
    const email = arg("email");
    const person = arg("person");
    if (!email || !person) throw new Error("Usage: npm run staff -- add --email <email> --person <id> [--name --title --org --like <id>]");
    const r = await addPerson({ email, person, name: arg("name"), title: arg("title"), org: arg("org"), like: arg("like") });
    return console.log(`${r.email} can sign in as ${r.person} (${r.account}).`);
  }
  if (cmd === "remove") {
    const person = arg("person");
    if (!person) throw new Error("Usage: npm run staff -- remove --person <id>");
    await removePerson(person);
    return console.log(`Access turned off for ${person}.`);
  }
  throw new Error("Commands: seed, add, remove. See the top of src/db/staff-cli.ts.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
