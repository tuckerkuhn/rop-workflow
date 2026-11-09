import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import type { AppUser } from "@/lib/demo";
import { withoutNames } from "@/lib/personal-text";
import { AUDIENCE_TEXT, emptyPhotos, needs, PUBLIC_AUDIENCES, rank, SHARE_TEXT, shareLimit, type Audience, type PhotoAction, type PhotoMeta, type PhotosState, type Post, type Share } from "@/lib/photos";
import type { Story } from "@/lib/stories";
import { ROP_VOICE } from "@/lib/voice";
import { draftStructured } from "@/server/ai-structured";
import { logAudit } from "@/server/audit";
import { projectByCode } from "@/server/field-store";
import { aiAllowed } from "@/server/limits";
import { coachPhoto, isDocumentName } from "@/server/photo-coach";
import { loadProjectState, saveProjectState } from "@/server/project-state";
import { loadResults, loadUpdates } from "@/server/results-store";

/** Photos and posts, in project_state ("photos"); see lib/photos. Every sharing decision is in the audit trail. */

const KEY = "photos";
const IMAGE = /^image\/(jpeg|png|webp)$/;

/** Communications work: the comms role, MEL and programme leads. */
export const mayComms = (u: AppUser) => u.kind === "employee" && (!!u.admin || u.project.some((r) => ["comms", "mel-owner", "plan-approver", "report-release"].includes(r)));
const mayDecidePublic = (u: AppUser) => u.kind === "employee" && (!!u.admin || u.project.includes("plan-approver"));

async function loadState(projectId: string) {
  const st = await loadProjectState<PhotosState>(projectId, KEY, emptyPhotos);
  return { photos: st.photos ?? {}, posts: st.posts ?? [], ...(st.publicPosts ? { publicPosts: st.publicPosts } : {}) } as PhotosState;
}

export type PhotoItem = {
  hash: string;
  name: string;
  by: string;
  date: string;
  caption: string;
  province: string;
  district: string;
  activity: string;
  source: { kind: "result" | "update" | "story"; id: string; title: string; status: string };
  storyUses: string[] | null;
};

/** Every image on the project's results, weekly items and stories. */
async function allPhotos(code: string): Promise<{ items: PhotoItem[]; stories: Story[] }> {
  const p = await projectByCode(code);
  const [results, updates, st] = await Promise.all([loadResults(code), loadUpdates(code), loadProjectState<{ stories: Story[] }>(p.id, "stories", { stories: [] })]);
  const inds = new Map((await db.select({ code: s.indicators.code, name: s.indicators.name }).from(s.indicators).where(eq(s.indicators.projectId, p.id))).map((r) => [r.code, r.name]));
  const out = new Map<string, PhotoItem>();
  const add = (i: PhotoItem) => {
    // A story's photo carries its consent: it wins over the same file elsewhere.
    if (!out.has(i.hash) || i.source.kind === "story") out.set(i.hash, i);
  };
  for (const r of results)
    for (const f of r.files)
      if (IMAGE.test(f.type))
        add({ hash: f.hash, name: f.name, by: r.by, date: r.taken?.[f.hash] ?? r.date, caption: r.captions?.[f.hash] ?? "", province: r.province ?? "", district: r.district ?? "", activity: "", source: { kind: "result", id: r.id, title: `${inds.get(r.indicator) ?? r.indicator}: ${r.value}`, status: r.status }, storyUses: null });
  for (const x of updates)
    for (const f of x.files)
      if (IMAGE.test(f.type))
        add({ hash: f.hash, name: f.name, by: x.by, date: x.taken?.[f.hash] ?? x.date, caption: x.captions?.[f.hash] ?? "", province: "", district: "", activity: x.activity, source: { kind: "update", id: x.id, title: x.title || x.note.slice(0, 80), status: "recorded" }, storyUses: null });
  for (const story of st.stories ?? [])
    for (const f of story.photos)
      if (IMAGE.test(f.type))
        add({ hash: f.hash, name: f.name, by: story.by, date: story.at.slice(0, 10), caption: f.caption, province: story.province ?? "", district: story.district ?? "", activity: story.activity ?? "", source: { kind: "story", id: story.id, title: story.title, status: story.status }, storyUses: story.status === "approved" ? [...(story.consent?.uses ?? [])] : [] });
  return { items: [...out.values()].sort((a, b) => b.date.localeCompare(a.date)), stories: st.stories ?? [] };
}

async function langs(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db.select({ id: s.staff.personId, profile: s.staff.profile }).from(s.staff).where(inArray(s.staff.personId, ids));
  return new Map(rows.map((r) => [r.id ?? "", ((r.profile ?? {}) as { lang?: string }).lang ?? "en"]));
}

/**
 * Coaches photos not looked at yet, newest first, up to `limit`, optionally only one person's.
 * Pictures named like documents (attendance sheets, forms) are not sent to the AI at all.
 */
export async function coachNew(code: string, limit = 3, only?: string[]) {
  if (!process.env.ANTHROPIC_API_KEY) return 0;
  const p = await projectByCode(code);
  const { items } = await allPhotos(code);
  const st = await loadState(p.id);
  const todo = items.filter((i) => !st.photos[i.hash]?.coach && !st.photos[i.hash]?.skipped && (!only || only.includes(i.hash))).slice(0, limit);
  if (!todo.length) return 0;
  const lang = await langs([...new Set(todo.map((t) => t.by))]);
  const done: Record<string, PhotoMeta> = {};
  for (const t of todo) {
    if (isDocumentName(t.name, t.caption)) {
      done[t.hash] = { skipped: "Looks like a document, so it was not sent to the AI." };
      continue;
    }
    try {
      const r = await coachPhoto(t.hash, lang.get(t.by) ?? "en");
      done[t.hash] = r.coaching ? { coach: r.coaching } : { skipped: r.skipped ?? "Not looked at." };
    } catch {
      // Left for next time: a failed call is not a decision about the photo.
    }
  }
  // Read again before writing: someone may have cleared a photo or saved a post meanwhile.
  const fresh = await loadState(p.id);
  for (const [h, m] of Object.entries(done)) fresh.photos[h] = { ...fresh.photos[h], ...m };
  await saveProjectState(p.id, KEY, fresh);
  return Object.keys(done).length;
}

/** How far a photo may go now: what was cleared, never beyond what its consent and contents allow today. */
function cleared(m: PhotoMeta | undefined, storyUses: string[] | null): Share {
  const lvl = m?.share?.level ?? "internal";
  const max = shareLimit(m, storyUses).max;
  return rank(lvl) <= rank(max) ? lvl : max;
}
/** In the library: coached photos of the work; a result's only once accepted. */
const inLibrary = (i: PhotoItem, m: PhotoMeta | undefined) => !!m?.coach?.isPhoto && (i.source.kind !== "result" || i.source.status === "accepted");

const weekAgo = (days: number) => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);

export async function photosView(code: string, u: AppUser) {
  const p = await projectByCode(code);
  const { items } = await allPhotos(code);
  const st = await loadState(p.id);
  const withMeta = items.map((i) => {
    const m = st.photos[i.hash];
    const limit = shareLimit(m, i.storyUses);
    return { ...i, coach: m?.coach ?? null, skipped: m?.skipped ?? null, share: cleared(m, i.storyUses), consent: m?.consent ?? null, limit };
  });
  const comms = mayComms(u);
  // Your photos: this week's best and one thing to try, from the last 14 days.
  const mine = withMeta.filter((i) => i.by === u.id && i.date >= weekAgo(14));
  const order = { report: 0, records: 1, retake: 2 } as const;
  const coached = mine.filter((i) => i.coach?.isPhoto);
  const best = [...coached].sort((a, b) => order[a.coach!.label] - order[b.coach!.label] || b.date.localeCompare(a.date))[0] ?? null;
  const toTry = coached.find((i) => i.coach!.label !== "report" && i.coach!.tips.length) ?? null;
  // The team, without names: how the last four weeks' photos were labelled.
  const recent = withMeta.filter((i) => i.coach?.isPhoto && i.date >= weekAgo(28));
  const team = { report: recent.filter((i) => i.coach!.label === "report").length, records: recent.filter((i) => i.coach!.label === "records").length, retake: recent.filter((i) => i.coach!.label === "retake").length };
  return {
    mine: { count: mine.length, waiting: mine.filter((i) => !i.coach && !i.skipped).length, best, toTry, list: mine.slice(0, 24) },
    team,
    library: comms ? withMeta.filter((i) => inLibrary(i, st.photos[i.hash])) : [],
    waiting: withMeta.filter((i) => !i.coach && !i.skipped).length,
    posts: comms ? [...st.posts].sort((a, b) => b.at.localeCompare(a.at)) : [],
    publicPosts: st.publicPosts ?? null,
    may: { comms, decidePublic: mayDecidePublic(u), ai: !!process.env.ANTHROPIC_API_KEY },
    me: u.id,
  };
}

const CHANNEL: Record<Audience, string> = {
  donor: "A short update for the donor's programme team, sent by email or WhatsApp: 80 to 120 words, the result and what it means, the figures exactly as given, a line of thanks for the partnership. No hashtags.",
  traders: "A message for traders and buyers Roots of Peace works with closely, sent by WhatsApp: 60 to 100 words about the product: the crop, its quality, the volumes and when it is ready, as far as the facts say, and the province. No prices unless given. No hashtags.",
  linkedin: "A LinkedIn post for Roots of Peace's page: 120 to 180 words, the result and the people behind it as economic actors, figures as given, ending with at most three relevant hashtags.",
  instagram: "An Instagram caption: 60 to 100 words, warm, the photo's story first, then one figure, then three to five hashtags.",
  facebook: "A Facebook post: 80 to 120 words, plain and warm, the photo's story and one or two figures. At most two hashtags.",
  newsletter: "A newsletter item: a headline line, then 120 to 180 words. No hashtags.",
  website: "A short news item for the website: a headline line, then 150 to 220 words. No hashtags.",
};

const postSchema = z.object({ text: z.string(), checks: z.array(z.string()).describe("Facts to confirm before it goes out. Empty if none.") });

export async function draftPost(code: string, st: PhotosState, audience: Audience, hashes: string[], ask: string | undefined) {
  const p = await projectByCode(code);
  const { items, stories } = await allPhotos(code);
  const chosen = hashes.map((h) => items.find((i) => i.hash === h)).filter((x): x is PhotoItem => !!x);
  const results = await loadResults(code);
  const updates = await loadUpdates(code);
  const facts = {
    project: p.name,
    donor: p.donor,
    audience: AUDIENCE_TEXT[audience],
    photos: chosen.map((c) => ({ shows: st.photos[c.hash]?.coach?.shows ?? "", caption: withoutNames(c.caption), date: c.date, province: c.province })),
    records: chosen.map((c) => {
      if (c.source.kind === "result") {
        const r = results.find((x) => x.id === c.source.id);
        return r && { result: c.source.title, date: r.date, province: r.province, women: r.female, men: r.male, note: withoutNames(r.note).slice(0, 400) };
      }
      if (c.source.kind === "update") {
        const x = updates.find((y) => y.id === c.source.id);
        return x && { update: x.title ?? "", date: x.date, note: withoutNames(x.note).slice(0, 600) };
      }
      const story = stories.find((y) => y.id === c.source.id);
      // A story's text and first name only where its consent covers this use.
      const use = PUBLIC_AUDIENCES.includes(audience) ? "social" : "comms";
      return story && story.status === "approved" && story.consent?.uses.includes(use) ? { story: story.text.slice(0, 1500), firstName: story.firstName ?? null, province: story.province } : { story: "(consent does not cover this use: do not use the story or a name)" };
    }),
    ...(ask ? { request: ask } : {}),
  };
  const system = [
    "You draft posts and messages for Roots of Peace about its project work, from the facts given only. Invent nothing: no figures, quotes, names, prices or outcomes that are not in the facts, and no description of what people do, decide or feel beyond what the facts say. When the facts are thin, write less.",
    "People: present farmers and agribusinesses as economic actors who invest and decide, never as recipients. Use a first name only where the facts give one with a story; otherwise 'a farmer', 'growers' and so on. Places: name the province only, never a village or district.",
    "Credit the donor by name only for the Donor audience and where the facts name one. Write for the channel as described.",
    ROP_VOICE,
  ].join(" ");
  const { out, model } = await draftStructured({ system, task: `Draft one ${AUDIENCE_TEXT[audience]} piece. ${CHANNEL[audience]}`, facts, schema: postSchema, effort: "low", maxTokens: 6000 });
  return { text: out.text.trim(), checks: out.checks, model };
}

export async function photoAction(code: string, u: AppUser, a: PhotoAction): Promise<{ error?: string }> {
  const p = await projectByCode(code);
  if (a.action === "coach") {
    await coachNew(code, 4, a.hashes);
    return {};
  }
  if (!mayComms(u)) return { error: "Only communications, MEL and programme leads can share photos and work on posts." };
  const st = await loadState(p.id);
  const now = new Date().toISOString();
  const { items } = await allPhotos(code);
  const item = (h: string) => items.find((i) => i.hash === h);
  const log = (action: string, detail: Record<string, unknown>) => logAudit(db, p.id, { entity: "photo", entityId: p.id, action, by: u.id, detail });

  if (a.action === "share") {
    const i = item(a.hash);
    if (!i || !inLibrary(i, st.photos[a.hash])) return { error: "Only coached photos of the work, from accepted results, weekly updates or stories, can be shared." };
    const lim = shareLimit(st.photos[a.hash], i.storyUses);
    if (rank(a.level) > rank(lim.max)) return { error: `This photo can go no further than "${SHARE_TEXT[lim.max]}": ${lim.why}` };
    st.photos[a.hash] = { ...st.photos[a.hash], share: { level: a.level, by: u.id, at: now } };
    await saveProjectState(p.id, KEY, st);
    await log("photo_shared", { hash: a.hash, level: a.level });
    return {};
  }
  if (a.action === "consent") {
    if (!item(a.hash)) return { error: "No such photo on this project." };
    st.photos[a.hash] = { ...st.photos[a.hash], consent: { ...a.consent, by: u.id, at: now } };
    await saveProjectState(p.id, KEY, st);
    await log("photo_consent_recorded", { hash: a.hash, uses: a.consent.uses, how: a.consent.how, date: a.consent.date });
    return {};
  }
  if (a.action === "public-posts") {
    if (!mayDecidePublic(u)) return { error: "Only a programme lead or an administrator decides whether this project posts publicly." };
    st.publicPosts = { on: a.on, by: u.id, at: now, note: a.note };
    await saveProjectState(p.id, KEY, st);
    await log("public_posts_set", { on: a.on, note: a.note });
    return {};
  }
  if (a.action === "draft-post") {
    if (await aiAllowed(u.id)) return { error: "The AI limit is reached for now. Try again later." };
    const need = needs(a.audience);
    if (PUBLIC_AUDIENCES.includes(a.audience) && !st.publicPosts?.on) return { error: "Public posts are off for this project. A programme lead can turn them on after checking the donor's visibility agreement." };
    for (const h of a.photos) {
      const i = item(h);
      if (!i || rank(cleared(st.photos[h], i.storyUses)) < rank(need)) return { error: `Every photo must first be cleared for "${SHARE_TEXT[need]}".` };
    }
    const d = await draftPost(code, st, a.audience, a.photos, a.ask);
    const sources = [...new Set(a.photos.map((h) => item(h)?.source.id).filter((x): x is string => !!x))];
    const post: Post = { id: randomUUID(), audience: a.audience, photos: a.photos, text: d.text, sources, status: "draft", by: u.id, at: now, model: d.model, checks: d.checks };
    const fresh = await loadState(p.id);
    fresh.posts.push(post);
    await saveProjectState(p.id, KEY, fresh);
    await log("post_drafted", { id: post.id, audience: a.audience });
    return {};
  }
  const post = st.posts.find((x) => x.id === a.id);
  if (!post) return { error: "No such post." };
  if (a.action === "edit-post") {
    if (post.status === "sent") return { error: "This post has been sent." };
    post.text = a.text;
    post.status = "draft";
    delete post.approved;
  } else if (a.action === "approve-post") {
    if (post.status !== "draft") return { error: "Only a draft can be approved." };
    if (PUBLIC_AUDIENCES.includes(post.audience) && !st.publicPosts?.on) return { error: "Public posts are off for this project." };
    const need = needs(post.audience);
    for (const h of post.photos) if (rank(cleared(st.photos[h], item(h)?.storyUses ?? [])) < rank(need)) return { error: `A photo in this post is no longer cleared for "${SHARE_TEXT[need]}".` };
    post.status = "approved";
    post.approved = { by: u.id, at: now };
  } else if (a.action === "sent-post") {
    if (post.status !== "approved") return { error: "Approve it before marking it sent." };
    post.status = "sent";
    post.sent = { by: u.id, at: now, where: a.where };
  } else {
    if (post.status === "sent") return { error: "A sent post stays on the record." };
    st.posts = st.posts.filter((x) => x.id !== a.id);
  }
  await saveProjectState(p.id, KEY, st);
  await log(`post_${a.action.replace("-post", "")}`, { id: a.id, audience: post.audience });
  return {};
}

/** Whether a comms person may open this file: a photo of the work (not a document) on the project. */
export async function commsMayOpen(projectId: string, hash: string) {
  const st = await loadState(projectId);
  return !!st.photos[hash]?.coach?.isPhoto;
}
