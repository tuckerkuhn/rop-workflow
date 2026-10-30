"use client";

import Link from "next/link";
import { useState } from "react";
import { stageOf } from "@/components/field/workspace";
import { useFieldData } from "@/components/app/use-project-data";
import { Initials, useRequireUser, useSession } from "@/components/app/session";
import { Pill, SectionLabel, TODAY, TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { holderOf } from "@/lib/demo";
import {
  PACKAGE_USD,
  SEASON,
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

const field = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-forest focus:outline-none";

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
  if (surveys.length === 0) return <p className="text-sm text-muted">No surveys yet.</p>;
  const w = 320;
  const h = 120;
  const x = (k: number) => (surveys.length === 1 ? w / 2 : 30 + (k * (w - 60)) / (surveys.length - 1));
  const y = (s: number) => 96 - ((s - 1) / 4) * 76;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label={`Satisfaction scores: ${surveys.map((s) => s.score).join(", ")} out of 5`}>
      {[1, 3, 5].map((s) => (
        <g key={s}>
          <line x1="22" x2={w - 10} y1={y(s)} y2={y(s)} className="stroke-line" strokeDasharray="2 3" />
          <text x="8" y={y(s) + 3} className="fill-muted text-[9px]">
            {s}
          </text>
        </g>
      ))}
      <polyline points={surveys.map((s, k) => `${x(k)},${y(s.score)}`).join(" ")} className="stroke-forest" strokeWidth="2" fill="none" />
      {surveys.map((s, k) => (
        <g key={s.date}>
          <circle cx={x(k)} cy={y(s.score)} r={k === surveys.length - 1 ? 5 : 3.5} className="fill-forest" />
          <text x={x(k)} y={h - 4} textAnchor="middle" className="fill-muted text-[9px]">
            {s.date.slice(0, 7)}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function FarmerProfile({ id }: { id: string }) {
  const { user } = useRequireUser();
  const { money } = useSession();
  const { items, setItems, status, error } = useFieldData();
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState("");
  const [addingPhoto, setAddingPhoto] = useState(false);
  const [photoKind, setPhotoKind] = useState<PhotoKind>("visit");
  const [photoCaption, setPhotoCaption] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteText, setNoteText] = useState("");

  const farmer = items.find((i): i is Farmer => i.kind === "farmer" && i.id === id);
  if (!user) return null;
  if (!farmer)
    return (
      <div className="min-h-screen">
        <TopBar active="field" />
        <p className={`px-6 py-24 text-center ${error ? "text-clay" : "text-muted"}`}>{status === "loading" ? "Loading…" : error || `No farmer with ID ${id}.`}</p>
      </div>
    );

  const myRole = user.field[0];
  const canEdit = user.field.length > 0;
  const update = (fn: (f: Farmer) => Farmer) => setItems((all) => all.map((i) => (i.kind === "farmer" && i.id === id ? fn(i) : i)));
  const citing = items.filter((i): i is Finding => i.kind === "finding" && i.sources.includes(id));
  const latest = farmer.surveys[farmer.surveys.length - 1];
  const gotInputs = ["plant", "complete"].includes(farmer.step);
  const notes = farmer.stories.filter((s) => s.status === "note");
  const done = farmer.stories.filter((s) => s.status === "completed");
  const step = fieldSteps[farmer.step];

  const engagements = [
    ...farmer.timeline.map((e) => ({ date: e.date, kind: "Activity", text: e.what, who: fieldPerson(e.who) })),
    ...farmer.surveys.map((s) => ({ date: s.date, kind: "Survey", text: `Satisfaction ${s.score}/5: “${s.comment}”`, who: fieldPerson(s.by) })),
    ...farmer.stories.map((s) => ({ date: s.date, kind: "Story", text: `${s.status === "completed" ? "Success story" : "Story note"}: ${s.title}`, who: fieldPerson(s.by) })),
    ...citing.map((f) => ({ date: f.timeline[0]?.date ?? TODAY, kind: "Finding", text: `Cited in ${f.id}: ${f.title}`, who: fieldPerson("mel") })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const staff = fieldRoles.map((r) => {
    const u = holderOf("field", r.id)!;
    const last = [...farmer.timeline].reverse().find((e) => e.who === r.id);
    return { role: r.id, u, last };
  });

  return (
    <div className="min-h-screen">
      <TopBar active="field" />
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:py-8">
        <Link href={`/field?open=${farmer.id}`} className="text-sm text-muted hover:text-ink">
          ← Field activities
        </Link>

        <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-8">
            {/* Header */}
            <section className="flex flex-wrap items-start gap-5">
              {user.pii ? (
                <Initials name={farmer.name} className="h-16 w-16 text-2xl" />
              ) : (
                <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-sunken font-mono text-sm text-muted">ID</span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted">{farmer.id}</span>
                  <Pill tone="muted">{SEASON.name}</Pill>
                  {step ? <Pill tone="forest">Now: {step.title}</Pill> : <Pill tone={farmer.step === "removed" ? "clay" : "forest"}>{farmer.step === "removed" ? "Removed" : "Season record complete"}</Pill>}
                </div>
                <h1 className="mt-1 font-display text-4xl leading-tight tracking-tight">{farmerName(farmer, user)}</h1>
                {!user.pii && <p className="text-xs text-muted">Name and contact details are restricted participant data. You see the farmer ID only.</p>}
                <p className="mt-1 text-sm text-muted">
                  {farmer.community} · {farmer.hectares} ha {SEASON.crop.toLowerCase()} · Enrolled {farmer.enrolledOn} · Contribution {farmer.contributionPaid ? "paid" : "not paid"}
                  <br />
                  {farmer.gender} · {farmer.ageBand} · household of {farmer.householdSize}
                </p>
              </div>
              <Link href={`/field?open=${farmer.id}`} className={quietBtn}>
                Open current step
              </Link>
            </section>

            {/* Summary */}
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
              {[
                ["Engagements", String(engagements.length)],
                ["Satisfaction", latest ? `${latest.score} / 5` : "—"],
                ["Season progress", `${Math.min(stageOf(farmer), farmerStages.length)} of ${farmerStages.length}`],
                ["Inputs received", gotInputs ? money(PACKAGE_USD) : "Not yet"],
              ].map(([k, v]) => (
                <div key={k} className="bg-surface px-4 py-3">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{k}</dt>
                  <dd className="mt-1 font-display text-2xl tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>

            {/* Satisfaction */}
            <section className="grid gap-6 rounded-2xl border border-line bg-surface p-5 md:grid-cols-[1.2fr_1fr]">
              <div>
                <SectionLabel>Satisfaction with the project</SectionLabel>
                <div className="mt-3">
                  <SatisfactionChart surveys={farmer.surveys} />
                </div>
                {latest && <p className="mt-2 text-sm text-muted">Latest: “{latest.comment}”</p>}
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
                  className="space-y-3 md:border-l md:border-line md:pl-6"
                >
                  <p className="text-sm font-medium">Record today&rsquo;s satisfaction</p>
                  <div className="flex gap-1.5" role="radiogroup" aria-label="Score out of 5">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={score === s}
                        onClick={() => setScore(s)}
                        className={`grid h-10 w-10 place-items-center rounded-full border font-display text-lg transition ${score >= s && score ? "border-forest bg-forest text-forest-ink" : "border-line bg-paper hover:border-forest/50"}`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  <input id="sat-comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What did the farmer say?" className={field} />
                  <button type="submit" disabled={!score} className={primaryBtn}>
                    Save survey
                  </button>
                </form>
              ) : (
                <p className="text-sm text-muted md:border-l md:border-line md:pl-6">Surveys are recorded by field staff during visits.</p>
              )}
            </section>

            {/* Photos */}
            <section>
              <div className="flex items-center justify-between">
                <SectionLabel>Photos · {farmer.photos.length}</SectionLabel>
                {canEdit && !addingPhoto && (
                  <button type="button" onClick={() => setAddingPhoto(true)} className="text-sm font-semibold text-forest hover:underline">
                    + Add photo
                  </button>
                )}
              </div>
              {addingPhoto && (
                <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-line bg-paper p-4">
                  <label className="text-sm">
                    <span className="block font-medium">Activity</span>
                    <select id="photo-kind" value={photoKind} onChange={(e) => setPhotoKind(e.target.value as PhotoKind)} className={`mt-1 ${field}`}>
                      {(Object.keys(photoLabels) as PhotoKind[]).map((k) => (
                        <option key={k} value={k}>
                          {photoLabels[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="min-w-48 flex-1 text-sm">
                    <span className="block font-medium">Caption</span>
                    <input id="photo-caption" value={photoCaption} onChange={(e) => setPhotoCaption(e.target.value)} className={`mt-1 ${field}`} />
                  </label>
                  <label className={`${primaryBtn} cursor-pointer`}>
                    Choose image
                    <input
                      id="photo-file"
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > 1_500_000) {
                          setPhotoError("That image is over 1.5 MB. This prototype keeps photos in your browser, so use a smaller one.");
                          return;
                        }
                        const reader = new FileReader();
                        reader.onload = () => {
                          update((f) => ({
                            ...f,
                            photos: [
                              ...f.photos,
                              { id: `${f.id}-${Date.now()}`, activity: photoKind, date: TODAY, caption: photoCaption.trim() || `${photoLabels[photoKind]} · ${f.id}`, src: String(reader.result) },
                            ],
                          }));
                          setAddingPhoto(false);
                          setPhotoCaption("");
                          setPhotoError("");
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                  </label>
                  <button type="button" onClick={() => setAddingPhoto(false)} className="px-2 py-3 text-sm text-muted">
                    Cancel
                  </button>
                  {photoError && <p className="w-full text-sm text-clay">{photoError}</p>}
                </div>
              )}
              <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {[...farmer.photos].reverse().map((p) => (
                  <li key={p.id} className="overflow-hidden rounded-xl border border-line bg-surface">
                    <div className="relative aspect-[16/11]">
                      {p.src ? (
                        // eslint-disable-next-line @next/next/no-img-element -- user-uploaded data URL
                        <img src={p.src} alt={maskName(p.caption, farmer, user)} className="h-full w-full object-cover" />
                      ) : (
                        <>
                          <PhotoArt kind={p.activity} />
                          <span className="absolute left-2 top-2 rounded bg-surface/85 px-1.5 py-0.5 text-[10px] text-muted">Placeholder</span>
                        </>
                      )}
                    </div>
                    <div className="px-3 py-2">
                      <p className="text-xs font-semibold">{photoLabels[p.activity]}</p>
                      <p className="truncate text-xs text-muted">
                        {p.date} · {maskName(p.caption, farmer, user)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {/* Stories */}
            <section>
              <SectionLabel>Success stories</SectionLabel>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <p className="text-sm font-medium">Notes in progress · {notes.length}</p>
                  {notes.map((s) => (
                    <article key={s.id} className="rounded-xl border border-dashed border-line bg-surface p-4">
                      <p className="font-medium">{maskName(s.title, farmer, user)}</p>
                      <p className="mt-1 text-sm leading-relaxed text-muted">{maskName(s.text, farmer, user)}</p>
                      <p className="mt-2 text-xs text-muted">
                        {s.date} · {fieldPerson(s.by)}
                      </p>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => update((f) => ({ ...f, stories: f.stories.map((x) => (x.id === s.id ? { ...x, status: "completed", date: TODAY } : x)) }))}
                          className="mt-2 text-sm font-semibold text-forest hover:underline"
                        >
                          Mark as completed story
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
                      className="space-y-2 rounded-xl border border-line bg-paper p-4"
                    >
                      <input id="story-title" value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} placeholder="Story title" className={field} />
                      <textarea id="story-text" rows={2} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="What happened? Who said it?" className={field} />
                      <button type="submit" disabled={!noteTitle.trim() || !noteText.trim()} className={quietBtn}>
                        Add story note
                      </button>
                    </form>
                  )}
                </div>
                <div className="space-y-3">
                  <p className="text-sm font-medium">Completed stories · {done.length}</p>
                  {done.length === 0 && <p className="text-sm text-muted">None yet. Notes become stories once they are written up.</p>}
                  {done.map((s) => (
                    <article key={s.id} className="rounded-xl border border-forest/30 bg-mist p-4">
                      <p className="font-display text-lg leading-snug text-forest">{maskName(s.title, farmer, user)}</p>
                      <p className="mt-1 text-sm leading-relaxed">{maskName(s.text, farmer, user)}</p>
                      <p className="mt-2 text-xs text-muted">
                        Completed {s.date} · {fieldPerson(s.by)}
                      </p>
                    </article>
                  ))}
                </div>
              </div>
            </section>

            {/* Engagements */}
            <section>
              <SectionLabel>Every engagement · {engagements.length}</SectionLabel>
              <ol className="mt-3 space-y-3 border-l border-line pl-4">
                {engagements.map((e, k) => (
                  <li key={k} className="relative text-sm">
                    <span aria-hidden className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-forest" />
                    <p className="leading-snug">
                      <span className="mr-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{e.kind}</span>
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
            <div className="rounded-2xl border border-line bg-surface p-5">
              <SectionLabel>Staff supporting {user.pii ? farmer.name.split(" ")[0] : farmer.id}</SectionLabel>
              <ul className="mt-4 space-y-4">
                {staff.map(({ role, u, last }) => (
                  <li key={role} className="flex gap-3">
                    <Initials name={u.name} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium leading-tight">{u.name}</p>
                      <p className="text-xs text-muted">{fieldRoleLabel(role)}</p>
                      {u.feedback && (
                        <p className="mt-1 flex items-center gap-1.5 text-sm">
                          <span className="font-display text-lg leading-none text-forest">{u.feedback.score.toFixed(1)}</span>
                          <span className="text-xs text-muted">/ 5 farmer feedback · {u.feedback.n} responses</span>
                        </p>
                      )}
                      <p className="text-xs text-muted">{last ? `Last contact ${last.date}` : "No contact recorded yet"}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <p className="px-1 text-xs leading-relaxed text-muted">
              Feedback scores average what farmers across the project said about each person. They are fictional, like every record here.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
