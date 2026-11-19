# Translating the app's screens

`screen-text.csv` lists every sentence the translated screens show: the English, then a column each
for Spanish, Dari and Pashto, and where in the app it appears. Make it again at any time:

    npm run i18n:catalog

It prints how many sentences each language has. A sentence with no translation shows in English, so
the app can be translated a screen at a time.

## For the translator

- Fill the spanish, dari and pashto columns. Leave the english column exactly as it is: it is how
  the app finds the sentence.
- Words in curly brackets are filled in by the app: `Planted {date}` becomes "Planted 2026-11-19".
  Keep each `{name}` exactly as written (same spelling, in English), but move it to wherever it
  belongs in your sentence.
- Keep the brackets in role names such as "Farida Noori (Extension agent)": the app looks for them.
- Codes stay as they are: VENDBILL, FACE, GL, KoboToolbox, KoboCollect, NetSuite, SharePoint,
  DEMO_SIGN_IN, and numbers like F-0003 or PR-2027-009.
- Agreed words for the app's own terms are in `docs/PLAIN-WORDS-LIST.md` (Target, Result, Proof...).
  A native speaker should check Dari and Pashto in particular.

## For the developer

- Screen text goes through `tx("Whole sentence")` from `useT()`, with `{placeholders}` for anything
  the app fills in. Never `tx(\`...${x}...\`)` or joined pieces: translators need whole sentences.
- Sentences kept in data (step titles, check labels) are marked `msg("...")` where they are written
  and shown with `tx(value)`.
- Text saved into records (history lines, photo captions, issue types) stays in English in the
  database; only its display is translated.
- Translations go in `src/lib/i18n/text/es.ts`, `fa.ts` and `ps.ts`, keyed by the English sentence.
  The older keyed dictionaries (`src/lib/i18n/en.ts` and friends) keep working beside them.
- Layout uses start/end classes (`ms-2`, `ps-4`, `text-start`, `border-s`), never left/right, so it
  mirrors in Dari and Pashto. Text arrows use `<Arrow />`, which turns round.
