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
| Extension agent | Typed the same session and register reference for every farmer at a training | The phone offers the last answer. Typed once per session |
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
   phone offers the last answer on the training form, and that the form the app makes deploys cleanly.
2. *(Closed 25 Nov: the GPS point now goes only to people who may see participant names.)*
3. **Training is still one record per farmer per session.** The phone now remembers the session and
   register, so nothing is retyped, but one record per session with farmers ticked would be the right shape.
4. *(Closed 25 Nov: the list is dated the day of the handout.)*
5. **Only the distribution form is made by the app.** Readiness, training and visit forms are still the
   hand-built files in `kobo/`. The same approach works for them once their questions are settled.
6. **The form the app makes is English only**, like the rest of the app until translation.
7. **A deployed form does not change until it is redeployed.** The files in `kobo/` are rebuilt, ACRP's
   included. ACRP's live form is untouched.
