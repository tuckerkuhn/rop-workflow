/**
 * One line on why the donor or an auditor asks for what this page keeps. The app is for teams
 * running a first grant: the reason is said once, on the page, in plain words.
 */
export function Why({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 max-w-2xl border-s-[6px] border-warn ps-3 text-sm print:hidden">
      <span className="font-ledger font-bold">Why this matters. </span>
      {children}
    </p>
  );
}
