"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Initials, useSession } from "@/components/app/session";
import { LogoMark } from "@/components/logo";
import { users } from "@/lib/demo";
import { fieldRoleLabel } from "@/lib/field";
import { roleLabel } from "@/lib/procurement";

/** Landing page: pick who you are. No credentials in this prototype. */
export function SignIn() {
  const { user, signIn } = useSession();
  const router = useRouter();
  const [tab, setTab] = useState<"employee" | "donor">("employee");
  const people = users.filter((u) => u.kind === tab);

  const go = (id: string) => {
    signIn(id);
    router.push("/home");
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <section className="relative flex flex-col justify-between overflow-hidden bg-deep px-6 py-10 text-deep-ink sm:px-12">
        <svg aria-hidden viewBox="0 0 600 600" className="pointer-events-none absolute -bottom-24 -right-24 h-[120%] w-auto text-ochre opacity-15">
          {Array.from({ length: 14 }, (_, i) => (
            <path key={i} d={`M 0 ${80 + i * 34} C 180 ${40 + i * 34}, 380 ${130 + i * 34}, 600 ${60 + i * 34}`} fill="none" stroke="currentColor" />
          ))}
        </svg>
        <div className="relative flex items-center gap-3">
          <LogoMark className="h-9 w-9" />
          <span className="font-display text-lg">Roots of Peace · Workflow</span>
        </div>
        <div className="relative my-16 max-w-md">
          <h1 className="font-display text-5xl leading-[1.02] tracking-tight text-balance">One place for the work, from field to file.</h1>
          <p className="mt-5 leading-relaxed opacity-75">
            Field activities, procurement, documents and approvals in one record. Sign in to see what is waiting on you and what is coming next.
          </p>
        </div>
        <p className="relative text-xs opacity-60">
          Prototype with fictional people and records. <Link href="/about" className="underline underline-offset-2">About this project</Link>
        </p>
      </section>

      <section className="flex flex-col justify-center px-6 py-10 sm:px-12">
        <div className="mx-auto w-full max-w-lg">
          <h2 className="font-display text-3xl tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm text-muted">Demo mode: choose a person. No password is needed yet.</p>

          {user && (
            <button
              type="button"
              onClick={() => router.push("/home")}
              className="mt-6 flex w-full items-center gap-3 rounded-2xl border-2 border-forest bg-surface px-4 py-3 text-left"
            >
              <Initials name={user.name} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">Continue as {user.name}</span>
                <span className="block text-xs text-muted">{user.title}</span>
              </span>
              <span className="text-forest">→</span>
            </button>
          )}

          <div role="tablist" className="mt-6 grid grid-cols-2 rounded-full bg-sunken p-1 text-sm">
            {(
              [
                ["employee", "Staff"],
                ["donor", "Donor"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                type="button"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`rounded-full py-2 transition ${tab === k ? "bg-surface font-semibold shadow-sm" : "text-muted"}`}
              >
                {label}
              </button>
            ))}
          </div>

          <ul className="mt-4 space-y-2">
            {people.map((u) => {
              const does = [...u.field.map(fieldRoleLabel), ...u.procurement.map(roleLabel)].filter((r) => r.toLowerCase() !== u.title.toLowerCase());
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => go(u.id)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left transition hover:-translate-y-0.5 hover:border-forest"
                  >
                    <Initials name={u.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{u.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {u.title}
                        {u.kind === "donor" ? ` · ${u.org}` : does.length ? ` · ${does.join(", ")}` : ""}
                      </span>
                    </span>
                    <span aria-hidden className="text-muted">
                      →
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-6 text-xs leading-relaxed text-muted">
            In production this would use your organization account. Donors see project progress, photos and success stories, not procurement files.
          </p>
        </div>
      </section>
    </div>
  );
}
