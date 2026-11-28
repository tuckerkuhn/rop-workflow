# The phone test before Kobo goes (Part 2 step 6)

For Tucker, on a real cheap Android phone. About 90 minutes. Fictional data only, on a test
project, never a project with real farmers. Until every line below passes, the forms tell people
to save with signal (`OFFLINE_PHONE_TEST_PASSED` in `src/lib/app-forms.ts` stays `false`).

## Before you start

1. Use the newest deployment that has the offline forms (branch `build/offline-2026-11-28` or
   later). Sign in on the phone as a storekeeper or extension agent (for example Bilal) on the
   test project.
2. Open each form once **with signal**: Field activities, Fill in a form, then Distribution,
   Readiness check, Training attendance, Farm visit and Register a farmer. Opening a form with
   signal is what keeps a copy on the phone.
3. Write down how many distributions are waiting on the test project (Home, or the distribution
   list), so you can count the new ones at the end.
4. Have about 50 farmers at "Distribute" on the test project, and enough stock for them.

## A. Fifty distributions in airplane mode

5. Turn on airplane mode. Close the app and open it again: Field activities and the forms must
   still open. The distribution form says it opened from the copy kept on the phone.
6. Fill in 50 distributions, each with the photo of the signed distribution receipt. After each
   save the form says **Kept on this phone** and the bar at the top counts up: 1, 2 ... 50.
7. Write down the farmer IDs you used.

**Pass:** all 50 saved without an error; the bar says 50.

## B. A restart

8. Still in airplane mode, switch the phone off and on again. Open the app.

**Pass:** the bar still says 50 saved on this phone. Nothing lost.

## C. Weak signal

9. Turn airplane mode off somewhere with weak signal (one bar, or a slow network). Leave the
   app open on any page. Do not press anything.
10. Watch the bar count down. If the signal drops part way, it stops and carries on when the
    signal is back. Wait until the bar is gone (it may take several minutes for 50 photos).

**Pass:** the bar goes away by itself; nothing is marked "Refused".

## D. Nothing lost, nothing doubled

11. On a laptop, open the test project's distributions waiting for approval.
12. Count the new ones: exactly 50, one for each farmer ID you wrote down, each with its photo.
13. Open three of them: the photo is the receipt you took for that farmer, and the amounts are
    the ones you entered.
14. Repeat step 9 with one more form saved offline and the signal switched off and on twice while
    it sends. It must arrive once.

**Pass:** 50 (then 51), no farmer twice, every photo present.

## If something fails

Write down the step, the farmer ID and what the screen said, and take a screenshot of the bar
(tap it to see the list). Nothing on the phone is lost by a failed send: it stays in the bar until
it is sent or you remove it.

## When everything passes

Tell the developer. They set `OFFLINE_PHONE_TEST_PASSED` to `true`, and the forms stop asking
people to save with signal. Then Kobo can be removed (Part 2 step 7).
