/**
 * What opens the AI assistant from outside its own panel: the event the phone header's button
 * sends, and the assistant's mark. Kept apart from assistant.tsx so the top bar can use both.
 */

export const OPEN_ASSISTANT = "rop:open-assistant";

export function Sparkle({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M12 8l1.5 2.5L16 12l-2.5 1.5L12 16l-1.5-2.5L8 12l2.5-1.5Z" />
    </svg>
  );
}
