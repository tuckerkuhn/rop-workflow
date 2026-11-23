"use client";

import { useT } from "@/components/app/i18n";
import { quarterLabel } from "@/components/donor/use-donor-view";
import type { MoneyBlock } from "@/lib/donor-funding";
import type { MoneyView } from "@/server/donor-view-store";

/**
 * A donor's money, as a released report gave it: approved against spent for every budget line
 * their grant pays for, cost share in its own block, and indirect costs where the report states
 * them. Amounts are in the agreement's currency, never converted.
 */

const amount = (n: number) => Math.round(n).toLocaleString("en-US");
const share = (spent: number, approved: number) => (approved > 0 ? `${Math.round((spent / approved) * 100)}%` : "—");

/** One sentence for Home and the reports list. */
export function MoneySentence({ money }: { money: MoneyView }) {
  const { tx } = useT();
  return (
    <>
        {tx("{currency} {spent} spent of {currency} {approved} approved ({pct}), as the {quarter} report gave it.", {
          currency: money.currency,
          spent: amount(money.total.spent),
          approved: amount(money.total.approved),
          pct: share(money.total.spent, money.total.approved),
          quarter: quarterLabel(money.quarter),
        })}
    </>
  );
}

/** One line's four figures, labelled, for the stacked phone layout. */
function LineFigures({ approved, inQuarter, spent }: { approved: number; inQuarter: number; spent: number }) {
  const { tx } = useT();
  const head = "text-xs uppercase tracking-wide text-muted";
  const figures: [string, string, boolean][] = [
    [tx("Approved"), amount(approved), false],
    [tx("Spent this quarter"), amount(inQuarter), false],
    [tx("Spent to date"), amount(spent), false],
    [tx("Left"), amount(approved - spent), approved - spent < 0],
  ];
  return (
    <dl className="mt-2 grid grid-cols-2 gap-2 text-sm tabular-nums">
      {figures.map(([k, v, over]) => (
        <div key={k}>
          <dt className={head}>{k}</dt>
          <dd className={over ? "font-semibold text-clay" : ""}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Lines({ block, caption }: { block: MoneyBlock; caption: string }) {
  const { tx } = useT();
  return (
    <>
    {/* Below a small screen: one block per budget line, stacked, so nothing scrolls sideways on a phone. */}
    <section aria-label={caption} className="mt-3 divide-y divide-line rounded-2xl border border-line bg-surface sm:hidden print:hidden">
      {block.lines.map((l) => (
        <div key={l.code} className="px-4 py-3">
          <h4 className="text-sm">
            <span className="font-mono text-xs text-muted">{l.code} </span>
            {l.description !== l.code && l.description}
            {l.activity && <span className="block text-xs text-muted">{l.activity}</span>}
          </h4>
          <LineFigures approved={l.approved} inQuarter={l.inQuarter} spent={l.spent} />
        </div>
      ))}
      <div className="bg-paper px-4 py-3">
        <h4 className="text-sm font-semibold">{tx("Total of these lines")}</h4>
        <LineFigures approved={block.approved} inQuarter={block.inQuarter} spent={block.spent} />
      </div>
    </section>
    <div className="mt-3 hidden overflow-x-auto rounded-2xl border border-line bg-surface sm:block print:block">
      <table className="w-full min-w-[34rem] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
            <th scope="col" className="px-4 py-2 text-start font-semibold">{tx("Budget line")}</th>
            <th scope="col" className="px-3 py-2 text-end font-semibold">{tx("Approved")}</th>
            <th scope="col" className="px-3 py-2 text-end font-semibold">{tx("Spent this quarter")}</th>
            <th scope="col" className="px-3 py-2 text-end font-semibold">{tx("Spent to date")}</th>
            <th scope="col" className="px-4 py-2 text-end font-semibold">{tx("Left")}</th>
          </tr>
        </thead>
        <tbody>
          {block.lines.map((l) => (
            <tr key={l.code} className="border-b border-line/60 align-top last:border-0">
              <th scope="row" className="px-4 py-2 text-start font-normal">
                <span className="font-mono text-xs text-muted">{l.code} </span>
                {l.description !== l.code && l.description}
                {l.activity && <span className="block text-xs text-muted">{l.activity}</span>}
              </th>
              <td className="px-3 py-2 text-end tabular-nums">{amount(l.approved)}</td>
              <td className="px-3 py-2 text-end tabular-nums">{amount(l.inQuarter)}</td>
              <td className="px-3 py-2 text-end tabular-nums">{amount(l.spent)}</td>
              <td className={`px-4 py-2 text-end tabular-nums ${l.approved - l.spent < 0 ? "font-semibold text-clay" : ""}`}>{amount(l.approved - l.spent)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line bg-paper font-semibold">
            <th scope="row" className="px-4 py-2 text-start">{tx("Total of these lines")}</th>
            <td className="px-3 py-2 text-end tabular-nums">{amount(block.approved)}</td>
            <td className="px-3 py-2 text-end tabular-nums">{amount(block.inQuarter)}</td>
            <td className="px-3 py-2 text-end tabular-nums">{amount(block.spent)}</td>
            <td className="px-4 py-2 text-end tabular-nums">{amount(block.approved - block.spent)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
    </>
  );
}

export function MoneySection({ money, note, preview }: { money: MoneyView | null; note: "noDonor" | "notSet" | null; preview: boolean }) {
  const { tx } = useT();
  const title = tx("How the grant is being spent");
  if (!money)
    return (
      <section id="money" className="mt-10 scroll-mt-24">
        <h2 className="font-display text-2xl">{title}</h2>
        <p className="mt-3 rounded-xl bg-sunken px-4 py-3 text-sm text-muted">
          {note === "notSet"
            ? preview
              ? tx("Spending is not shown to this donor yet: nobody has said which budget lines this grant pays for. Set it in Project settings, under Donors.")
              : tx("Spending is not shown yet: Roots of Peace is still setting which budget lines your grant pays for.")
            : preview
              ? tx("This project has no donor recorded, so there is no grant to show. Add one in Project settings.")
              : tx("No grant is recorded for your organization on this project. Your Roots of Peace contact can put that right.")}
        </p>
      </section>
    );
  const tiles: [string, string][] = [
    [tx("Approved"), `${money.currency} ${amount(money.total.approved)}`],
    [tx("Spent to date"), `${money.currency} ${amount(money.total.spent)}`],
    [tx("Share spent"), share(money.total.spent, money.total.approved)],
    [tx("Spent this quarter"), `${money.currency} ${amount(money.funded.inQuarter)}`],
  ];
  return (
    <section id="money" className="mt-10 scroll-mt-24">
      <h2 className="font-display text-2xl">{title}</h2>
      <p className="mt-1 text-sm text-muted">
        {tx("Figures as the {quarter} report gave them, in {currency}. To date means from the start of the agreement to the end of that quarter.", { quarter: quarterLabel(money.quarter), currency: money.currency })}
        {!money.fromImport && ` ${tx("They come from the budget file: Finance's monthly workbook had not been brought in when the report was released.")}`}
      </p>
      <dl className="mt-3 grid gap-px overflow-hidden rounded-2xl border border-line bg-line grid-cols-2 sm:grid-cols-4">
        {tiles.map(([k, v]) => (
          <div key={k} className="bg-surface px-4 py-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{k}</dt>
            <dd className="mt-1 font-display text-2xl tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      <h3 className="mt-6 text-lg font-semibold">{tx("Paid by your grant: {n} budget lines", { n: money.funded.lines.length })}</h3>
      <Lines block={money.funded} caption={tx("Budget lines paid by the grant")} />
      {money.indirect ? (
        <p className="mt-3 rounded-xl bg-paper px-4 py-3 text-sm">
          {tx("Indirect costs: {currency} {spent} spent of {currency} {approved} approved. They are in the totals above and are not a budget line.", {
            currency: money.currency,
            spent: amount(money.indirect.spent),
            approved: amount(money.indirect.approved),
          })}
        </p>
      ) : (
        <p className="mt-3 text-sm text-muted">
          {money.indirectNote === "partial"
            ? tx("Indirect costs are not shown here. This grant pays for part of the budget and the report states indirect costs for the whole agreement only. Your financial report carries the grant's own figure.")
            : money.indirectNote === "phases"
              ? tx("Indirect costs are not shown here. The agreement has more than one phase and the report states them for all phases together. Your financial report carries the figure.")
              : tx("These figures are direct costs. Indirect costs are not in this report's figures.")}
        </p>
      )}

      {money.share && (
        <>
          <h3 className="mt-8 text-lg font-semibold">{tx("Cost share: {n} budget lines", { n: money.share.lines.length })}</h3>
          <p className="mt-1 text-sm text-muted">{tx("Paid by Roots of Peace or a partner and reported to you as the match. Not counted in the grant's totals above.")}</p>
          <Lines block={money.share} caption={tx("Cost-share budget lines")} />
        </>
      )}
    </section>
  );
}
