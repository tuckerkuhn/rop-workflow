# 11. Handoffs review, 24 Nov 2026 (night, two passes)

Branch `deep-dive/handoffs-2026-11-24`, from `main` at `87373d1`. Nothing is on `main`. No migration,
no secret, no real person, no live database, no email sent. The field ledger is `10-field-ledger.md`.

One page for both passes. Pass 1 tightened the distribution chain. Pass 2 walked it as six people on
a phone and fixed what made each of them stop, guess or retype.

## The three things that matter most

**1. The proof now reaches the people who vouch for it.** KoboCollect photos stayed in KoboToolbox.
The Director of MEL ticked "I have checked this record" and the project manager approved without
either of them seeing the signed note. Now the photo is on the page for distributions, readiness
visits, training and farm visits, with where and when it was taken read from the phone and the photo.

**2. The app makes the form.** A project's KoboCollect distribution form had to be written by a
developer with a script. Field setup now makes it from the package the project manager already
saved, with the four steps to put it on phones. One tap per item when the planned amount was handed
over. Nothing typed unless an amount differed.

**3. A wrong date, fixed.** Records and their results were dated the day the phone synced, not the
day of the handout. A paper list entered a week late landed in the wrong reporting period.

## Everything else that changed

| Who | Before | Now |
|---|---|---|
| Storekeeper | 11 questions, 2 typed, 1 GPS tap | 9 questions, 0 typed unless a note. GPS captured when the form opens |
| Storekeeper | The note they wrote reached nobody | The checker reads it |
| Extension agent | Typed session and register for every farmer at a training | The phone offers the last answer |
| Director of MEL | One button, proof in another system, could not send back | Photo, place, day, three things to look at, send back with a reason |
| Project manager | "Finance: told when the purchase has a payment to release" | Who has the task to pay which supplier, or that nothing is waiting |
| Project manager | A failed stock check with no way forward | Links to the purchases that unblock it |
| Collector fixing a record | A tick saying a photo exists | The photo, taken or chosen on the same page |
| Office staff | A list, a typed caption and a file, dated the upload day | The file, one tag, save. Day, time and place from the photo |
| Everyone | "collected by farida.kobo" | The person's name, or a plain line that the account is not matched yet, with the link |
| Everyone | 2026-11-24, sometimes tomorrow's date in the evening | 24 November 2026, in the reader's own day |


## Added at your request, 23:40: photos from anyone who visits farmers

Before, only people with a field role could add a photo to a farmer. Management and communications
could open the farmer and add nothing.

- **Anyone on the project who can open Field activities can add a photo**: choose, one tag, save.
  Tags: handover, training, farm visit, land preparation, planting.
- **A visitor's photo is a picture, not proof.** It carries their name ("Added by Marcus Bell,
  visiting"), counts toward nothing and starts no approval.
- **The signed goods received note is now kept to the storekeeper and the extension agent.** While
  building this I found the project manager could add that photo and then approve the same
  distribution. That is closed on the farmer page, on the fix page and on the server.
- **Not built: the place on weekly update photos.** Comms already add dated photos there. Adding
  the place needs its own pass, because weekly items are read by many screens and the point must
  stay with people who may see participant names. Someone with no access to Field activities still
  uses the weekly update, not the farmer page.
- **One gap left.** The farmer page's own save does not check the signed note tag on the server.
  The screen no longer offers it to a manager, but a crafted request could still set it.

## Decisions I made for you

The first option is what I built. Answer with the letter and number to change one.

- **A. The map.** A1: "Show on a map" loads OpenStreetMap only when tapped, because showing it sends
  the farmer's point to their service. A2: coordinates only. A3: always show the map.
- **B. Who can send a KoboCollect record back.** B1: the checker and the project manager. B2: the
  project manager only, as before.
- **C. A tick in place of the photo.** C1: never accepted. C2: accepted with a written reason.
- **D. The GPS question.** D1: hidden on distribution and training unless the phone found no place,
  kept on readiness and farm visit because standing at the plot is the point. D2: hidden on all four.
- **E. The typed distribution point.** E1: gone. E2: back as a pick list set once in project setup.
- **F. Which day a distribution counts on.** F1: the day of the handout. F2: the day it synced.
- **G. How field staff tag a photo.** G1: by the question they take it on, so there is nothing to
  pick. G2: also a separate "Field photo" form with a tag question. About half a day.
- **H. The receipt date.** H1: filled from the photo when it falls in the claim's month and no date
  was set. H2: never prefilled.
- **I. ACRP's distribution form.** Its file was rebuilt with the others. The live form does not
  change until someone redeploys it. I1: redeploy after the sandbox test. I2: keep ACRP on the old form.
- **J. A rehearsal record.** J1: wait for the sandbox, as you decided on 17 Nov. J2: I add a
  laptop-only script that makes one fictional KoboCollect record with photos for rehearsal.
- **K. Each item on the form the app makes.** K1: three choices with no default (the planned amount,
  a different amount, not given). One tap, and the storekeeper has to say it. K2: default to "the
  planned amount", zero taps, with the risk that a short handout goes unrecorded.
- **L. The storekeeper's note.** L1: shown to whoever checks the record. L2: cut the question.
- **M. Who can download the form.** M1: anyone who records field activities on the project.
  M2: the project manager and plan approvers only.
- **N. Who can add the signed note's photo.** N1: the storekeeper and the extension agent only.
  N2: also the project manager, accepting that she could then approve it.

## What I could not verify

1. **A real phone.** No phone and no KoboToolbox account. The whole path ran against a stand-in
   server on a laptop with a sample photo that carries a date and a place. From KoboToolbox's and
   ODK's documentation and forums: GPS at form start is supported for forms uploaded as XLSForm. A
   photo's own place survives on recent KoboCollect versions and on phones set to geotag, and is lost
   on older versions when the form resizes the photo (ours do, to save data). So the design relies on
   the form's GPS and treats the photo's as a cross-check.
2. **KoboToolbox's attachment list.** Matched by question name, then by file name. Tested with
   made-up records.
3. **The form the app makes, on KoboToolbox.** It converts cleanly with the standard XLSForm
   converter. It has not been uploaded or filled in on a phone.
4. **The phone remembering the last answer** on the training form. Standard in KoboCollect. Not
   seen on a device, and the web form may not do it.
5. **Device location in the photo picker.** A headless browser has no location to give.
6. **A production build and email.** Not run here. CI builds on a pull request.

## Ten-minute click-through

On your laptop, on this branch, with the demo sign-in. Four parts work without KoboToolbox.

**Part 1. The form for the phone (2 min).** Sign in as Nadia Rahimi. Open Field activities, then
**Input package**. Scroll to "The form for the phone" and tap **Download the distribution form**.
- See: a spreadsheet named for the project and four steps to put it on phones. Open it: one question
  per item of your package.

**Part 2. Storekeeper adds a signed note (3 min).** Sign in as Bilal Haidari. Open any farmer.
Tap **+ Add photo**, then **Take or choose photo** and pick a photo taken on your phone.
- See: "Taken (day and time)" and either "Place found in the photo" or "No place in this photo".
- Tap **Signed goods received note**. Read "What happens next". Tap **Save photo**.

**Part 3. Project manager approves (2 min).** Sign in as Nadia Rahimi. On Home open
"Approve the input distribution to F-0002".
- See: the signed note, a "Where and when" box and the goods received checks. Tap **Approve**.
- See: where the approval went, with the finance line saying exactly who was asked to pay what.

**Part 4. A receipt dates itself (1 min).** Open Expenses, add a line and attach a photo taken this
month. See the date change to the day the photo was taken.

**Part 5. With the sandbox (2 min).** Upload the form from Part 1, send one record from a phone, sign
in as Rahima Stanikzai and open it from Home.
- See: the signed note from the phone, "Where and when", three things to look at, **I have checked
  this record** and **Send back**.

## Next, in order

1. **The sandbox KoboToolbox account** (open since 17 Nov). 20 minutes of yours. It unlocks Part 5
   and items 1 to 4 of what I could not verify. Nothing I can build replaces it.
2. Your answers to A to N.
3. Then: the app makes the readiness, training and visit forms too, and training becomes one record
   per session (ledger, findings 3 and 5).

Checks on the finished branch: **1,134 tests pass** (1,095 before tonight), typecheck clean, lint
clean. Six commits. Time: about 25 minutes for each pass. The 3-hour and 8-hour
figures were ceilings, and the work that is left is not the kind more hours of mine would finish.
