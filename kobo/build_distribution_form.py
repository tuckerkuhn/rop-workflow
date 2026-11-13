#!/usr/bin/env python3
"""
Builds kobo/distribution_form.xlsx, the XLSForm for recording one input package handed to one farmer.
Standard library only; reuses the readiness form's writer. Run:  python3 kobo/build_distribution_form.py

DRAFT for review. Drawn from ROP's own paperwork: the CBARD distribution vouchers (province, district,
community, date, list of recipients signed or thumbprinted), the "Brief report on the delivery and
distribution of inputs", and the 2024 post-distribution assessment (quantities, condition at receipt).

How the app uses it (src/server/distribution.ts, src/server/kobo.ts):
- In Setup, mark this form "Input distribution". Each submission is checked against the goods received
  note for the seed and fertilizer purchases and goes to the project manager to approve.
- seed_kg and npk_kg are compared with the planned package; above plan is flagged.
- signed = no, or no list_photo, is flagged.
- The farmer is picked from farmers.csv (ID, village, initials). No names on devices.

Labels in English, Dari and Pashto. The Dari and Pashto are drafts: have a native speaker review them.
"""
import datetime
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_readiness_form as base  # noqa: E402

base.SURVEY = [
    ("calculate", "project_code", None, None, "", "", "", "'A-2027'", ""),
    (
        "select_one_from_file farmers.csv",
        "farmer",
        ("Farmer receiving the package", "دهقان دریافت‌کننده بسته", "هغه بزګر چې کڅوړه ترلاسه کوي"),
        ("Search by farmer ID or village", "بر اساس شماره دهقان یا قریه جستجو کنید", "د بزګر د شمېرې یا کلي له مخې ولټوئ"),
        "yes", "", "autocomplete", "", "",
    ),
    ("date", "distribution_date", ("Distribution date", "تاریخ توزیع", "د وېش نېټه"), None, "yes", "", "", "", "today()"),
    ("text", "distribution_point", ("Distribution point", "محل توزیع", "د وېش ځای"), ("Village or store where the package was handed over", "قریه یا گدامی که بسته در آن تحویل داده شد", "هغه کلی یا ګدام چې کڅوړه پکې وسپارل شوه"), "yes", "", "", "", ""),
    ("decimal", "seed_kg", ("Certified maize seed given (kg)", "تخم اصلاح‌شده جواری داده‌شده (کیلوگرام)", "د جوارو اصلاح شوی تخم ورکړل شو (کیلوګرامه)"), ("The package plans 10 kg", "بسته ۱۰ کیلوگرام را پیش‌بینی می‌کند", "کڅوړه ۱۰ کیلوګرامه وړاندوینه کوي"), "yes", "", "", "", "10"),
    ("decimal", "npk_kg", ("NPK 17-17-17 given (kg)", "کود NPK 17-17-17 داده‌شده (کیلوگرام)", "د NPK 17-17-17 سره ورکړل شوه (کیلوګرامه)"), ("The package plans 50 kg", "بسته ۵۰ کیلوگرام را پیش‌بینی می‌کند", "کڅوړه ۵۰ کیلوګرامه وړاندوینه کوي"), "yes", "", "", "", "50"),
    ("select_one condition", "condition", ("Condition of the inputs at handover", "وضعیت مواد هنگام تحویل", "د سپارلو پر وخت د توکو حالت"), None, "yes", "", "", "", ""),
    (
        "select_one yes_no",
        "signed",
        ("Did the recipient sign or thumbprint the distribution list?", "آیا دریافت‌کننده لیست توزیع را امضا یا انگشت زد؟", "ایا ترلاسه کوونکي د وېش لیست لاسلیک یا ګوته ولګوله؟"),
        None, "yes", "", "", "", "",
    ),
    ("image", "list_photo", ("Photo of the signed distribution list page", "عکس صفحه امضا‌شده لیست توزیع", "د وېش د لاسلیک شوي لیست د پاڼې انځور"), ("The page with this farmer's signature or thumbprint", "صفحه‌ای که امضا یا نشان انگشت این دهقان را دارد", "هغه پاڼه چې د دې بزګر لاسلیک یا ګوته پرې ده"), "yes", "", "", "", ""),
    ("image", "handover_photo", ("Photo of the handover (optional)", "عکس تحویل (اختیاری)", "د سپارلو انځور (اختیاري)"), None, "", "", "", "", ""),
    ("geopoint", "location", ("Location (GPS)", "موقعیت (GPS)", "ځای (GPS)"), None, "", "", "", "", ""),
    ("text", "notes", ("Anything else to note", "نکات دیگر", "نور یادښتونه"), None, "", "", "multiline", "", ""),
]

base.CHOICES = [
    ("yes_no", "yes", ("Yes", "بلی", "هو")),
    ("yes_no", "no", ("No", "نخیر", "نه")),
    ("condition", "good", ("Good, unopened", "خوب، باز نشده", "ښه، نه دی خلاص شوی")),
    ("condition", "some_damaged", ("Some damaged", "بعضی آسیب دیده", "ځینې زیانمن شوي")),
    ("condition", "damaged", ("Mostly damaged or unusable", "اکثراً آسیب دیده یا غیرقابل استفاده", "ډېری زیانمن یا د کارولو وړ نه")),
]

VERSION = datetime.date.today().strftime("%Y%m%d") + "01"
base.SETTINGS = [("ROP input distribution", "rop_input_distribution", VERSION, base.LANGS[0], "distribution_date")]

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "distribution_form.xlsx")
    base.build(out)
    print(f"Wrote {out} (version {VERSION})")
