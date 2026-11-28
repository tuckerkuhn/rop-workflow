"use client";

import { FARMER_LISTS, screeningHold } from "@/lib/farmer-screening";
import type { FieldSetup } from "@/lib/package";
import type { AppUser } from "@/lib/demo";
import { plainError } from "@/lib/plain-error";
import { DocLinks } from "@/components/app/doc-links";
import { FieldHelp } from "@/components/app/field-help";
import { useT } from "@/components/app/i18n";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { mayWriteStory } from "@/lib/stories";
import { useState } from "react";
import { stageOf } from "@/components/field/workspace";
import { PhotoTagger, filedAs } from "@/components/field/photo-tagger";
import { tagLabels, tagsFor, type PhotoTag } from "@/lib/kobo-photo";
import { useFieldData } from "@/components/app/use-project-data";
import { Initials, useFeature, useRequireUser, useSession } from "@/components/app/session";
import { PHOTO_QUALITY } from "@/lib/plans";
import { Pill, TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { useCurrentProject } from "@/components/app/current-project";
import { StoredPhoto } from "@/components/field/stored-photo";
import { today } from "@/lib/clock";
import { DEMO_SETUP, packageUsd } from "@/lib/package";
import { holderOf } from "@/lib/demo";
import { householdCounts } from "@/lib/household";
import { packageOption } from "@/lib/package";
import {
  farmerStages,
  fieldPerson,
  fieldRoleLabel,
  fieldRoles,
  farmerName,
  fieldSteps,
  maskName,
  photoLabels,
  type Farmer,
  type Finding,
  type PhotoKind,
} from "@/lib/field";

const field = "min-h-12 w-full border-2 border-line-strong bg-surface px-3 py-2 text-base focus:border-forest focus:outline-none";
const focusRing = "focus-visible:outline focus-visible:outline-4 focus-visible:-outline-offset-4 focus-visible:outline-forest";
// A text action in the Bands look: bold green, a 48px touch target.
const bandLink = `inline-flex min-h-12 items-center gap-1.5 font-bold text-forest underline-offset-4 hover:underline disabled:opacity-50 ${focusRing}`;

/** A section's name in the Bands look: heavy type, a gold bar for "look here". */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="border-s-[6px] border-ochre ps-2 text-2xl font-extrabold leading-tight">{children}</h2>;
}

/** Drawn stand-in for a field photo until real ones are uploaded. */
function PhotoArt({ kind }: { kind: PhotoKind }) {
  return (
    <svg viewBox="0 0 160 110" className="h-full w-full" aria-hidden>
      <rect width="160" height="110" className="fill-mist" />
      <circle cx="132" cy="22" r="10" className="fill-ochre/70" />
      <path d="M0 70 C40 60 120 62 160 70 L160 110 L0 110 Z" className="fill-ochre-soft" />
      {kind === "landprep" &&
        [0, 1, 2, 3, 4].map((k) => <path key={k} d={`M${-10 + k * 8} 110 L${60 + k * 22} 72`} className="stroke-ochre" strokeWidth="3" fill="none" />)}
      {kind === "planting" &&
        [0, 1, 2, 3, 4, 5].map((k) => (
          <g key={k} transform={`translate(${18 + k * 24} ${88 - (k % 2) * 6})`}>
            <path d="M0 0 V-14 M0 -8 C-6 -12 -8 -16 -8 -18 M0 -10 C6 -14 8 -18 8 -20" className="stroke-leaf" strokeWidth="2" fill="none" />
          </g>
        ))}
      {kind === "training" && (
        <>
          <rect x="22" y="26" width="52" height="32" rx="2" className="fill-surface stroke-forest" strokeWidth="2" />
          <path d="M30 36 H64 M30 44 H58" className="stroke-forest" strokeWidth="2" />
          {[0, 1, 2].map((k) => (
            <g key={k} transform={`translate(${92 + k * 18} 70)`}>
              <circle r="6" cy="-14" className="fill-forest" />
              <path d="M-7 4 Q0 -10 7 4 Z" className="fill-forest" />
            </g>
          ))}
        </>
      )}
      {kind === "visit" && (
        <>
          <rect x="56" y="22" width="48" height="60" rx="4" className="fill-surface stroke-forest" strokeWidth="2" />
          <path d="M66 40 l6 6 l12 -12 M66 60 H94 M66 70 H88" className="stroke-forest" strokeWidth="2.5" fill="none" />
        </>
      )}
      {kind === "distribution" &&
        [0, 1, 2].map((k) => (
          <g key={k} transform={`translate(${40 + k * 30} ${84 - (k === 1 ? 8 : 0)})`}>
            <path d="M-12 0 Q-14 -26 0 -30 Q14 -26 12 0 Z" className="fill-surface stroke-forest" strokeWidth="2" />
            <path d="M-6 -16 H6" className="stroke-forest" strokeWidth="2" />
          </g>
        ))}
    </svg>
  );
}

function SatisfactionChart({ surveys }: { surveys: Farmer["surveys"] }) {
  const { tx } = useT();
  if (surveys.length === 0) return <p className="text-sm text-muted">{tx("No surveys yet.")}</p>;
  const w = 320;
  const h = 120;
  const x = (k: number) => (surveys.length === 1 ? w / 2 : 30 + (k * (w - 60)) / (surveys.length - 1));
  const y = (s: number) => 96 - ((s - 1) / 4) * 76;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label={tx("Satisfaction scores: {scores} out of 5", { scores: surveys.map((s) => s.score).join(", ") })}>
      {[1, 3, 5].map((s) => (
        <g key={s}>
          <line x1="22" x2={w - 10} y1={y(s)} y2={y(s)} className="stroke-line" strokeDasharray="2 3" />
          <text x="8" y={y(s) + 3} className="fill-muted text-xs">
            {s}
          </text>
        </g>
      ))}
      <polyline points={surveys.map((s, k) => `${x(k)},${y(s.score)}`).join(" ")} className="stroke-forest" strokeWidth="2" fill="none" />
      {surveys.map((s, k) => (
        <g key={s.date}>
          <circle cx={x(k)} cy={y(s.score)} r={k === surveys.length - 1 ? 5 : 3.5} className="fill-forest" />
          <text x={x(k)} y={h - 4} textAnchor="middle" className="fill-muted text-xs">
            {s.date.slice(0, 7)}
          </text>
        </g>
      ))}
    </svg>
  );
}

/**
 * A story on the profile, written up on the Success stories page: the first click makes a draft
 * there from it (the name hidden, as on any story), later clicks open the same draft.
 */
function ToSuccessStory({ project, user, farmer, story }: { project: string; user: string; farmer: string; story: string }) {
  const { tx } = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <span className="mt-2 block">
      <button
        type="button"
        disabled={busy}
        className={bandLink}
        onClick={async () => {
          setBusy(true);
          setErr("");
          const r = await fetch(`/api/projects/${project}/stories`, { method: "POST", headers: { "Content-Type": "application/json", "x-demo-user": user }, body: JSON.stringify({ action: "from-farmer", farmer, story }) }).catch(() => null);
          const d = r ? await r.json().catch(() => null) : null;
          setBusy(false);
          if (!r?.ok || !d?.id) return setErr(d?.error ?? tx("That did not work. Try again."));
          router.push(`/progress/stories?story=${d.id}`);
        }}
      >
        {tx("Success story")} →
      </button>
      {err && <span className="mt-1 block text-sm font-bold text-clay">{err}</span>}
    </span>
  );
}

export function FarmerProfile({ id }: { id: string }) {
  const { user } = useRequireUser();
  const { money } = useSession();
  const { project } = useCurrentProject();
  const { items, setItems, setup: loadedSetup, status, error } = useFieldData(project.id);
  const setup = loadedSetup ?? DEMO_SETUP;
  const TODAY = today();
  const { t, tx } = useT();
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState("");
  const [addingPhoto, setAddingPhoto] = useState(false);
  // Photos this person added on this visit to the page: the server has them; shown at once without reloading.
  const [addedPhotos, setAddedPhotos] = useState<Farmer["photos"]>([]);
  // Photo quality follows the plan: a small copy on the free plan, normal phone quality on the paid one.
  const fullPhotos = useFeature("full_photos");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteText, setNoteText] = useState("");

  const farmer = items.find((i): i is Farmer => i.kind === "farmer" && i.id === id);
  if (!user) return null;
  if (!farmer)
    return (
      <div className="min-h-screen">
        <TopBar active="field" />
        <p className={`px-6 py-24 text-center font-bands text-lg font-bold ${error ? "text-clay" : "text-muted"}`}>{status === "loading" ? tx("Loading…") : error || tx("No farmer with ID {id}.", { id })}</p>
      </div>
    );

  const myRole = user.field[0];
  const canEdit = user.field.length > 0;
  // Anyone on the project who visits farmers can add a photo, not only the people who record field
  // work: management and communications too. A visitor's photo is a picture of the work, never proof,
  // so the signed distribution receipt stays with field staff (server/farmer-photo).
  // Staff only: the server refuses a photo from an account outside Roots of Peace (a donor's).
  const canAddPhoto = canEdit || (user.kind === "employee" && user.fieldAccess !== "none");
  // The signed note is proof: only the people who hand goods out add it, never whoever checks or approves.
  const photoTags: PhotoTag[] = tagsFor(user);
  const update = (fn: (f: Farmer) => Farmer) => setItems((all) => all.map((i) => (i.kind === "farmer" && i.id === id ? fn(i) : i)));
  const citing = items.filter((i): i is Finding => i.kind === "finding" && i.sources.includes(id));
  const latest = farmer.surveys[farmer.surveys.length - 1];
  const gotInputs = ["plant", "complete"].includes(farmer.step);
  const notes = farmer.stories.filter((s) => s.status === "note");
  const done = farmer.stories.filter((s) => s.status === "completed");
  const setDocs = (storyId: string, docs: Farmer["stories"][number]["docs"]) => update((f) => ({ ...f, stories: f.stories.map((x) => (x.id === storyId ? { ...x, docs } : x)) }));
  const step = fieldSteps[farmer.step];

  const engagements = [
    ...farmer.timeline.map((e) => ({ date: e.date, kind: tx("Activity"), text: e.what, who: fieldPerson(e.who) })),
    ...farmer.surveys.map((s) => ({ date: s.date, kind: tx("Survey"), text: tx("Satisfaction {score}/5: “{comment}”", { score: s.score, comment: s.comment }), who: fieldPerson(s.by) })),
    ...farmer.stories.map((s) => ({ date: s.date, kind: tx("Story"), text: s.status === "completed" ? tx("Success story: {title}", { title: s.title }) : tx("Story note: {title}", { title: s.title }), who: fieldPerson(s.by) })),
    ...citing.map((f) => ({ date: f.timeline[0]?.date ?? TODAY, kind: tx("Finding"), text: tx("Cited in {id}: {title}", { id: f.id, title: f.title }), who: fieldPerson("mel") })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const staff = fieldRoles.map((r) => {
    const u = holderOf("field", r.id)!;
    const last = [...farmer.timeline].reverse().find((e) => e.who === r.id);
    return { role: r.id, u, last };
  });

  return (
    <div className="min-h-screen">
      <TopBar active="field" />
      {error && (
        <p role="alert" className="mx-auto mt-4 max-w-6xl bg-[#7a5230] px-4 py-3 font-bands text-sm font-bold text-white">
          {t("field.saveFailed", { error })}
        </p>
      )}
      <div className="mx-auto max-w-[1400px] px-4 py-6 font-bands sm:px-6 lg:py-8">
        <Link href={`/work?source=field&open=${farmer.id}`} className={`inline-flex min-h-12 items-center font-bold text-muted hover:text-ink ${focusRing}`}>
          {tx("← Field activities")}
        </Link>

        <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-8">
            {/* Header */}
            <section className="flex flex-wrap items-start gap-5">
              {user.pii ? (
                <Initials name={farmer.name} className="h-16 w-16 text-2xl" />
              ) : (
                <span className="grid h-16 w-16 shrink-0 place-items-center bg-sunken font-mono text-sm font-bold text-muted">ID</span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted">{farmer.id}</span>
                  {setup.season && <Pill tone="muted">{setup.season}</Pill>}
                  {step ? <Pill tone="forest">{tx("Now: {step}", { step: tx(step.title) })}</Pill> : <Pill tone={farmer.step === "removed" ? "clay" : "forest"}>{farmer.step === "removed" ? tx("Removed") : tx("Season record complete")}</Pill>}
                </div>
                <h1 className="mt-1 break-words text-4xl font-extrabold leading-tight tracking-tight">{farmerName(farmer, user)}</h1>
                {!user.pii && <p className="text-sm font-medium text-muted">{tx("Name and contact details are restricted participant data. You see the farmer ID only.")}</p>}
                <p className="mt-1 text-base font-semibold text-muted">
                  {farmer.community} · {tx("{n} ha", { n: farmer.hectares })}{setup.crop ? ` ${setup.crop.toLowerCase()}` : ""} · {tx("Enrolled {date}", { date: farmer.enrolledOn })} · {farmer.contributionPaid ? tx("Contribution paid") : tx("Contribution not paid")}
                  <br />
                  {farmer.gender} · {farmer.ageBand} · {tx("household of {n}", { n: farmer.householdSize })}
                  {farmer.household?.length ? ` (${tx("{women} women, {men} men, {girls} girls, {boys} boys", householdCounts(farmer.household))})` : ""}
                  {packageOption(setup, farmer.package) ? ` · ${tx("Package: {name}", { name: packageOption(setup, farmer.package)!.name })}` : ""}
                </p>
              </div>
              <Link
                href={`/work?source=field&open=${farmer.id}`}
                className={`inline-flex min-h-14 w-full items-center justify-center bg-deep px-5 text-lg font-extrabold text-deep-ink hover:bg-forest-hover sm:w-auto ${focusRing} focus-visible:outline-ochre`}
              >
                {tx("Open current step")}
              </Link>
            </section>

            {/* Summary */}
            {/* MF-04: the sanctions screening a package above the limit waits for. */}
            <FarmerScreeningPanel farmer={farmer} setup={setup} code={project.id} user={user} />
            {farmer.planting && (
              <p className="bg-mist px-4 py-3 text-base">
                <span className="font-extrabold">{tx("Planted {date}", { date: farmer.planting.date })}</span> · {tx("{planted} of {total} ha", { planted: farmer.planting.hectares, total: farmer.hectares })}
              </p>
            )}
            <dl className="grid grid-cols-2 gap-1 sm:grid-cols-4">
              {[
                [tx("Engagements"), String(engagements.length)],
                [tx("Satisfaction"), latest ? tx("{score} / 5", { score: latest.score }) : "—"],
                [tx("Season progress"), tx("{n} of {total}", { n: Math.min(stageOf(farmer), farmerStages.length), total: farmerStages.length })],
                [tx("Inputs received"), gotInputs ? (packageUsd(setup, farmer.hectares) ? money(packageUsd(setup, farmer.hectares)) : tx("Yes")) : tx("Not yet")],
              ].map(([k, v]) => (
                <div key={k} className="min-w-0 bg-sunken px-4 pb-4 pt-3">
                  <dt className="break-words text-sm font-bold leading-tight text-muted">{k}</dt>
                  <dd className="mt-2 break-words text-3xl font-extrabold xl:text-4xl leading-none tracking-tight tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>

            {/* Satisfaction */}
            <section className="grid gap-6 bg-sunken p-5 md:grid-cols-[1.2fr_1fr]">
              <div>
                <SectionLabel>{tx("Satisfaction with the project")}</SectionLabel>
                <div className="mt-3">
                  <SatisfactionChart surveys={farmer.surveys} />
                </div>
                {latest && <p className="mt-2 text-base font-medium text-muted">{tx("Latest: “{comment}”", { comment: latest.comment })}</p>}
              </div>
              {canEdit ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!score) return;
                    update((f) => ({
                      ...f,
                      surveys: [...f.surveys, { date: TODAY, score, comment: comment.trim() || "No comment", by: myRole }],
                    }));
                    setScore(0);
                    setComment("");
                  }}
                  className="space-y-3 md:border-s md:border-line md:ps-6"
                >
                  <p className="text-base font-extrabold">{tx("Record today’s satisfaction")}</p>
                  <div className="flex gap-1.5" role="radiogroup" aria-label={tx("Score out of 5")}>
                    {[1, 2, 3, 4, 5].map((s) => (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={score === s}
                        onClick={() => setScore(s)}
                        className={`grid h-12 w-12 place-items-center border-2 text-xl font-extrabold transition ${focusRing} ${score >= s && score ? "border-deep bg-deep text-deep-ink" : "border-line-strong bg-surface hover:border-forest"}`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  <input id="sat-comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={tx("What did the farmer say?")} className={field} />
                  <button type="submit" disabled={!score} className={`${primaryBtn} min-h-12 text-base font-bold`}>
                    {tx("Save survey")}
                  </button>
                </form>
              ) : (
                <p className="text-base font-medium text-muted md:border-s md:border-line md:ps-6">{tx("Surveys are recorded by field staff during visits.")}</p>
              )}
            </section>

            {/* Photos */}
            <section>
              <div className="flex items-center justify-between">
                <div className="flex flex-wrap items-center">
                  <SectionLabel>{tx("Photos · {n}", { n: farmer.photos.length + addedPhotos.filter((p) => !farmer.photos.some((x) => x.id === p.id)).length })}</SectionLabel>
                  <FieldHelp field="farmer.photo" />
                </div>
                {canAddPhoto && !addingPhoto && (
                  <button type="button" onClick={() => setAddingPhoto(true)} className={bandLink}>
                    {tx("+ Add photo")}
                  </button>
                )}
              </div>
              {addingPhoto && (
                <>
                  {/* Nothing typed: the day, time and place come from the photo, and one tag files it. */}
                  <PhotoTagger
                    tags={photoTags}
                    quality={fullPhotos ? PHOTO_QUALITY.full : PHOTO_QUALITY.small}
                    precise={!!user?.pii}
                    onCancel={() => setAddingPhoto(false)}
                    onSave={async (shot) => {
                      // Field staff: added to the record they are already editing, saved with their other changes.
                      if (canEdit) {
                        update((f) => ({
                          ...f,
                          photos: [
                            ...f.photos,
                            { id: `${f.id}-${Date.now()}`, ...filedAs(shot.tag), tag: shot.tag, date: shot.taken?.date ?? TODAY, caption: `${tagLabels[shot.tag]} · ${f.id}`, src: shot.src, ...(shot.taken ? { taken: shot.taken } : {}), ...(shot.gps ? { gps: shot.gps } : {}), by: user.id, byName: user.name },
                          ],
                        }));
                        setAddingPhoto(false);
                        return;
                      }
                      // A visitor cannot change the record: the server files the photo in one locked step, with their name.
                      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/field/photos`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json", "x-demo-user": user.id },
                        body: JSON.stringify({ farmerId: farmer.id, tag: shot.tag, src: shot.src, taken: shot.taken, gps: shot.gps }),
                      });
                      const body = (await res.json().catch(() => ({}))) as { photo?: Farmer["photos"][number]; error?: string };
                      if (!res.ok || !body.photo) throw new Error(body.error ?? t("fp.unreadable"));
                      setAddedPhotos((cur) => [...cur, body.photo!]);
                      setAddingPhoto(false);
                    }}
                  />
                  {!canEdit && <p className="mt-1 text-xs text-muted">{tx("Your photo is kept as a picture of the work, with your name. It counts toward nothing and starts no approval.")}</p>}
                  <p className="mt-1 text-xs text-muted">{fullPhotos ? t("fp.full") : t("fp.small")}</p>
                </>
              )}
              <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {[...farmer.photos, ...addedPhotos.filter((p) => !farmer.photos.some((x) => x.id === p.id))].reverse().map((p) => (
                  <li key={p.id} className="overflow-hidden bg-sunken">
                    <div className="relative aspect-[16/11]">
                      {p.src ? (
                        <StoredPhoto code={project.id} src={p.src} user={user?.id} alt={maskName(p.caption, farmer, user)} className="h-full w-full object-cover" />
                      ) : (
                        <>
                          <PhotoArt kind={p.activity} />
                          <span className="absolute start-2 top-2 bg-surface/85 px-1.5 py-0.5 text-xs font-bold text-muted">{tx("Placeholder")}</span>
                        </>
                      )}
                    </div>
                    <div className="px-3 py-2">
                      <p className="text-sm font-extrabold">{tx(p.tag && p.tag in tagLabels ? tagLabels[p.tag as PhotoTag] : p.signedNote ? tagLabels["signed-note"] : photoLabels[p.activity])}</p>
                      <p className="truncate text-xs text-muted">
                        {p.taken ? `${p.taken.date}${p.taken.time ? ` ${p.taken.time}` : ""}` : p.date}
                        {p.gps ? ` · ${tx("place recorded")}` : ""} · {maskName(p.caption, farmer, user)}
                      </p>
                      {p.byName && <p className="truncate text-xs text-muted">{p.visitor ? tx("Added by {name}, visiting", { name: p.byName }) : tx("Added by {name}", { name: p.byName })}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {/* Stories */}
            <section>
              <SectionLabel>{tx("Success stories")}</SectionLabel>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <p className="text-base font-extrabold">{tx("Notes in progress · {n}", { n: notes.length })}</p>
                  {notes.map((s) => (
                    <article key={s.id} className="bg-sunken p-4">
                      <p className="text-lg font-extrabold leading-snug">{maskName(s.title, farmer, user)}</p>
                      <p className="mt-1 text-sm leading-relaxed text-muted">{maskName(s.text, farmer, user)}</p>
                      <p className="mt-2 text-xs text-muted">
                        {s.date} · {fieldPerson(s.by)}
                      </p>
                      <DocLinks className="mt-2" docs={s.docs} mask={(t) => maskName(t, farmer, user)} onChange={canEdit ? (docs) => setDocs(s.id, docs) : undefined} />
                      {mayWriteStory(user) && <ToSuccessStory project={project.id} user={user.id} farmer={farmer.id} story={s.id} />}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => update((f) => ({ ...f, stories: f.stories.map((x) => (x.id === s.id ? { ...x, status: "completed", date: TODAY } : x)) }))}
                          className={`mt-1 ${bandLink}`}
                        >
                          {tx("Mark as completed story")}
                        </button>
                      )}
                    </article>
                  ))}
                  {canEdit && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!noteTitle.trim() || !noteText.trim()) return;
                        update((f) => ({
                          ...f,
                          stories: [...f.stories, { id: `S-${Date.now()}`, status: "note", title: noteTitle.trim(), text: noteText.trim(), date: TODAY, by: myRole }],
                        }));
                        setNoteTitle("");
                        setNoteText("");
                      }}
                      className="space-y-2 bg-sunken p-4"
                    >
                      <input id="story-title" value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} placeholder={tx("Story title")} className={field} />
                      <textarea id="story-text" rows={2} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder={tx("What happened? Who said it?")} className={field} />
                      <button type="submit" disabled={!noteTitle.trim() || !noteText.trim()} className={`${quietBtn} min-h-12 bg-surface text-base font-bold`}>
                        {tx("Add story note")}
                      </button>
                    </form>
                  )}
                </div>
                <div className="space-y-3">
                  <p className="text-base font-extrabold">{tx("Completed stories · {n}", { n: done.length })}</p>
                  {done.length === 0 && <p className="text-base font-medium text-muted">{tx("None yet. Notes become stories once they are written up; link the write-up wherever it lives.")}</p>}
                  {done.map((s) => (
                    <article key={s.id} className="border-s-[6px] border-deep bg-mist p-4">
                      <p className="text-lg font-extrabold leading-snug text-forest">{maskName(s.title, farmer, user)}</p>
                      <p className="mt-1 text-sm leading-relaxed">{maskName(s.text, farmer, user)}</p>
                      <p className="mt-2 text-xs text-muted">
                        {tx("Completed {date}", { date: s.date })} · {fieldPerson(s.by)}
                      </p>
                      <DocLinks className="mt-2" docs={s.docs} mask={(t) => maskName(t, farmer, user)} onChange={canEdit ? (docs) => setDocs(s.id, docs) : undefined} />
                      {mayWriteStory(user) && <ToSuccessStory project={project.id} user={user.id} farmer={farmer.id} story={s.id} />}
                    </article>
                  ))}
                </div>
              </div>
            </section>

            {/* Engagements */}
            <section>
              <SectionLabel>{tx("Every engagement · {n}", { n: engagements.length })}</SectionLabel>
              <ol className="mt-3 space-y-3 border-s border-line ps-4">
                {engagements.map((e, k) => (
                  <li key={k} className="relative text-sm">
                    <span aria-hidden className="absolute -start-[21px] top-1.5 h-2 w-2 rounded-full bg-forest" />
                    <p className="leading-snug">
                      <span className="me-2 text-sm font-extrabold text-muted">{e.kind}</span>
                      {maskName(e.text, farmer, user)}
                    </p>
                    <p className="text-xs text-muted">
                      {e.date} · {e.who}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          {/* Staff sidebar */}
          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            <div className="bg-sunken p-5">
              <SectionLabel>{tx("Staff supporting {name}", { name: user.pii ? farmer.name.split(" ")[0] : farmer.id })}</SectionLabel>
              <ul className="mt-4 space-y-4">
                {staff.map(({ role, u, last }) => (
                  <li key={role} className="flex gap-3">
                    <Initials name={u.name} />
                    <div className="min-w-0 flex-1">
                      <p className="font-extrabold leading-tight">{u.name}</p>
                      <p className="text-sm font-medium text-muted">{tx(fieldRoleLabel(role))}</p>
                      {u.feedback && (
                        <p className="mt-1 flex items-center gap-1.5 text-sm">
                          <span className="text-2xl font-extrabold leading-none text-forest">{u.feedback.score.toFixed(1)}</span>
                          <span className="text-xs text-muted">{tx("/ 5 farmer feedback · {n} responses", { n: u.feedback.n })}</span>
                        </p>
                      )}
                      <p className="text-xs text-muted">{last ? tx("Last contact {date}", { date: last.date }) : tx("No contact recorded yet")}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <p className="px-1 text-xs leading-relaxed text-muted">
              {tx("Feedback scores average what farmers across the project said about each person. They are fictional, like every record here.")}
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}


/**
 * MF-04: the farmer's sanctions screening. Shown when their package is above the limit or a
 * screening is on file. Recorded by someone who may see names (the check is made by name).
 */
function FarmerScreeningPanel({ farmer, setup, code, user }: { farmer: Farmer; setup: FieldSetup; code: string; user: AppUser }) {
  const { tx } = useT();
  const hold = screeningHold(farmer, setup);
  const last = farmer.screenings?.at(-1);
  const today = new Date().toISOString().slice(0, 10);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ date: today, lists: FARMER_LISTS, result: "clear" as "clear" | "possible_match", note: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  if (!hold && !last) return null;
  const may = user.kind === "employee" && user.pii && (user.fieldAccess === "edit" || user.project.includes("mel-owner"));
  const save = async () => {
    setBusy(true);
    setMsg("");
    const res = await fetch(`/api/projects/${encodeURIComponent(code)}/field/screening`, { method: "POST", headers: { "Content-Type": "application/json", "x-demo-user": user.id }, body: JSON.stringify({ farmer: farmer.id, date: f.date, lists: f.lists, result: f.result, ...(f.note.trim() ? { note: f.note.trim() } : {}) }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg(body.error ?? plainError(res.status));
    setOpen(false);
    setMsg(tx("Recorded. Reload to see it on the record."));
  };
  return (
    <section className={`px-4 py-3 text-base ${hold ? "bg-ochre-soft" : "bg-mist"}`} aria-labelledby="screening-heading">
      <p id="screening-heading" className="font-extrabold">
        {tx("Sanctions screening")}
      </p>
      <p className="mt-1 text-sm">{hold ?? tx("Clear on {date} ({lists}), checked by {name}.", { date: last!.date, lists: last!.lists, name: last!.byName })}</p>
      {may && !open && (
        <button type="button" className={`${quietBtn} mt-2`} onClick={() => setOpen(true)}>
          {tx("Record a screening")}
        </button>
      )}
      {!may && hold && <p className="mt-1 text-xs text-muted">{tx("Someone who may see farmers' names records it.")}</p>}
      {open && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            {tx("Date checked")}
            <input type="date" value={f.date} max={today} onChange={(e) => setF({ ...f, date: e.target.value })} className="mt-1 w-full border border-line bg-surface px-2 py-1.5" />
          </label>
          <label className="block text-sm font-medium">
            {tx("Result")}
            <select value={f.result} onChange={(e) => setF({ ...f, result: e.target.value as typeof f.result })} className="mt-1 w-full border border-line bg-surface px-2 py-1.5">
              <option value="clear">{tx("Clear: not on the lists")}</option>
              <option value="possible_match">{tx("Possible match: a person reviews it")}</option>
            </select>
          </label>
          <label className="block text-sm font-medium sm:col-span-2">
            {tx("Lists checked")}
            <input value={f.lists} maxLength={400} onChange={(e) => setF({ ...f, lists: e.target.value })} className="mt-1 w-full border border-line bg-surface px-2 py-1.5" />
          </label>
          <label className="block text-sm font-medium sm:col-span-2">
            {tx("Note (optional)")}
            <input value={f.note} maxLength={1000} onChange={(e) => setF({ ...f, note: e.target.value })} className="mt-1 w-full border border-line bg-surface px-2 py-1.5" />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" disabled={busy} className={primaryBtn} onClick={() => void save()}>
              {tx("Save the screening")}
            </button>
            <button type="button" className={quietBtn} onClick={() => setOpen(false)}>
              {tx("Cancel")}
            </button>
          </div>
        </div>
      )}
      {msg && <p className="mt-2 text-sm">{msg}</p>}
    </section>
  );
}
