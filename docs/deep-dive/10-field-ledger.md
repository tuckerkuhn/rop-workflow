# 10. Field ledger: the farm input distribution chain

Written 24 Nov 2026 (night) on branch `deep-dive/handoffs-2026-11-24`, from `main` at `87373d1`.
Builds on `01-map.md` (the chain) and `04-log.md` (what was built before). It does not redo the map.

**The test applied to every field:** can the system already know this (sign-in, KoboCollect account,
project setup, an earlier step, the photo, the clock, GPS)? If yes, prefill it or remove it. Is it
used anywhere downstream? If no, cut it. What is left is only what that person alone can add.

**How to read "checked":** *run* means I did it in a phone-sized browser against a throwaway local
database with fictional data. *test* means a database test covers it. *read* means code only.

## 1. Once per project: the input package (project manager)

| Field | Who enters | Could come from | Used next | Verdict |
|---|---|---|---|---|
| Items, amount per farmer or hectare, unit | Project manager, once | The budget (not linked today) | Form defaults (`package.csv`), stock check, flags, the purchase's list | Keep. Entered once, used six times |
| Budget line per item | Project manager, once | Budget lines list (picked, not typed) | Which purchase supplies the store | Keep |
| Target the distribution counts toward | Project manager, once | Targets list (picked) | The result made at approval | Keep |

Not changed tonight. *read*

## 2. Goods received (requester, on the purchase)

| Field | Who enters | Could come from | Used next | Verdict |
|---|---|---|---|---|
| Quantity received, signed note | Requester | The purchase order quantity (already the default) | Store stock, the gate on every distribution | Keep. Nobody types stock |

Not changed tonight. *read*

## 3. The KoboCollect distribution form (storekeeper)

| # | Field | Before | Could come from | Used next | Now |
|---|---|---|---|---|---|
| 1 | Project code | Hidden | The form itself | Routes the record | Unchanged |
| 2 | Farmer | Picked from the list | Only the storekeeper knows | Everything | Keep |
| 3 | Distribution date | Defaults to today | The phone's clock | **Was read by nothing: the record and its result were dated the day the phone synced.** Now dates the record and the result | Keep, prefilled. **Fixed** *test* |
| 4 | Distribution point | **Typed, required** | Project setup, GPS, the farmer's village | **Nothing read it** | **Cut** |
| 5 | Amount of each item | Defaults to the package | `package.csv` | Stock check, flags, the purchase's list | Keep, prefilled |
| 6 | Condition at handover | Picked | Only the storekeeper | Blocks approval when damaged | Keep |
| 7 | Signed or thumbprinted? | Yes or no | Only the storekeeper | Blocks approval when no | Keep |
| 8 | Photo of the signed note | Photo, required | Only the storekeeper | Blocked approval when missing, **but nobody downstream could see it**: it stayed in KoboToolbox | Keep. **Now shown to the checker and the approver** *run, test* |
| 9 | Photo of the handover | Photo, optional | Only the storekeeper | **Nothing read it** | Keep, optional. Now shown beside the note |
| 10 | Location (GPS) | **A question to tap**, optional | The phone | The review queue's pin | **Captured when the form opens, no tap.** Asked only when the phone found no place |
| 11 | Notes | Typed, optional | Only the storekeeper | **Nothing reads it** | Left as is. See finding 2 |

**Asked of the storekeeper on the demo form, before:** 11 visible questions, 2 typed (1 of them
required), 1 GPS tap.
**Now:** 9 visible questions: 4 that need the person (farmer, condition, signed, photo), 3 prefilled
(date, two amounts), 2 optional (handover photo, note). Typing only if they choose to leave a note.

## 4. The check of KoboCollect data (Director of MEL)

| Field | Before | Now |
|---|---|---|
| "I have checked this record" | One button. **The photo, the place and the day were not on the page.** She had to open KoboToolbox with another login to see what she was vouching for | The signed note, the handover photo, where and when (below) and the three things to look at are on the page *run* |
| Send back | **Not possible.** Only the project manager could, so a wrong record had to be passed on to be returned | One reason, typed only when something is wrong. Goes to the person whose KoboCollect account sent it *run, test* |
| What happens next | Not said | Said before the tap and after it, with a link to the next record waiting |

## 5. Approval (project manager)

| Field | Before | Now |
|---|---|---|
| Approve | One tap. For a KoboCollect record the page said "attached in KoboToolbox" | The note is on the page. Approving is the confirmation of place, day and photo *run* |
| Reason (send back only) | Typed | Unchanged |

Nothing typed to approve, before or after.

## 6. Where and when: never typed

| Fact | Source, in order | Shown as |
|---|---|---|
| Place | The GPS question when a person answered it, the phone's fix when the form opened, KoboToolbox's own reading, then the photo's own place | "Place captured from the phone's GPS when the form was opened." Coordinates and "Show on a map" only for people who may see participant names |
| Day and time of the photo | The photo's own data (EXIF) | "Photo taken 2026-11-24 09:58." |
| Do they agree? | Distance between the form's point and the photo's; the form's day against the photo's | "The photo was taken 35 m from where the form was filled in." Flagged past 2 km or on another day |
| Missing | Many phones and apps strip a photo's place | Said in plain words as not a fault. The form's point is the one relied on |

## 7. A record sent back (the collector fixes it)

| Field | Before | Now |
|---|---|---|
| Amounts | Prefilled with what was recorded | Unchanged |
| Signature confirmed | Tick | Unchanged (only they know) |
| Photo of the signed note | **A tick** saying one exists (KoboCollect records), or a trip to another screen (app records) | **Taken or chosen on the same page.** Filed on the farmer's record as the signed note with its day, time and place. A tick is no longer accepted *run, test* |
| What you fixed | Typed | Unchanged (only they know) |

## 8. After approval: nothing is typed

| Goes to | What crosses | Change tonight |
|---|---|---|
| Field | Farmer moves to Plant | None |
| Stock | Received less handed out, worked out | None |
| Procurement | The purchase's distribution list: day, place, recipients, women, quantity | None. See finding 5 |
| Finance | "Pay the supplier" task when a payment is due | None |
| Results | One farmer toward the package's target, by sex and village, waiting for MEL | **Dated the day of the handout, not the day of the sync** *test* |
| Audit log | Every step | New entries: checker's send-back, photo added |
| Project progress, donor view | Read the accepted result | None. They read the corrected date |

## 9. Photos added in the app (office staff)

| Field | Before | Now |
|---|---|---|
| Activity | Picked from a list | **One tag, one tap.** The tag says what happens next before saving |
| Caption | **Typed** | Written from the tag |
| Date | **The day it was uploaded**, whatever day the photo was taken | The day and time the photo was taken |
| Place | Not kept | From the photo. If the photo has none, one tap uses the device's location |
| Signed note | **No way to mark a photo as the signed note** since the in-app Distribute step was removed | The "Signed goods received note" tag files it as the proof |

Expense receipts: the expense date is filled in from the receipt photo when the person has not set one.

Weekly update photos (round 3, 25 Nov): the place is read from the photo when it is added, as the date
already was. Nothing is typed. It is shown on the weekly page only to people who may see participant
names. A photo with no place in it is added as before, with no question asked *run, test*.

## 10. Fields asked per role, before and after

| Role | Before | After |
|---|---|---|
| Storekeeper, KoboCollect form | 11 questions, 2 typed, 1 GPS tap | 9 questions, 0 typed unless a note, 0 GPS taps |
| Director of MEL, check | 1 tap, proof in another system | 1 tap, proof on the page. 1 typed reason only to send back |
| Project manager, approve | 1 tap | 1 tap |
| Collector, fixing | Amounts, 2 ticks, 1 typed | Amounts, 1 tick, 1 photo, 1 typed |
| Office staff, adding a photo | 1 pick, 1 typed, 1 file | 1 file, 1 tag |

## 11. Second pass, the same night: six people on a phone

Walked as the storekeeper, the Director of MEL, the project manager, finance, an auditor tracing a
number to its proof and a small organization setting up for the first time.

| Who | Where they stopped, guessed or retyped | Now |
|---|---|---|
| Small organization | **There was no form unless a developer wrote one.** Each project's distribution form was built by hand with a script | Field setup makes the form from the saved package and gives the four steps to put it on phones *run* |
| Storekeeper | Typed each amount, even when it was the planned one (project forms) | One tap per item for "the planned amount". An amount is typed only when it differed *test* |
| Storekeeper | The note they wrote reached nobody | Shown to whoever checks the record, signed-in staff only |
| Extension agent | Typed the same session and register reference for every farmer at a training | One record per session (round 1, 25 Nov). Session, date, register and photo are given once and each farmer who attended is ticked. The "did the farmer attend" question is cut: a farmer who is not ticked did not attend *run, test* |
| MEL, review queue | One training record to accept for every farmer at a session | One record per session. One accept records every ticked farmer and says who moved, who stays at Train and why *run, test* |
| Small organization | **No readiness, training or farm visit form unless a developer ran a script** | Round 2, 25 Nov: Setup makes all three for the project, on the step where the project's forms are chosen, with what to do next and a button to load the list again after the upload *run, test* |
| Extension agent, farm visit | Asked both "how many were planted" and "area planted", and told to leave one blank | The made form asks one of them, by the crop plan saved in Set up: the number for a crop counted one by one with a spacing, the area for any other *test* |
| Extension agent | A date in the future, a planting date after the visit or an area above the plot was found days later by MEL, after the visit | The made forms refuse each one on the phone, at the plot *test, converted* |
| Extension agent, readiness | The plot photo was optional. A record without it was flagged for the checker and the farmer's photo check stayed open | Required on the made form *test* |
| MEL, review queue | Readiness, training and visit photos stayed in KoboToolbox. The queue said "photo: yes" | "See the photo and where it was recorded" on each KoboCollect form *run, test* |
| MEL, project manager | "collected by farida.kobo": an account name, not a person | The person's name when the account is matched. When it is not, the page says so and links to the place to match it |
| Project manager | Stock check failed with what was needed, but no way to get there | Links to the purchases that unblock it |
| Project manager | After approving: "Finance: told when the purchase has a payment to release" | Says who has the task to pay which supplier for which purchase, or that nothing is waiting |
| Checker | After sending back: "the person who recorded it" | Names the person who has the task |
| Everyone | Dates as 2026-11-24, and some showing tomorrow in the evening | 24 November 2026, in the reader's own day, on the approval page and the queue |
| Auditor | Number to result to distribution worked, but the distribution page had no photo for KoboCollect records | The signed note is there, with where and when |

## 12. Findings not fixed, ranked by retyping or risk

1. **The KoboCollect path is still unproven against a real account.** Run against a stand-in server on a
   laptop. A real phone and the sandbox account are needed to prove: KoboToolbox's attachment names, GPS at
   form start on the installed KoboCollect version, whether a photo's own date and place survive, that the
   training form's tick list of farmers can be searched on the phone when the list is long, and that the form the app makes deploys cleanly.
2. *(Closed 25 Nov: the GPS point now goes only to people who may see participant names.)*
3. *(Closed 25 Nov, round 1: training is one record per session with its farmers ticked. Records from the
   earlier form still read, accept and count.)*
4. *(Closed 25 Nov: the list is dated the day of the handout.)*
5. *(Closed 25 Nov, round 2: the app makes the readiness, training and farm visit forms too. The files in
   `kobo/` stay as the three-language drafts.)*
6. **The form the app makes is English only**, like the rest of the app until translation.
7. **A deployed form does not change until it is redeployed.** The files in `kobo/` are rebuilt, ACRP's
   included. ACRP's live form is untouched.
