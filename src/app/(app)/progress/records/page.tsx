import { redirect } from "next/navigation";

/** The old all-in-one project record is gone: every part of it has its own page, listed on Projects. */
export default function Page() {
  redirect("/project");
}
