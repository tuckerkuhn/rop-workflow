# Data protection

How ROP Workflow protects the people whose data it holds. The full review, with the decisions still open, is the "ROP Workflow: data protection review" doc (November 2026).

## Where the data is

- **Database:** Supabase, AWS region us-east-1 (Northern Virginia, United States), daily backups kept 7 days.
- **App servers:** Vercel, in the project's default region.
- **AI:** drafting, checking and translation call Anthropic's API (Claude). Notes are sent with people's names and villages replaced (see below); farmers' names, phones, GPS and files are never sent.

## What protects people

| Data | Protection |
|---|---|
| Farmers' names and phones | Own table, shown only with "Sees participant names" |
| Kobo answers | Answers to questions that identify a person (names, phones, ID numbers) are not stored. If an indicator counts the question, a keyed fingerprint is kept instead, so counting still works. The submission lists what was removed. Edits after review are logged without a copy of the answers |
| Notes and weekly updates | The form warns when a note seems to name someone or their village. Names and villages are replaced before notes go to the AI (English text only); story and post drafts keep first names, and a story's only with recorded consent |
| GPS | Shown only with "Sees participant names"; never on donor links |
| Proof files | Visible to field staff and MEL on the project; fingerprint-checked; never on donor links except captioned photos |
| Stories | Recorded consent first; first names and districts only |
| HR record | HR roles only; tamper-evident; "View as" never opens it |
| Sign-in | Email code. With the Organization setting "People who see personal data sign in with a second step", administrators, HR role holders and anyone who sees names must also use an authenticator app |

## What we collect and why

The same words as the "?" beside each of these fields in the app. They come from one register, `src/lib/field-help.ts`; a test fails if this table and the register differ.

<!-- field-help:start (generated from src/lib/field-help.ts; edit the register, then run UPDATE_DOCS=1 npm test) -->
| Field | Why we ask | How we protect it | Source |
|---|---|---|---|
| Women and men | The donor reports this target by women and men, so they are entered as two counts and stay two counts in every table. | Counts only. No person's name is entered here. | The target's own breakdown, set from the project's results framework. |
| Young people | Some donors ask how many of the people counted are young. | — | Afghanistan National Youth Policy: ages 18 to 35. |
| Province and district | Reports say where the work happened, by province and district. | A form's GPS point is shown only to people allowed to see participants' names, and never on a donor link. Posts are drafted to name the province only. | — |
| What was done | This sentence goes into the donor report's narrative. | Write no person's name and no village. The form warns when it sees one. Before a note goes to the AI, names and villages written in English are removed; post drafts keep first names. Names written in Dari or Pashto are not caught, so leave them out. | — |
| Proof | Every reported number opens the record and the file that prove it. | Files are seen by project staff. A photo goes into a donor report only with a caption, and only once it has been checked for people who can be recognised. | — |
| Consent | A story about a person is written only with their recorded consent, and used only for what they agreed to. | First name and district only. A photo in which someone can be recognised leaves the app only when consent covers that use. | — |
| First name | A story reads better with a person in it, but only if they agreed to be named. | Only the first name is kept. The AI that drafts the story is given it only when consent is recorded, and a post uses it only where the consent covers that channel. | — |
| A woman | The AI that drafts the story is told whether it is about a woman, so it describes the person correctly. It is a yes or no only. | — | — |
| Interview notes | The AI drafts the story from these notes; a person checks it and approves it before it is used. | Before the notes go to the AI, last names and villages written in English are removed, and first names are kept only when consent is recorded. Names written in Dari or Pashto are not caught. | — |
| What happened | Weekly items feed the report's narrative and photos. They never change a reported figure. | Write no person's name and no village. The form warns when it sees one. Before a note goes to the AI, names and villages written in English are removed; post drafts keep first names. Names written in Dari or Pashto are not caught, so leave them out. | — |
| Photos | Dated photos show the work. A captioned photo can go into the donor report. | Files are seen by project staff. A photo goes into a donor report only with a caption, and only once it has been checked for people who can be recognised. | — |
| Farmer photo | A photo of the farmer's plot or activity shows the work was done. | Kept in the app and seen only by staff with access to Field. On the free plan photos are saved small (800 pixels on the long side); full phone quality is part of the paid plan. | — |
<!-- field-help:end -->

## Who has full access

Administrators see every project and manage people, roles and the organization's rules (Settings). Seeing farmers' names and GPS is a separate permission ("Sees participant names"), which none of them holds by default. The list is kept in Settings → People; this table says why each person has it.

| Person | Access | Why | Since |
|---|---|---|---|
| Tucker Kuhn | Administrator | Pilot lead | Start of the pilot |
| Daniel Sandoval | Administrator; all ROP projects | Director of Operations | Start of the pilot |
| Spencer Baird | Administrator | Helps with the programming | 10 Nov 2026 |

## If data leaks or a phone is lost

1. **Within the hour:** tell the data protection lead and the country director. Write down what happened, when, and what data may be exposed.
2. **Stop further exposure:** turn off the person's access in Settings → People; withdraw any donor link involved (Report → Quarterly → Share); if a device is lost, sign it out by turning off and back on the person's access, and change shared passwords.
3. **Find what was seen:** Progress → Audit trail and the Organization audit log show who opened or changed what, and when; donor links log every view.
4. **Protect the people:** if farmers, their families or staff could be at risk, the country director decides within 24 hours whether and how to warn them, through the field team, in person.
5. **Tell those who must know:** the donor, as the grant agreement requires (UNDP expects prompt notice), and any authority the law requires.
6. **Record it** in the lessons record: what happened, what was exposed, what changed so it does not happen again.
