/** A text arrow that points the reading direction: flips in Dari and Pashto. */
export function Arrow({ back = false }: { back?: boolean }) {
  return (
    <span aria-hidden className="inline-block rtl:-scale-x-100">
      {back ? "←" : "→"}
    </span>
  );
}
