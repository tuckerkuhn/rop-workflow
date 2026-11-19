"use client";

import { useEffect, useRef, useState } from "react";

/**
 * In-page questions in place of the browser's own confirm and prompt boxes, which freeze the page,
 * cannot be translated or mirrored for Dari and Pashto, and are hard to use on a phone. The same
 * choices as before: the person says yes or no, or gives a reason or cancels. Cancel never acts.
 *
 *   if (!(await askConfirm({ message: "Remove this story?", confirm: "Remove", danger: true }))) return;
 *   const reason = await askReason({ message: "Why withdraw the approval?", confirm: "Withdraw approval" });
 */

type Base = { message: string; title?: string; confirm: string; cancel?: string; danger?: boolean };
type Req =
  | (Base & { kind: "confirm"; resolve: (v: boolean) => void })
  | (Base & { kind: "reason"; placeholder?: string; min: number; resolve: (v: string | null) => void });

let show: ((r: Req) => void) | null = null;

function open(r: Req) {
  if (show) return show(r);
  // Not mounted (should not happen: the layout mounts it): fall back to the browser's box.
  if (r.kind === "confirm") r.resolve(window.confirm(r.message));
  else r.resolve(window.prompt(r.message)?.trim() || null);
}

/** Asks a yes/no question in the page. Resolves true only when the person presses the confirm button. */
export function askConfirm(o: Base): Promise<boolean> {
  return new Promise((resolve) => open({ ...o, kind: "confirm", resolve }));
}

/** Asks for a reason in the page. Resolves the reason, or null when the person cancels. */
export function askReason(o: Base & { placeholder?: string; min?: number }): Promise<string | null> {
  return new Promise((resolve) => open({ ...o, kind: "reason", min: o.min ?? 3, resolve }));
}

export function DialogHost() {
  const [req, setReq] = useState<Req | null>(null);
  const [text, setText] = useState("");
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    show = (r) => {
      // A second question while one is open: the first counts as cancelled.
      setReq((prev) => {
        if (prev) prev.kind === "confirm" ? prev.resolve(false) : prev.resolve(null);
        return r;
      });
      setText("");
    };
    return () => {
      show = null;
    };
  }, []);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (req && !d.open) d.showModal();
    if (!req && d.open) d.close();
  }, [req]);

  const finish = (ok: boolean) => {
    if (!req) return;
    if (req.kind === "confirm") req.resolve(ok);
    else req.resolve(ok ? text.trim() : null);
    setReq(null);
  };
  const short = req?.kind === "reason" && text.trim().length < req.min;

  return (
    <dialog
      ref={ref}
      aria-labelledby="ask-message"
      onCancel={(e) => {
        // Esc: the same as Cancel.
        e.preventDefault();
        finish(false);
      }}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40"
    >
      {req && (
        <form
          method="dialog"
          className="space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!short) finish(true);
          }}
        >
          {req.title && <h2 className="font-display text-xl">{req.title}</h2>}
          <p id="ask-message" className="whitespace-pre-line text-base leading-relaxed">
            {req.message}
          </p>
          {req.kind === "reason" && (
            <label className="block text-sm font-medium">
              <span className="sr-only">{req.message}</span>
              <textarea
                autoFocus
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={req.placeholder}
                className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-base font-normal focus:border-forest focus:outline-none"
              />
              {short && <span className="mt-1 block text-xs font-normal text-muted">Write a few words to continue.</span>}
            </label>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => finish(false)} className="min-h-11 rounded-full border border-line px-5 text-sm font-semibold text-ink hover:bg-sunken">
              {req.cancel ?? "Cancel"}
            </button>
            <button
              type="submit"
              autoFocus={req.kind === "confirm"}
              disabled={short}
              className={`min-h-11 rounded-full px-5 text-sm font-semibold text-white disabled:opacity-50 ${req.danger ? "bg-clay hover:opacity-90" : "bg-forest hover:opacity-90"}`}
            >
              {req.confirm}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
