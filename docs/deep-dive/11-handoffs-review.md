# 11. Handoffs review, 24 Nov 2026 (night)

Branch `deep-dive/handoffs-2026-11-24`, from `main` at `87373d1` (the latest work: main was 7 days
ahead of every other branch). Nothing is on `main`. No migration, no secret, no real person, no live
database, no email sent. Checks: **1,121 tests pass** (1,095 before), typecheck clean, lint clean.

The field ledger is `10-field-ledger.md`. This page is what changed, what you need to decide and how
to see it in ten minutes.

## What changed

**1. The proof now reaches the people who vouch for it.** A KoboCollect distribution needed a photo
of the signed note, but the photo stayed in KoboToolbox. The Director of MEL ticked "I have checked
this record" and the project manager approved with neither of them seeing it. Both now see the signed
note and the handover photo on the approval page, fetched from the project's own KoboToolbox account.
Signed-in staff only: the emailed link alone does not open a photo.

**2. Where and when are read, never typed.** The page shows where the form was filled in (the
phone's GPS), when the photo was taken (the photo's own data) and how far apart the two are. More
than 2 km apart, or a different day, is flagged. Coordinates and the map only for people who may see
participant names. A photo with no place in it is said to be normal, not a fault.

**3. The forms ask less.** GPS is captured when the form opens, with no tap. The GPS question shows
only when the phone found no place. The typed "distribution point" is gone: nothing ever read it.

**4. The date was wrong and is fixed.** The form's distribution date was read by nothing. Records and
their results were dated the day the phone synced, so a paper list entered a week late landed in the
wrong reporting period. Both now use the day the goods were handed out.

**5. The checker can send a record back.** Before, only the project manager could, so the Director of
MEL had to pass on a record she knew was wrong. It goes to the person whose KoboCollect account sent
it. The page tells her the three things to look at and what happens after her tap.

**6. A tick is no longer a photo.** Fixing a sent-back KoboCollect record accepted a tick saying "a
photo is on the farmer's record". Now the photo is taken or chosen on the same page and filed as the
signed note in one step.

**7. Photos in the app: choose, tag, save.** Adding a photo to a farmer's record was a list, a typed
caption and a file, dated the upload day. Now it is the file, one tag and save. The tag says what
happens next before saving. Day, time and place come from the photo. If the photo has no place, one
tap uses the device's location. Expense receipts fill in the expense date the same way.

## Fields asked per role

| Role | Before | After |
|---|---|---|
| Storekeeper, KoboCollect form | 11 questions, 2 typed, 1 GPS tap | 9 questions, 0 typed unless a note, 0 GPS taps |
| Director of MEL, check | 1 tap, proof in another system | 1 tap, proof on the page |
| Project manager, approve | 1 tap | 1 tap |
| Collector, fixing a sent-back record | Amounts, 2 ticks, 1 typed | Amounts, 1 tick, 1 photo, 1 typed |
| Office staff, adding a photo | 1 pick, 1 typed, 1 file | 1 file, 1 tag |

## Decisions I made for you

The first option is what I built. Answer with the letter and number to change one.

- **A. The map.** A1: "Show on a map" loads OpenStreetMap only when tapped, because showing it
  sends the farmer's point to their service. A2: no map, coordinates only. A3: always show the map.
- **B. Who can send a KoboCollect record back.** B1: the checker and the project manager. B2: the
  project manager only, as before.
- **C. A tick in place of the photo.** C1: never accepted. C2: accepted with a written reason.
- **D. The GPS question.** D1: hidden on distribution and training unless the phone found no place,
  kept on readiness and farm visit because standing at the plot is the point. D2: hidden on all four.
- **E. The typed distribution point.** E1: gone. E2: back as a pick list set once in project setup.
- **F. Which day a distribution counts on.** F1: the day of the handout. F2: the day it synced, as before.
- **G. How field staff tag a photo.** G1: by the question they take it on, so there is nothing to
  pick. G2: also a separate "Field photo" form with a tag question for photos outside any form. G2 is
  about half a day: a new kind of form and its place in the review queue.
- **H. The receipt date.** H1: filled from the photo only when it falls in the claim's month and the
  person has not set a date. H2: never prefilled.
- **I. ACRP's distribution form.** I rebuilt its file with the other forms. The live form does not
  change until someone redeploys it. I1: redeploy after the sandbox test. I2: keep ACRP on the old form.
- **J. A rehearsal record.** The KoboCollect path cannot be clicked through without the sandbox
  account. J1: wait for the sandbox, as you decided on 17 Nov. J2: I add a laptop-only script that
  makes one fictional KoboCollect record with photos so the path can be rehearsed. It would never run
  on the live site.

## What I could not verify

1. **A real phone photo through KoboCollect.** The prompt asked for it. I have no phone and no
   KoboToolbox account, so I ran the whole path against a stand-in server on a laptop with a sample
   photo that carries a date and a place. From KoboToolbox's and ODK's own documentation and forums:
   GPS at form start is supported in forms uploaded as XLSForm. A photo's own place survives on recent
   KoboCollect versions and on phones set to geotag photos, and is lost on older versions when the
   form resizes the photo (ours do, to 1,024 pixels, to save data). So the design relies on the form's
   GPS and treats the photo's as a cross-check.
2. **The shape of KoboToolbox's attachment list.** The app matches a photo to its question by the
   question's name, then by file name. Written from the API as I know it, tested with made-up records.
3. **The phone's notice.** KoboCollect shows a line saying the form records location each time it
   opens. Field staff should be told before the first use.
4. **Device location in the photo picker.** Built and typechecked. Not run: a headless browser has
   no location to give.
5. **A production build.** Not run here. CI runs it on a pull request.
6. **Email.** Not set up on the laptop copy, so "has been emailed" was not seen. The wording only
   claims an email when one was sent.

Time: the work took well under the three hours. The cap was a ceiling. Step 6 (a second chain) was
not started: the ledger names it (training attendance) and what to fix first.

## Ten-minute click-through

On your laptop, on this branch, with the demo sign-in. Three parts work without KoboToolbox.

**Part 1. Storekeeper adds a signed note (3 min).** Sign in as Bilal Haidari. Open any farmer.
Tap **+ Add photo**, then **Take or choose photo** and pick any photo taken on your phone.
- See: "Taken (day and time)" and either "Place found in the photo" or "No place in this photo".
- Tap **Signed goods received note**. Read the "What happens next" line. Tap **Save photo**.
- See: the photo listed under its tag with the day it was taken, not today.

**Part 2. Project manager approves (3 min).** Sign in as Nadia Rahimi. On Home open
"Approve the input distribution to F-0002".
- See: the signed note, a "Where and when" box and the goods received checks. Tap **Approve**.
- See: four lines saying where the approval went (results, procurement, finance, audit log).

**Part 3. A receipt dates itself (2 min).** Still signed in, open Expenses and add an expense line.
Attach a photo taken this month.
- See: the date change to the day the photo was taken, with a note saying so.

**Part 4. Director of MEL, once the sandbox exists (2 min).** Deploy `kobo/distribution_form.xlsx`,
send one record from a phone, then sign in as Rahima Stanikzai and open it from Home.
- See: the signed note from the phone, "Where and when", three things to look at, **I have checked
  this record** and **Send back**.

## Next

1. Your answers to A to J.
2. The sandbox KoboToolbox account (open since 17 Nov). It unlocks Part 4 and items 1 to 3 of what
   I could not verify.
3. Then the next chain: training attendance, starting with the register reference typed once per
   farmer (ledger, finding 3).
