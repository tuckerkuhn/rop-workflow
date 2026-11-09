"use client";

/* eslint-disable @next/next/no-img-element -- photos come from the app's own store as blob URLs */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser, useSession } from "@/components/app/session";
import { Pill, TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { AUDIENCES, AUDIENCE_TEXT, LABEL_TEXT, PUBLIC_AUDIENCES, SHARE, SHARE_TEXT, needs, rank, type Audience, type PhotoAction, type PhotoLabel, type Share } from "@/lib/photos";
import { CONSENT_HOW, CONSENT_USES, HOW_LABEL, USE_LABEL } from "@/lib/stories";
import type { photosView } from "@/server/photos-store";

/**
 * Photos and posts: coaching for everyone who takes photos (their best photo and one thing to try),
 * the team's photos without names, and for communications, MEL and leads the library of photos of
 * the work, what each may be used for, and drafts for each audience that a person approves and sends.
 */

type View = Awaited<ReturnType<typeof photosView>>;
type Item = View["library"][number];
const input = "mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2 text-base";
const LABEL_TONE: Record<PhotoLabel, "forest" | "ochre" | "clay"> = { report: "forest", records: "ochre", retake: "clay" };
const today = () => new Date().toISOString().slice(0, 10);

function useBlob(hash: string, user: string) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let url = "";
    fetch(`/api/files/${hash}`, { headers: { "x-demo-user": user } })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => b && setSrc((url = URL.createObjectURL(b))))
      .catch(() => undefined);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [hash, user]);
  return src;
}

function Photo({ hash, user, alt, className }: { hash: string; user: string; alt: string; className: string }) {
  const src = useBlob(hash, user);
  return src ? <img src={src} alt={alt} className={`${className} object-cover`} /> : <div className={`${className} bg-sunken`} />;
}

function Tips({ c }: { c: NonNullable<Item["coach"]> }) {
  return (
    <div className="space-y-1 text-sm">
      {c.tips.map((t) => (
        <p key={t}>{t}</p>
      ))}
      {c.tipsLocal?.tips.map((t) => (
        <p key={t} dir={["fa", "ps"].includes(c.tipsLocal!.lang) ? "rtl" : "ltr"} lang={c.tipsLocal!.lang} className="text-muted">
          {t}
        </p>
      ))}
    </div>
  );
}

const GUIDE = [
  "Show the work: the trellis, the drip line, the harvest, with the whole thing in the frame.",
  "Light behind you, on the subject. Avoid shooting into the sun.",
  "Hold still and tap the screen to focus before you take it.",
  "People at work, not lined up facing the camera. Farmers as the business owners they are.",
  "Ask before you photograph someone's face, and record their consent if it may be shared.",
];

function Consent({ hash, act, onDone }: { hash: string; act: (a: PhotoAction, msg: string) => Promise<boolean>; onDone: () => void }) {
  const [c, setC] = useState({ how: CONSENT_HOW[0] as (typeof CONSENT_HOW)[number], uses: ["comms"] as (typeof CONSENT_USES)[number][], date: today(), takenBy: "" });
  return (
    <div className="mt-2 rounded-xl bg-paper p-3 text-sm">
      <p className="font-semibold">Consent of the people in this photo</p>
      <label className="mt-2 block">
        How it was given
        <select className={input} value={c.how} onChange={(e) => setC({ ...c, how: e.target.value as (typeof CONSENT_HOW)[number] })}>
          {CONSENT_HOW.map((h) => (
            <option key={h} value={h}>
              {HOW_LABEL[h]}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="mt-2">
        <legend>What they agreed to</legend>
        {CONSENT_USES.map((u) => (
          <label key={u} className="mr-3 inline-flex items-center gap-1">
            <input type="checkbox" checked={c.uses.includes(u)} onChange={(e) => setC({ ...c, uses: e.target.checked ? [...c.uses, u] : c.uses.filter((x) => x !== u) })} />
            {USE_LABEL[u].split(" (")[0]}
          </label>
        ))}
      </fieldset>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label>
          Date
          <input type="date" className={input} value={c.date} onChange={(e) => setC({ ...c, date: e.target.value })} />
        </label>
        <label>
          Taken by (staff)
          <input className={input} value={c.takenBy} onChange={(e) => setC({ ...c, takenBy: e.target.value })} />
        </label>
      </div>
      <button type="button" className={`${quietBtn} mt-2`} disabled={!c.uses.length || c.takenBy.trim().length < 2} onClick={async () => (await act({ action: "consent", hash, consent: c }, "Consent recorded.")) && onDone()}>
        Save consent
      </button>
    </div>
  );
}

function LibraryCard({ i, user, picked, onPick, act }: { i: Item; user: string; picked: boolean; onPick: () => void; act: (a: PhotoAction, msg: string) => Promise<boolean> }) {
  const [consent, setConsent] = useState(false);
  return (
    <li className={`rounded-2xl border bg-surface p-3 ${picked ? "border-forest" : "border-line"}`}>
      <Photo hash={i.hash} user={user} alt={i.coach?.shows ?? i.caption} className="h-44 w-full rounded-xl" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {i.coach && <Pill tone={LABEL_TONE[i.coach.label]}>{LABEL_TEXT[i.coach.label]}</Pill>}
        {i.coach?.people === "identifiable" && <Pill tone="ochre">People can be recognised</Pill>}
      </div>
      <p className="mt-1 text-sm font-semibold">{i.coach?.shows}</p>
      <p className="text-xs text-muted">
        {i.source.title.slice(0, 90)} · {i.date}
        {i.province ? ` · ${i.province}` : ""}
      </p>
      {i.caption && <p className="mt-1 text-xs">{i.caption}</p>}
      <label className="mt-2 block text-xs">
        May be used for
        <select className={`${input} text-sm`} value={i.share} onChange={(e) => void act({ action: "share", hash: i.hash, level: e.target.value as Share }, "Saved.")}>
          {SHARE.map((s) => (
            <option key={s} value={s} disabled={rank(s) > rank(i.limit.max)}>
              {SHARE_TEXT[s]}
            </option>
          ))}
        </select>
      </label>
      <p className="mt-1 text-xs text-muted">{i.limit.why}</p>
      {i.coach?.people === "identifiable" && i.limit.max !== "public" && (
        <button type="button" className="mt-1 text-xs font-semibold text-forest" onClick={() => setConsent(!consent)}>
          {i.consent ? "Consent recorded · change" : "Record their consent"}
        </button>
      )}
      {consent && <Consent hash={i.hash} act={act} onDone={() => setConsent(false)} />}
      <label className="mt-2 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={picked} onChange={onPick} disabled={i.share === "internal"} />
        {i.share === "internal" ? "Clear it for sharing to use it in a post" : "Use in a post"}
      </label>
    </li>
  );
}

function PostCard({ p, v, user, act }: { p: View["posts"][number]; v: View; user: string; act: (a: PhotoAction, msg: string) => Promise<boolean> }) {
  const [text, setText] = useState(p.text);
  const [where, setWhere] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setText(p.text), [p.text]);
  const download = async (hash: string) => {
    const r = await fetch(`/api/files/${hash}`, { headers: { "x-demo-user": user } });
    if (!r.ok) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await r.blob());
    a.download = `rop-${p.audience}-${hash.slice(0, 8)}.jpg`;
    a.click();
  };
  return (
    <li className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 font-semibold">{AUDIENCE_TEXT[p.audience]}</p>
        <Pill tone={p.status === "sent" ? "forest" : p.status === "approved" ? "forest" : "ochre"}>{p.status === "sent" ? `Sent · ${p.sent?.where}` : p.status === "approved" ? "Approved" : "Draft"}</Pill>
      </div>
      <div className="mt-2 flex gap-2">
        {p.photos.map((h) => (
          <button key={h} type="button" title="Download" onClick={() => void download(h)}>
            <Photo hash={h} user={user} alt="" className="h-16 w-20 rounded-lg" />
          </button>
        ))}
      </div>
      {p.status === "draft" ? (
        <textarea className={`${input} mt-2 text-sm`} rows={7} value={text} onChange={(e) => setText(e.target.value)} />
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-sm">{p.text}</p>
      )}
      {p.checks && p.checks.length > 0 && p.status === "draft" && (
        <ul className="mt-2 list-disc rounded-xl bg-ochre-soft px-6 py-2 text-xs">
          {p.checks.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-xs text-muted">
        Drafted by {p.by} {p.at.slice(0, 10)}
        {p.approved ? ` · approved by ${p.approved.by}` : ""}
      </p>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        {p.status === "draft" && text !== p.text && (
          <button type="button" className={quietBtn} onClick={() => void act({ action: "edit-post", id: p.id, text }, "Saved.")}>
            Save changes
          </button>
        )}
        {p.status === "draft" && text === p.text && (
          <button type="button" className={primaryBtn} onClick={() => void act({ action: "approve-post", id: p.id }, "Approved. Copy it, send it, then mark it sent.")}>
            Approve
          </button>
        )}
        {p.status !== "draft" && (
          <button
            type="button"
            className={quietBtn}
            onClick={async () => {
              await navigator.clipboard.writeText(p.text);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy text"}
          </button>
        )}
        {p.status === "approved" && (
          <>
            <input className="rounded-xl border border-line bg-paper px-3 py-1 text-sm" placeholder="Where it went (e.g. LinkedIn, UNDP email)" value={where} onChange={(e) => setWhere(e.target.value)} />
            <button type="button" className={quietBtn} disabled={where.trim().length < 2} onClick={() => void act({ action: "sent-post", id: p.id, where }, "Marked sent.")}>
              Mark sent
            </button>
          </>
        )}
        {p.status !== "sent" && (
          <button type="button" className="text-sm text-muted hover:text-clay" onClick={() => void act({ action: "remove-post", id: p.id }, "Removed.")}>
            Remove
          </button>
        )}
      </div>
      {PUBLIC_AUDIENCES.includes(p.audience) && !v.publicPosts?.on && p.status !== "sent" && <p className="mt-2 text-xs text-clay">Public posts are off for this project.</p>}
    </li>
  );
}

export function PhotosPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { project } = useCurrentProject();
  const [v, setV] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<{ label: PhotoLabel | "all"; share: Share | "all" }>({ label: "report", share: "all" });
  const [picked, setPicked] = useState<string[]>([]);
  const [audience, setAudience] = useState<Audience>("donor");
  const [ask, setAsk] = useState("");
  const [publicNote, setPublicNote] = useState("");
  const url = `/api/projects/${project.id}/photos`;
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
  // Photos being looked at: check again shortly.
  useEffect(() => {
    if (!v?.waiting) return;
    const t = setTimeout(() => void load(), 20000);
    return () => clearTimeout(t);
  }, [v, load]);
  const library = useMemo(() => (v?.library ?? []).filter((i) => (filter.label === "all" || i.coach?.label === filter.label) && (filter.share === "all" || i.share === filter.share)), [v, filter]);
  if (!user) return null;
  const act = async (a: PhotoAction, msg: string) => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-demo-user": user.id }, body: JSON.stringify(a) });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? "That did not work.");
        return false;
      }
      setV(d);
      setNotice(msg);
      return true;
    } finally {
      setBusy(false);
    }
  };
  const need = needs(audience);
  const pickedItems = (v?.library ?? []).filter((i) => picked.includes(i.hash));
  const blocked = !picked.length
    ? "Pick one to four photos below."
    : pickedItems.some((i) => rank(i.share) < rank(need))
      ? `For ${AUDIENCE_TEXT[audience]}, every photo must be cleared for "${SHARE_TEXT[need]}".`
      : PUBLIC_AUDIENCES.includes(audience) && !v?.publicPosts?.on
        ? "Public posts are off for this project."
        : "";
  const mine = v?.mine;
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <Link href="/progress/report" className="text-sm text-muted hover:text-ink">
          ← Report
        </Link>
        <h1 className="mt-2 font-display text-4xl tracking-tight">Photos and posts</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">Tips on every photo you take for the project, and for communications: the best photos, what each may be used for, and posts for donors, traders, social media, the newsletter and the website. Nothing is posted by the app; a person approves and sends each one.</p>
        {error && <p className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">{error}</p>}
        {notice && <p className="mt-4 rounded-xl bg-mist px-4 py-3 text-sm text-leaf">{notice}</p>}

        {v && mine && (
          <section className="mt-5 rounded-2xl border border-line bg-surface p-4">
            <h2 className="font-display text-xl">Your photos, the last two weeks</h2>
            {mine.count === 0 ? (
              <p className="mt-2 text-sm text-muted">No photos from you in the last two weeks. Add them to a result or the weekly update and the tips appear here.</p>
            ) : (
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {mine.best && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-forest">Your best</p>
                    <Photo hash={mine.best.hash} user={user.id} alt={mine.best.coach!.shows} className="mt-1 h-48 w-full rounded-xl" />
                    <div className="mt-2 flex items-center gap-2">
                      <Pill tone={LABEL_TONE[mine.best.coach!.label]}>{LABEL_TEXT[mine.best.coach!.label]}</Pill>
                      <span className="text-xs text-muted">{mine.best.date}</span>
                    </div>
                    <div className="mt-1">
                      <Tips c={mine.best.coach!} />
                    </div>
                  </div>
                )}
                {mine.toTry && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ochre">One thing to try</p>
                    <Photo hash={mine.toTry.hash} user={user.id} alt={mine.toTry.coach!.shows} className="mt-1 h-48 w-full rounded-xl" />
                    <div className="mt-2">
                      <Tips c={mine.toTry.coach!} />
                    </div>
                  </div>
                )}
                {mine.waiting > 0 && <p className="text-sm text-muted sm:col-span-2">{mine.waiting === 1 ? "1 photo is" : `${mine.waiting} photos are`} being looked at; the tips appear here in a minute.</p>}
              </div>
            )}
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer font-semibold text-forest">Five things that make a good field photo</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                {GUIDE.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ol>
            </details>
          </section>
        )}

        {v && (
          <section className="mt-4 rounded-2xl border border-line bg-surface p-4">
            <h2 className="font-display text-xl">The team&rsquo;s photos, the last four weeks</h2>
            <p className="mt-1 text-xs text-muted">All photos together, never by person: this is for coaching, not grading.</p>
            <div className="mt-2 flex flex-wrap gap-4 text-sm">
              {(["report", "records", "retake"] as const).map((l) => (
                <span key={l}>
                  <span className="font-display text-2xl">{v.team[l]}</span> {LABEL_TEXT[l].toLowerCase()}
                </span>
              ))}
            </div>
          </section>
        )}

        {v?.may.comms && (
          <>
            <section className="mt-4 rounded-2xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="min-w-0 flex-1 font-display text-xl">Public social media for this project</h2>
                <Pill tone={v.publicPosts?.on ? "forest" : "ochre"}>{v.publicPosts?.on ? "On" : "Off"}</Pill>
              </div>
              <p className="mt-1 text-sm text-muted">
                {v.publicPosts ? `${v.publicPosts.on ? "Turned on" : "Turned off"} by ${v.publicPosts.by} on ${v.publicPosts.at.slice(0, 10)}: ${v.publicPosts.note}` : "Off until a programme lead checks the donor's visibility agreement. Donor, trader, newsletter and website drafts work either way."}
              </p>
              {v.may.decidePublic && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <input className="min-w-0 flex-1 rounded-xl border border-line bg-paper px-3 py-2 text-sm" placeholder="Why (e.g. UNDP visibility guidance allows ROP posts)" value={publicNote} onChange={(e) => setPublicNote(e.target.value)} />
                  <button type="button" className={quietBtn} disabled={busy || publicNote.trim().length < 5} onClick={() => void act({ action: "public-posts", on: !v.publicPosts?.on, note: publicNote }, "Saved.")}>
                    {v.publicPosts?.on ? "Turn off" : "Turn on"}
                  </button>
                </div>
              )}
            </section>

            <section className="mt-4 rounded-2xl border border-forest/40 bg-mist p-4">
              <h2 className="font-display text-xl">Draft a post</h2>
              <div className="mt-2 grid gap-3 sm:grid-cols-[14rem_1fr]">
                <label className="text-sm">
                  For
                  <select className={input} value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
                    {AUDIENCES.map((a) => (
                      <option key={a} value={a}>
                        {AUDIENCE_TEXT[a]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  Anything to stress (optional)
                  <input className={input} value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="e.g. the women-led greenhouses; the harvest is ready in December" />
                </label>
              </div>
              <p className="mt-2 text-sm">
                {picked.length} photo{picked.length === 1 ? "" : "s"} picked. {blocked}
              </p>
              <button
                type="button"
                className={`${primaryBtn} mt-2`}
                disabled={busy || !!blocked || !v.may.ai}
                onClick={async () => {
                  if (await act({ action: "draft-post", audience, photos: picked, ...(ask.trim() ? { ask: ask.trim() } : {}) }, "Drafted. Check it against the records, then approve.")) setPicked([]);
                }}
              >
                {busy ? "Drafting…" : "Draft with Claude"}
              </button>
            </section>

            {v.posts.length > 0 && (
              <section className="mt-4">
                <h2 className="font-display text-xl">Posts</h2>
                <ul className="mt-2 space-y-3">
                  {v.posts.map((p) => (
                    <PostCard key={p.id} p={p} v={v} user={user.id} act={act} />
                  ))}
                </ul>
              </section>
            )}

            <section className="mt-6">
              <div className="flex flex-wrap items-end gap-3">
                <h2 className="min-w-0 flex-1 font-display text-xl">Photo library</h2>
                <select className="rounded-xl border border-line bg-paper px-3 py-2 text-sm" value={filter.label} onChange={(e) => setFilter({ ...filter, label: e.target.value as PhotoLabel | "all" })}>
                  <option value="report">Ready for a report</option>
                  <option value="records">Good for the records</option>
                  <option value="retake">Retake if you can</option>
                  <option value="all">All photos</option>
                </select>
                <select className="rounded-xl border border-line bg-paper px-3 py-2 text-sm" value={filter.share} onChange={(e) => setFilter({ ...filter, share: e.target.value as Share | "all" })}>
                  <option value="all">Any use</option>
                  {SHARE.map((s) => (
                    <option key={s} value={s}>
                      {SHARE_TEXT[s]}
                    </option>
                  ))}
                </select>
              </div>
              <p className="mt-1 text-xs text-muted">Photos of the work from accepted results, weekly updates and stories. Where people can be recognised, a photo goes only as far as their recorded consent; women who can be recognised never go on public social media without consent for it.</p>
              {library.length === 0 ? (
                <p className="mt-3 rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">{v.waiting ? (v.may.ai ? "Photos are being looked at; they appear here in a minute." : "Photos appear here once the AI is set up on this server (ANTHROPIC_API_KEY).") : "No photos match."}</p>
              ) : (
                <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {library.map((i) => (
                    <LibraryCard key={i.hash} i={i} user={user.id} picked={picked.includes(i.hash)} onPick={() => setPicked(picked.includes(i.hash) ? picked.filter((h) => h !== i.hash) : [...picked, i.hash].slice(0, 4))} act={act} />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
