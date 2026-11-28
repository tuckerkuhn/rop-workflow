"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/components/app/i18n";
import { useRequireUser } from "@/components/app/session";
import { useCurrentProject } from "@/components/app/current-project";
import { TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { today } from "@/lib/clock";
import { plainError } from "@/lib/plain-error";
import { householdCounts, parseHousehold, type HouseholdMember } from "@/lib/household";
import { APP_FORM_TEXT, fillText, formProblems, formState, type Answers, type AppForm, type AppFormKind, type FormLists, type Problem, type Question } from "@/lib/app-forms";

/**
 * One field form, filled in inside the app (lib/app-forms): the same screen for all five. Phone
 * first: one question under another, answers as big buttons, the camera for photos, the phone's own
 * place taken when the form opens. The rules run as the person answers; the server checks them
 * again when the form is saved.
 */

const field = "min-h-12 w-full border-2 border-line-strong bg-surface px-3 py-2 text-base focus:border-forest focus:outline-none";
const focusRing = "focus-visible:outline focus-visible:outline-4 focus-visible:-outline-offset-4 focus-visible:outline-forest";
const choiceBtn = (on: boolean) => `min-h-12 w-full border-2 px-3 py-2 text-start text-base font-semibold ${focusRing} ${on ? "border-forest bg-forest text-forest-ink" : "border-line-strong bg-surface hover:bg-ochre-soft"}`;

/** A photo made smaller on the phone before it is sent: 1,024 pixels on its longest side, as KoboCollect did. */
async function smaller(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error("That file is not a photo the phone can read."));
      i.src = url;
    });
    const k = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.8);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The phone's place as KoboCollect wrote it: "lat lon altitude accuracy". */
const here = () =>
  new Promise<string>((ok, fail) => {
    if (!navigator.geolocation) return fail(new Error("This phone does not give its location."));
    navigator.geolocation.getCurrentPosition(
      (p) => ok(`${p.coords.latitude.toFixed(6)} ${p.coords.longitude.toFixed(6)} ${Math.round(p.coords.altitude ?? 0)} ${Math.round(p.coords.accuracy)}`),
      () => fail(new Error("The phone did not give its location. Allow location for this site, or record it on the question below.")),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    );
  });

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

export function FormRunner({ kind }: { kind: AppFormKind }) {
  const { user } = useRequireUser();
  const { tx } = useT();
  const { project } = useCurrentProject();
  const code = project.id;
  const [data, setData] = useState<{ form: AppForm; lists: FormLists } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [answers, setAnswers] = useState<Answers>({});
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [entryId, setEntryId] = useState(newId);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  // Register a farmer: the server found someone who may be this farmer (lib/duplicates).
  const [maybeDuplicate, setMaybeDuplicate] = useState(false);
  const [saved, setSaved] = useState<null | { again: boolean; farmer?: string }>(null);
  const [placeNote, setPlaceNote] = useState("");
  const url = `/api/projects/${encodeURIComponent(code)}/field/entries?kind=${kind}`;
  const headers = useMemo(() => ({ "x-demo-user": user?.id ?? "" }), [user?.id]);

  useEffect(() => {
    if (!user) return;
    let gone = false;
    void (async () => {
      try {
        const res = await fetch(url, { cache: "no-store", headers });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? plainError(res.status));
        if (!gone) setData(body);
      } catch (e) {
        if (!gone) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      gone = true;
    };
  }, [url, headers, user]);

  // The phone's place, taken once when the form opens: nothing to tap.
  const asked = useRef("");
  useEffect(() => {
    if (!data || asked.current === entryId || !data.form.questions.some((q) => q.kind === "here")) return;
    asked.current = entryId;
    here()
      .then((v) => setAnswers((a) => ({ ...a, start_geopoint: v })))
      .catch((e: Error) => setPlaceNote(e.message));
  }, [data, entryId]);

  if (!user) return null;
  const day = today();
  const state = data ? formState(data.form, answers, data.lists, day) : null;
  const problems: Problem[] = data && tried ? formProblems(data.form, answers, data.lists, day) : [];
  const problemOf = (n: string) => problems.find((p) => p.name === n)?.text;
  const set = (name: string, v: string) => setAnswers((a) => ({ ...a, [name]: v }));
  const text = APP_FORM_TEXT[kind];

  const save = async (duplicatesChecked = false) => {
    if (!data) return;
    setTried(true);
    if (formProblems(data.form, answers, data.lists, day).length) return;
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch(url, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ entryId, answers, photos, ...(duplicatesChecked ? { duplicatesChecked } : {}) }) });
      const body = await res.json().catch(() => ({}));
      setMaybeDuplicate(res.status === 409 && Array.isArray(body.duplicates));
      if (!res.ok) throw new Error(body.error ?? plainError(res.status));
      setSaved({ again: !!body.again, farmer: body.farmer?.id });
      window.scrollTo(0, 0);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const another = () => {
    setAnswers({});
    setPhotos({});
    setTried(false);
    setSaved(null);
    setSaveError("");
    setPlaceNote("");
    setEntryId(newId());
    window.scrollTo(0, 0);
  };

  return (
    <div className="min-h-screen pb-24">
      <TopBar active="field" />
      <main className="mx-auto max-w-2xl px-4 py-6 font-bands sm:px-6">
        <Link href="/work?source=field" className={`inline-flex min-h-12 items-center font-bold text-muted hover:text-ink ${focusRing}`}>
          {tx("← Field activities")}
        </Link>
        <h1 className="mt-2 text-3xl font-extrabold leading-tight">{tx(text.title)}</h1>
        <p className="mt-1 text-base text-muted">
          {tx(text.what)} {code}
        </p>

        {loadError && (
          <p role="alert" className="mt-6 bg-clay px-4 py-3 font-bold text-white">
            {loadError}
          </p>
        )}
        {!data && !loadError && <p className="mt-10 text-center text-lg font-bold text-muted">{tx("Loading…")}</p>}

        {saved && (
          <section role="status" className="mt-6 border-s-[6px] border-forest bg-surface px-4 py-4">
            <p className="text-xl font-extrabold">{saved.farmer ? tx("{id} is registered.", { id: saved.farmer }) : saved.again ? tx("This form was already saved. Nothing was saved twice.") : tx("Saved.")}</p>
            <p className="mt-1 text-base">
              {kind === "register"
                ? tx("They are on the farmer list in Field activities, at Train.")
                : kind === "distribution"
                  ? tx("It goes to the project manager to approve, with its checks.")
                  : tx("It waits in the review queue for someone else to check it. Nothing changes for the farmer until it is accepted.")}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={another} className={`${primaryBtn} min-h-12 ${focusRing}`}>
                {tx("Fill in another")}
              </button>
              <Link href="/work?source=field" className={`${quietBtn} inline-flex min-h-12 items-center ${focusRing}`}>
                {tx("Back to Field activities")}
              </Link>
            </div>
          </section>
        )}

        {data && state && !saved && (
          <form
            className="mt-6 space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {data.form.questions.some((q) => q.kind === "here") && (
              <p className="text-sm text-muted">{answers.start_geopoint ? tx("Place recorded from the phone's GPS.") : placeNote || tx("Finding the phone's place…")}</p>
            )}
            {data.form.questions
              // The phone's place when the form opened is taken without a question (above).
              .filter((q) => state.shown.has(q.name) && q.kind !== "here")
              .map((q) => (
                <Ask key={q.name} q={q} form={data.form} lists={data.lists} values={state.values} value={state.values[q.name] ?? ""} photo={photos[q.name]} problem={problemOf(q.name)} day={day} onChange={(v) => set(q.name, v)} onPhoto={(src, name) => { setPhotos((p) => ({ ...p, [q.name]: src })); set(q.name, name); }} />
              ))}
            {problems.length > 0 && (
              <div role="alert" className="border-s-[6px] border-clay bg-surface px-4 py-3">
                <p className="font-extrabold">{problems.length === 1 ? tx("1 answer to check before saving:") : tx("{n} answers to check before saving:", { n: problems.length })}</p>
                <ul className="mt-1 list-disc ps-5">
                  {problems.map((p) => (
                    <li key={p.name}>
                      <a href={`#q-${p.name}`} className="underline">
                        {p.text}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {saveError && (
              <p role="alert" className="bg-clay px-4 py-3 font-bold text-white">
                {saveError}
              </p>
            )}
            {maybeDuplicate && (
              <button type="button" disabled={saving} onClick={() => void save(true)} className={`${quietBtn} min-h-12 w-full text-base ${focusRing}`}>
                {tx("I checked: this is a different person. Register them")}
              </button>
            )}
            <button type="submit" disabled={saving} className={`${primaryBtn} min-h-12 w-full text-base ${focusRing}`}>
              {saving ? tx("Saving…") : kind === "register" ? tx("Register the farmer") : tx("Save the form")}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}

function Ask({ q, form, lists, values, value, photo, problem, day, onChange, onPhoto }: { q: Question; form: AppForm; lists: FormLists; values: Record<string, string>; value: string; photo?: string; problem?: string; day: string; onChange: (v: string) => void; onPhoto: (src: string, name: string) => void }) {
  const { tx } = useT();
  const id = `q-${q.name}`;
  const label = fillText(q.label, values);
  const hint = q.hint ? fillText(q.hint, values) : "";
  return (
    <fieldset id={id} className={`scroll-mt-24 ${problem ? "border-s-4 border-clay ps-3" : ""}`}>
      <legend className="text-lg font-extrabold leading-snug">
        {label}
        {!q.required && <span className="ms-1 text-sm font-semibold text-muted">{tx("(optional)")}</span>}
      </legend>
      {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
      <div className="mt-2">
        <Input q={q} form={form} lists={lists} value={value} photo={photo} day={day} onChange={onChange} onPhoto={onPhoto} label={label} />
      </div>
      {problem && <p className="mt-1 text-sm font-bold text-clay">{problem}</p>}
    </fieldset>
  );
}

function Input({ q, form, lists, value, photo, day, label, onChange, onPhoto }: { q: Question; form: AppForm; lists: FormLists; value: string; photo?: string; day: string; label: string; onChange: (v: string) => void; onPhoto: (src: string, name: string) => void }) {
  const { tx } = useT();
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");
  if (q.kind === "household") return <Household value={value} label={label} onChange={onChange} />;
  if (q.kind === "one")
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {(form.choices[q.list!] ?? []).map((c) => (
          <button key={c.name} type="button" aria-pressed={value === c.name} onClick={() => onChange(value === c.name && !q.required ? "" : c.name)} className={choiceBtn(value === c.name)}>
            {tx(c.label)}
          </button>
        ))}
      </div>
    );
  if (q.kind === "farmer" || q.kind === "farmers") {
    const many = q.kind === "farmers";
    const ticked = new Set(value.split(" ").filter(Boolean));
    const s = search.trim().toLowerCase();
    const matches = lists.farmers.filter((f) => !s || f.label.toLowerCase().includes(s));
    const chosen = !many && lists.farmers.find((f) => f.name === value);
    if (chosen && !search)
      return (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-h-12 flex-1 border-2 border-forest bg-surface px-3 py-2.5 text-base font-bold">{chosen.label}</p>
          <button type="button" onClick={() => onChange("")} className={`${quietBtn} min-h-12 ${focusRing}`}>
            {tx("Change")}
          </button>
        </div>
      );
    const toggle = (n: string) => {
      const next = new Set(ticked);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      onChange(lists.farmers.filter((f) => next.has(f.name)).map((f) => f.name).join(" "));
    };
    return (
      <div>
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx("Farmer ID or village")} aria-label={tx("Search: {what}", { what: label })} className={field} />
        {many && <p className="mt-1 text-sm font-bold">{ticked.size === 1 ? tx("1 farmer ticked") : tx("{n} farmers ticked", { n: ticked.size })}</p>}
        <ul className="mt-2 max-h-80 space-y-1 overflow-y-auto">
          {(many ? matches : matches.slice(0, 12)).map((f) => (
            <li key={f.name}>
              {many ? (
                <label className={`flex min-h-12 cursor-pointer items-center gap-3 border-2 px-3 py-2 ${ticked.has(f.name) ? "border-forest bg-ochre-soft" : "border-line bg-surface"}`}>
                  <input type="checkbox" checked={ticked.has(f.name)} onChange={() => toggle(f.name)} className="size-5 accent-[var(--color-forest)]" />
                  <span className="text-base">{f.label}</span>
                </label>
              ) : (
                <button type="button" onClick={() => { onChange(f.name); setSearch(""); }} className={choiceBtn(false)}>
                  {f.label}
                </button>
              )}
            </li>
          ))}
          {!matches.length && <li className="text-sm text-muted">{tx("No farmer on this project matches.")}</li>}
          {!many && matches.length > 12 && <li className="text-sm text-muted">{tx("{n} more: type more of the ID or village.", { n: matches.length - 12 })}</li>}
        </ul>
      </div>
    );
  }
  if (q.kind === "date") return <input type="date" value={value} max={day} onChange={(e) => onChange(e.target.value)} aria-label={label} className={field} />;
  if (q.kind === "decimal" || q.kind === "integer")
    return <input type="text" inputMode={q.kind === "integer" ? "numeric" : "decimal"} value={value} onChange={(e) => onChange(e.target.value.replace(",", "."))} aria-label={label} className={field} />;
  if (q.kind === "text") return q.multiline ? <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className={field} /> : <input type="text" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className={field} />;
  if (q.kind === "image")
    return (
      <div>
        {photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt={tx("Photo taken for: {what}", { what: label })} className="mb-2 max-h-64 border border-line object-contain" />
        )}
        <label className={`${photo ? quietBtn : primaryBtn} inline-flex min-h-12 cursor-pointer items-center ${focusRing}`}>
          {busy || (photo ? tx("Take it again") : tx("Take the photo"))}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              setBusy(tx("Preparing the photo…"));
              try {
                onPhoto(await smaller(f), f.name || "photo.jpg");
              } catch (err) {
                window.setTimeout(() => setBusy(""), 3000);
                setBusy(err instanceof Error ? err.message : String(err));
                return;
              }
              setBusy("");
            }}
          />
        </label>
      </div>
    );
  if (q.kind === "place")
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={async () => {
            setBusy(tx("Finding the place…"));
            try {
              onChange(await here());
              setBusy("");
            } catch (e) {
              setBusy(e instanceof Error ? e.message : String(e));
            }
          }}
          className={`${quietBtn} min-h-12 ${focusRing}`}
        >
          {value ? tx("Record it again") : tx("Record my location")}
        </button>
        <span className="text-sm text-muted">{busy || (value ? tx("Recorded.") : "")}</span>
      </div>
    );
  return null;
}

/** The household roster (MF-07): one line per person, sex and age, no names. */
function Household({ value, label, onChange }: { value: string; label: string; onChange: (v: string) => void }) {
  const { tx } = useT();
  // Kept as typed, so an age being typed is not lost; the answer is the roster text.
  const [rows, setRows] = useState<{ sex: HouseholdMember["sex"]; age: string }[]>(() => parseHousehold(value).members.map((m) => ({ sex: m.sex, age: String(m.age) })));
  const put = (next: typeof rows) => {
    setRows(next);
    onChange(next.map((r) => `${r.sex} ${r.age.trim() || "?"}`).join(", "));
  };
  const read = parseHousehold(value);
  const c = householdCounts(read.members);
  return (
    <div className="grid gap-2">
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <span className="w-8 font-mono text-sm text-muted">{i + 1}.</span>
          {(["Female", "Male"] as const).map((s) => (
            <button key={s} type="button" aria-pressed={r.sex === s} onClick={() => put(rows.map((x, k) => (k === i ? { ...x, sex: s } : x)))} className={`${choiceBtn(r.sex === s)} !w-auto`}>
              {tx(s)}
            </button>
          ))}
          <input type="text" inputMode="numeric" value={r.age} placeholder={tx("Age")} aria-label={tx("{label}: age of person {n}", { label, n: i + 1 })} onChange={(e) => put(rows.map((x, k) => (k === i ? { ...x, age: e.target.value.replace(/\D/g, "").slice(0, 3) } : x)))} className={`${field} !w-24`} />
          <button type="button" onClick={() => put(rows.filter((_, k) => k !== i))} className={quietBtn}>
            {tx("Remove")}
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => put([...rows, { sex: "Female", age: "" }])} className={quietBtn}>
          {tx("+ Add a person")}
        </button>
        {!read.problem && c.size > 0 && <span className="text-sm text-muted">{tx("{size} people: {women} women, {men} men, {girls} girls, {boys} boys", c)}</span>}
      </div>
    </div>
  );
}
