import { rank, shareLimit, type PhotosState } from "@/lib/photos";
import { loadProjectState } from "@/server/project-state";

/**
 * Whether a photo may go to a donor: in the report (Word, share link) and in the donor evidence
 * pack alike. The photo library's rule (lib/photos shareLimit): checked for people who can be
 * recognised, and cleared at least for ROP communications by its contents or by recorded consent
 * (its own, or the approved story it belongs to). Unchecked photos wait; they are held, not lost.
 */
export async function donorPhotoRule(projectId: string) {
  const photos = await loadProjectState<PhotosState>(projectId, "photos", { photos: {}, posts: [] });
  const stories = await loadProjectState<{ stories: { status: string; consent?: { uses: string[] }; photos: { hash: string }[] }[] }>(projectId, "stories", { stories: [] });
  const storyUses = (hash: string) => {
    const st = (stories.stories ?? []).find((x) => x.status === "approved" && x.photos.some((f) => f.hash === hash));
    return st ? [...(st.consent?.uses ?? [])] : null;
  };
  return (hash: string): { ok: boolean; why: string } => {
    const meta = photos.photos?.[hash];
    if (!meta?.coach) return { ok: false, why: "not yet checked for people who can be recognised." };
    const lim = shareLimit(meta, storyUses(hash));
    return rank(lim.max) >= rank("comms") ? { ok: true, why: "" } : { ok: false, why: lim.why };
  };
}
