"use client";

import { useEffect, useRef } from "react";

/**
 * An error a person must see. On a long page a message at the top is out of sight when the save
 * button is far below, so this one brings itself into view each time its text changes.
 */
export function ErrorNote({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [children]);
  return (
    <p ref={ref} role="alert" className="mt-4 scroll-mt-24 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
      {children}
    </p>
  );
}
