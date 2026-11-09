"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser, useSession } from "@/components/app/session";
import { shrink } from "@/components/people/expense-page";
import { Pill, TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import type { Receipt } from "@/lib/expense";
import { CONSENT_HOW, CONSENT_USES, HOW_LABEL, USE_LABEL, type StoryAction, type StoryInput } from "@/lib/stories";
import type { storiesView } from "@/server/stories-store";

/**
 * Success stories: the person's consent first, then interview notes and the records the story is
 * about; Claude drafts it from those facts only; MEL or a programme lead approves it; an approved
 * story with consent for donor reports can become the quarter's Human Interest Story.
 */

type View = Awaited<ReturnType<typeof storiesView>>;
type StoryRow = View["stories"][number];
const input = "mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2 text-base";
const today = () => new Date().toISOString().slice(0, 10);
const quarterNow = () => {
  const d = today();
  return `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
};
const blank = (): StoryInput => ({ title: "", notes: "", text: "", photos: [], consent: null, links: [] });

function Editor({ v, start, user, act, onClose }: { v: View; start: StoryRow | null; user: string; act: (a: StoryAction, msg: string) => Promise<string | undefined>; onClose: () => void }) {
  const [s, setS] = useState<StoryInput>(() => (start ? { ...blank(), ...start } : blank()));
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [id, setId] = useState(start?.id);
  const set = <K extends keyof StoryInput>(k: K, val: StoryInput[K]) => setS({ ...s, [k]: val });
  const upload = async (list: FileList | null, forConsent = false) => {
    if (!list) return;
    setBusy("upload");
    setErr("");
    try {
      for (const file of Array.from(list)) {
        const body = new FormData();
        body.append("file", await shrink(file));
        const r = await fetch("/api/files", { method: "POST", body, headers: { "x-demo-user": user } });
        const out = (await r.json()) as Receipt & { error?: string };
        if (!r.ok) throw new Error(out.error ?? "Upload failed.");
        if (forConsent) setS((cur) => ({ ...cur, consent: cur.consent ? { ...cur.consent, form: out.hash } : cur.consent }));
        else setS((cur) => ({ ...cur, photos: [...cur.photos, { hash: out.hash, name: out.name, type: out.type, size: out.size, caption: "" }].slice(0, 8) }));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };
  const save = async () => {
    setErr("");
    if (s.title.trim().length < 3) return setErr("Give it a working title.");
    setBusy("save");
    try {
      const got = await act({ action: "save", ...(id ? { id } : {}), story: { ...s, firstName: s.firstName?.trim() || undefined } }, "Saved.");
      if (got) setId(got);
      return got;
    } finally {
      setBusy("");
    }
  };
  const approved = start?.status === "approved";
  return (
    <section className="mt-4 rounded-2xl border border-line bg-surface p-4">
      <h2 className="font-display text-xl">{start ? "Story" : "New story"}</h2>
      <fieldset className="mt-3 rounded-xl bg-paper p-3" disabled={approved}>
        <legend className="px-1 text-sm font-semibold">1. Consent: before anything else</legend>
        {s.consent ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              How it was given
              <select className={input} value={s.consent.how} onChange={(e) => set("consent", { ...s.consent!, how: e.target.value as (typeof CONSENT_HOW)[number] })}>
                {CONSENT_HOW.map((h) => (
                  <option key={h} value={h}>
                    {HOW_LABEL[h]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Taken by (staff)
              <input className={input} value={s.consent.takenBy} onChange={(e) => set("consent", { ...s.consent!, takenBy: e.target.value })} />
            </label>
            <label className="text-sm">
              Date
              <input type="date" className={input} max={today()} value={s.consent.date} onChange={(e) => set("consent", { ...s.consent!, date: e.target.value })} />
            </label>
            <div className="text-sm">
              It covers
              {CONSENT_USES.map((u) => (
                <label key={u} className="mt-1 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={s.consent!.uses.includes(u)}
                    onChange={(e) => set("consent", { ...s.consent!, uses: e.target.checked ? [...s.consent!.uses, u] : s.consent!.uses.filter((x) => x !== u) })}
                  />
                  {USE_LABEL[u]}
                </label>
              ))}
            </div>
            <label className="text-sm sm:col-span-2">
              The signed or thumbprinted form (photo or scan, optional)
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="mt-1 block text-sm" onChange={(e) => void upload(e.target.files, true)} />
              {s.consent.form && <span className="text-xs text-leaf">Form attached.</span>}
            </label>
          </div>
        ) : (
          <button type="button" className={quietBtn} onClick={() => set("consent", { how: "written", uses: ["report"], date: today(), takenBy: "" })}>
            Record the person&rsquo;s consent
          </button>
        )}
        <p className="mt-2 text-xs text-muted">Explain in their language what the story is for and who will see it. A story is only used where its consent allows, and only with their first name.</p>
      </fieldset>

      <fieldset className="mt-3 grid gap-3 sm:grid-cols-2" disabled={approved}>
        <legend className="mb-1 text-sm font-semibold">2. The person and what happened</legend>
        <label className="text-sm sm:col-span-2">
          Working title
          <input className={input} value={s.title} onChange={(e) => set("title", e.target.value)} />
        </label>
        <label className="text-sm">
          First name (only if they agreed to be named)
          <input className={input} value={s.firstName ?? ""} onChange={(e) => set("firstName", e.target.value)} />
        </label>
        <label className="mt-6 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!s.woman} onChange={(e) => set("woman", e.target.checked)} /> A woman (for the report&rsquo;s gender section)
        </label>
        <label className="text-sm">
          District
          <input className={input} value={s.district ?? ""} onChange={(e) => set("district", e.target.value)} />
        </label>
        <label className="text-sm">
          Province
          <input className={input} value={s.province ?? ""} onChange={(e) => set("province", e.target.value)} />
        </label>
        <label className="text-sm sm:col-span-2">
          Interview notes: what they said, in their words where possible (Dari and Pashto are fine)
          <textarea className={input} rows={5} value={s.notes} onChange={(e) => set("notes", e.target.value)} />
        </label>
        <div className="text-sm sm:col-span-2">
          Records the story is about
          <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto rounded-xl border border-line bg-paper p-2 text-xs">
            {v.sources.slice(0, 60).map((x) => (
              <li key={x.id}>
                <label className="flex gap-2">
                  <input type="checkbox" checked={s.links.includes(x.id)} onChange={(e) => set("links", e.target.checked ? [...s.links, x.id] : s.links.filter((y) => y !== x.id))} />
                  <span>
                    {x.date} · {x.kind === "update" ? "weekly item" : "result"} · {x.text}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        <div className="text-sm sm:col-span-2">
          Photos
          <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="mt-1 block text-sm" onChange={(e) => void upload(e.target.files)} />
          {s.photos.map((p, k) => (
            <div key={p.hash} className="mt-2 flex gap-2">
              <input
                className={input}
                placeholder="Caption: what, where (district)"
                value={p.caption}
                onChange={(e) =>
                  set(
                    "photos",
                    s.photos.map((x, j) => (j === k ? { ...x, caption: e.target.value } : x)),
                  )
                }
              />
              <button
                type="button"
                className="text-muted hover:text-clay"
                onClick={() =>
                  set(
                    "photos",
                    s.photos.filter((_, j) => j !== k),
                  )
                }
                aria-label="Remove photo"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="mt-3">
        <p className="text-sm font-semibold">3. The story</p>
        <textarea
          className={input}
          rows={9}
          disabled={approved}
          value={s.text}
          onChange={(e) => set("text", e.target.value)}
          placeholder="Write it, or save and let Claude draft it from the notes and records."
        />
        {start?.questions && start.questions.length > 0 && !approved && (
          <ul className="mt-2 list-disc rounded-xl bg-ochre-soft px-6 py-2 text-xs">
            {start.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        )}
      </div>
      {err && <p className="mt-3 text-sm text-clay">{err}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {!approved && (
          <button type="button" className={primaryBtn} disabled={!!busy} onClick={() => void save()}>
            {busy === "save" ? "Saving…" : "Save"}
          </button>
        )}
        {!approved && v.may.ai && (
          <button
            type="button"
            className={quietBtn}
            disabled={!!busy || (!s.notes.trim() && !s.links.length)}
            onClick={async () => {
              const sid = await save();
              if (!sid) return;
              setBusy("draft");
              try {
                await act({ action: "draft", id: sid }, "Drafted from the notes and records. Read it against the notes before approving.");
                onClose();
              } finally {
                setBusy("");
              }
            }}
          >
            {busy === "draft" ? "Drafting…" : "Save and draft with Claude"}
          </button>
        )}
        <button type="button" className={quietBtn} onClick={onClose}>
          Close
        </button>
      </div>
    </section>
  );
}

export function StoriesPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { project } = useCurrentProject();
  const [v, setV] = useState<View | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const url = `/api/projects/${project.id}/stories`;
  const load = useCallback(async () => {
    if (!user) return;
    const r = await fetch(url, { cache: "no-store", headers: { "x-demo-user": user.id } });
    const d = await r.json();
    if (!r.ok) setError(d.error ?? "Could not load.");
    else setV(d);
  }, [user, url]);
  useEffect(() => {
    if (ready && user && project.saved) void load();
  }, [ready, user, project.saved, load]);
  if (!user) return null;
  const act = async (a: StoryAction, msg: string): Promise<string | undefined> => {
    setError("");
    setNotice("");
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-demo-user": user.id }, body: JSON.stringify(a) });
    const d = await r.json();
    if (!r.ok) {
      setError(d.error ?? "That did not work.");
      return undefined;
    }
    setV(d);
    setNotice(msg);
    return d.id as string;
  };
  const editing = open === "new" ? null : (v?.stories.find((s) => s.id === open) ?? null);
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <Link href="/progress/report" className="text-sm text-muted hover:text-ink">
          ← Report
        </Link>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <h1 className="min-w-0 flex-1 font-display text-4xl tracking-tight">Success stories</h1>
          {v?.may.write && open === null && (
            <button type="button" className={primaryBtn} onClick={() => setOpen("new")}>
              + New story
            </button>
          )}
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          The people behind the figures, for the report&rsquo;s Human Interest Story, the board and communications. Consent first; first names only; used only where the consent allows.
        </p>
        {error && <p className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">{error}</p>}
        {notice && <p className="mt-4 rounded-xl bg-mist px-4 py-3 text-sm text-leaf">{notice}</p>}
        {v && open !== null && <Editor v={v} start={editing} user={user.id} act={act} onClose={() => setOpen(null)} />}
        {v && open === null && (
          <ul className="mt-5 space-y-3">
            {v.stories.length === 0 && <li className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">No stories yet.</li>}
            {v.stories.map((s) => (
              <li key={s.id} className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start gap-2">
                  <p className="min-w-0 flex-1 font-semibold">{s.title}</p>
                  <Pill tone={s.status === "approved" ? "forest" : "ochre"}>{s.status === "approved" ? "Approved" : "Draft"}</Pill>
                  {!s.consent && <Pill tone="clay">No consent recorded</Pill>}
                </div>
                <p className="mt-1 text-xs text-muted">
                  {[s.firstName, s.district, s.province].filter(Boolean).join(" · ")} · by {s.by} {s.at.slice(0, 10)}
                  {s.consent ? ` · consent: ${s.consent.uses.map((u) => USE_LABEL[u].split(" (")[0]).join(", ")}` : ""}
                </p>
                {s.text && <p className="mt-2 line-clamp-3 text-sm">{s.text}</p>}
                <div className="mt-3 flex flex-wrap gap-2 text-sm">
                  <button type="button" className={quietBtn} onClick={() => setOpen(s.id)}>
                    {s.status === "approved" ? "Open" : "Edit"}
                  </button>
                  {v.may.approve && s.status === "draft" && (
                    <button
                      type="button"
                      className={primaryBtn}
                      disabled={!s.consent || s.text.length < 50}
                      title={!s.consent ? "Record consent first." : ""}
                      onClick={() => void act({ action: "approve", id: s.id }, "Approved.")}
                    >
                      Approve
                    </button>
                  )}
                  {s.status === "approved" && !s.reportBlock && (
                    <button
                      type="button"
                      className={quietBtn}
                      onClick={() =>
                        window.confirm(`Use this as the ${quarterNow().replace("-", " ")} report's Human Interest Story? It replaces what is there.`) &&
                        void act({ action: "to-report", id: s.id, quarter: quarterNow() }, "Placed in the report's Human Interest Story.")
                      }
                    >
                      Use in the {quarterNow().replace("-", " ")} report
                    </button>
                  )}
                  {s.status === "approved" && s.reportBlock && <span className="self-center text-xs text-muted">Not for donor reports: {s.reportBlock}</span>}
                  {v.may.approve && s.status === "approved" && (
                    <button
                      type="button"
                      className="text-xs text-muted hover:text-ink"
                      onClick={() => {
                        const reason = window.prompt("Why withdraw the approval?");
                        if (reason) void act({ action: "unapprove", id: s.id, reason }, "Approval withdrawn.");
                      }}
                    >
                      Withdraw approval
                    </button>
                  )}
                  {s.status === "draft" && (s.by === v.me || v.may.approve) && (
                    <button type="button" className="text-xs text-muted hover:text-clay" onClick={() => window.confirm("Remove this story?") && void act({ action: "remove", id: s.id }, "Removed.")}>
                      Remove
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
