# The Ledger template: management and admin pages

The template is round 3 of "ROP Workflow Home: three directions" (artboard D, Ledger; desktop:
"D. Ledger: Grace, CEO, laptop"). Field staff keep Bands; management and admin pages use Ledger.
The pieces are in `src/components/workspace/ledger.tsx`. Use them; do not hand-roll look-alikes.

## The rules

1. **A sheet, not cards.** No floating boxes (`rounded-2xl border bg-surface p-4` cards). Content sits
   in ruled rows on the page. A form or a detail sits under a rule (`Sheet`), not in a box.
2. **Page head** (`PageHead`): back link, optional kicker (project name) in mono, a bold narrow
   title, the date or a count in mono at the right, actions, a one-line purpose, then the
   **double rule** (4px forest, 3px gap, 1px forest).
3. **Section heads** (`SectionHead`): the 6px gold tick, bold narrow 20px. Actions for the section
   sit at its right.
4. **Tables** (`LedgerTable` + `LedgerRow`): a mono 12px column head ruled above and below in ink;
   rows ruled in light grey, the last row in ink; rows numbered 01, 02 in mono when order matters
   or when an auditor will refer to a row; whole row clickable when it opens something.
5. **Figures** (`Fig`, `Figures`): amounts, counts, dates in a table, codes and references are mono
   and tabular; amounts sit right.
6. **One gold row.** At most one row per table gets the gold wash (`first`): the one to look at
   first (most overdue, oldest waiting, furthest over). Say in a quiet line under the table why it
   is shaded, the first time it appears on a page.
7. **Status** (`StatusBlock`): a square solid block, not a rounded pill, where the status is the
   point of the row. Pills (`StatusPill`) stay inside dense lists where a block would shout.
8. **Empty** (`Empty`): one quiet ruled line, never a big dashed box.
9. **Words:** plain, no jargon, no em dashes, never a comma right before "and". Every page keeps its
   "Why this matters" line (`Why`) under the head when it has one.
10. **Touch:** controls at least 44px high (`min-h-11`/`min-h-12`), works at phone width: the
    table head hides and rows wrap; wide tables scroll inside their own box, never the page.

## What does not change

Behaviour, permissions, data, API calls, wording of rules and messages, and test ids. A page
restyle changes markup and classes only.
