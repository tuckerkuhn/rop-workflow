import { EARLY_DRAFT_WORD, earlyDraftLine } from "@/lib/early-draft";

/**
 * The "Draft" watermark of a report whose period has not ended (lib/early-draft): the word across
 * the page, behind nothing a person presses, and one line that says why. No sign-in is needed
 * to draw it, so a donor's link carries it too.
 */
export function DraftWatermark({ to }: { to: string }) {
  return (
    <>
      <div aria-hidden className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center overflow-hidden print:absolute" data-draft-watermark>
        <span className="-rotate-[30deg] select-none whitespace-nowrap font-display text-[28vw] font-bold uppercase leading-none tracking-widest text-clay opacity-[0.09] sm:text-[20vw]">{EARLY_DRAFT_WORD}</span>
      </div>
      <p role="note" className="mt-3 border-s-[6px] border-clay bg-clay-soft px-3 py-2 text-sm font-semibold">
        {earlyDraftLine(to)}
      </p>
    </>
  );
}
