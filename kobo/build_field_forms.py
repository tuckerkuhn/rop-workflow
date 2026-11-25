#!/usr/bin/env python3
"""
Builds the two remaining field forms for a project. Standard library only; reuses the readiness
form's writer. Run:

    python3 kobo/build_field_forms.py            # the demo project, A-2027
    python3 kobo/build_field_forms.py ACRP-2026  # another project (files get the code in their name)

Writes:
- training_attendance.xlsx: one submission per farmer per session, from the signed attendance register.
  In Setup mark it "Training attendance". MEL accepts each one in Project > Verify; an accepted
  "attended: yes" ticks the training checks and moves a farmer at "Train" on to "Prepare the plot"
  (once enrolled and the contribution is paid).
- field_visit.xlsx: the follow-up visit after planting. In Setup mark it "Farm visit". An accepted
  visit that finds the package planted at the trained spacing records planting (the date, and the
  area planted, or the number planted for a crop counted one by one) and completes the farmer's
  season path; otherwise what needs follow-up goes on the farmer's record.

Both follow the other forms: hidden project_code, farmer picked from farmers.csv (ID, village,
initials; no names on devices), photo evidence, GPS. Labels in English, Dari and Pashto; the Dari and
Pashto are drafts for a native speaker to review.
"""
import datetime
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_readiness_form as base  # noqa: E402

FARMER_HINT = ("Search by farmer ID or village", "بر اساس شماره دهقان یا قریه جستجو کنید", "د بزګر د شمېرې یا کلي له مخې ولټوئ")
YES_NO = [("yes_no", "yes", ("Yes", "بلی", "هو")), ("yes_no", "no", ("No", "نخیر", "نه"))]


def training(code):
    survey = [
        ("calculate", "project_code", None, None, "", "", "", f"'{code}'", ""),
        ("start-geopoint", "start_geopoint", None, None, "", "", "", "", ""),
        ("select_one_from_file farmers.csv", "farmer", ("Farmer", "دهقان", "بزګر"), FARMER_HINT, "yes", "", "autocomplete", "", ""),
        ("date", "training_date", ("Training date", "تاریخ آموزش", "د روزنې نېټه"), None, "yes", "", "", "", "today()"),
        # The same for every farmer at one training: the phone offers the last answer, so it is chosen once per session.
        ("select_one session", "session", ("Training session", "جلسه آموزشی", "د روزنې ناسته"), None, "yes", "", "", "", "${last-saved#session}"),
        (
            "select_one yes_no",
            "attended",
            ("Did the farmer attend the classroom and field parts of the session?", "آیا دهقان در بخش‌های صنفی و ساحوی جلسه حاضر بود؟", "ایا بزګر د ناستې په ټولګي او ساحوي برخو کې ګډون وکړ؟"),
            None, "yes", "", "", "", "",
        ),
        (
            "text",
            "register_ref",
            ("Attendance register reference", "مرجع لیست حاضری", "د حاضرۍ لیست مرجع"),
            ("Book and page of the signed register, and where the original is kept", "کتاب و صفحه لیست امضا‌شده و محل نگهداری اصل آن", "د لاسلیک شوي لیست کتاب او پاڼه، او اصلي چېرته ساتل کېږي"),
            "yes", "", "", "", "${last-saved#register_ref}",
        ),
        ("image", "photo", ("Photo of the signed register page", "عکس صفحه امضا‌شده لیست حاضری", "د حاضرۍ د لاسلیک شوي لیست د پاڼې انځور"), None, "yes", "", "", "", ""),
        ("geopoint", "location", ("Training location (GPS)", "موقعیت آموزش (GPS)", "د روزنې ځای (GPS)"), ("The phone did not find its place by itself. Record it here.",) * 3, "", "string-length(${start_geopoint}) = 0", "", "", ""),
        ("text", "notes", ("Anything else to note", "نکات دیگر", "نور یادښتونه"), None, "", "", "multiline", "", ""),
    ]
    choices = [
        ("session", "land_prep", ("Land preparation and planting", "آماده‌سازی زمین و کشت", "د ځمکې چمتو کول او کرنه")),
        ("session", "crop_care", ("Crop care and irrigation", "مراقبت از محصول و آبیاری", "د فصل ساتنه او اوبه ورکول")),
        ("session", "harvest", ("Harvest and storage", "برداشت و ذخیره", "حاصل راټولول او زېرمه کول")),
        *YES_NO,
    ]
    return survey, choices, "training_date"


def visit(code):
    followup = "${planted} = 'no' or ${spacing_ok} = 'no'"
    survey = [
        ("calculate", "project_code", None, None, "", "", "", f"'{code}'", ""),
        ("start-geopoint", "start_geopoint", None, None, "", "", "", "", ""),
        ("select_one_from_file farmers.csv", "farmer", ("Farmer", "دهقان", "بزګر"), FARMER_HINT, "yes", "", "autocomplete", "", ""),
        # The farmer's plot size from farmers.csv, shown with the area planted.
        ("calculate", "farmer_ha", None, None, "", "", "", "pulldata('farmers', 'hectares', 'name', ${farmer})", ""),
        ("date", "visit_date", ("Visit date", "تاریخ بازدید", "د لیدنې نېټه"), None, "yes", "", "", "", "today()"),
        ("select_one purpose", "purpose", ("Purpose of the visit", "هدف بازدید", "د لیدنې موخه"), None, "yes", "", "", "", ""),
        (
            "select_one yes_no",
            "both_present",
            ("Are the extension agent and the MEL officer both at the plot?", "آیا مامور ترویج و مامور نظارت و ارزیابی هر دو در زمین حاضر هستند؟", "ایا د ترویج مامور او د څارنې او ارزونې مامور دواړه په ځمکه کې شته دي؟"),
            None, "yes", "", "", "", "",
        ),
        ("select_one yes_no", "planted", ("Has the farmer planted the inputs received?", "آیا دهقان مواد دریافت‌شده را کشت کرده است؟", "ایا بزګر ترلاسه شوي توکي کرلي دي؟"), None, "yes", "", "", "", ""),
        ("date", "planting_date", ("Date planted", "تاریخ کشت", "د کرنې نېټه"), ("As the farmer reports it", "مطابق گفته دهقان", "لکه څنګه چې بزګر وايي"), "yes", "${planted} = 'yes'", "", "", ""),
        (
            "integer",
            "number_planted",
            ("How many trees, vines or seedlings were planted?", "چند نهال، تاک یا نشا کشت شد؟", "څومره نیالګي، تاکونه یا بوټي وکرل شول؟"),
            ("Only for a crop counted one by one; the app works out the area from the spacing. Leave blank for a crop sown by area.", "فقط برای محصولی که دانه‌دانه شمرده می‌شود؛ برنامه مساحت را از فاصله حساب می‌کند. برای محصولی که بر اساس مساحت کشت می‌شود خالی بگذارید.", "یوازې د هغه فصل لپاره چې یو یو شمېرل کېږي؛ اپ ساحه له واټن څخه محاسبه کوي. د ساحې له مخې کرل شوي فصل لپاره یې خالي پرېږدئ."),
            "", "${planted} = 'yes'", "", "", "",
        ),
        (
            "decimal",
            "area_planted",
            ("Area planted (hectares)", "مساحت کشت‌شده (هکتار)", "کرل شوې ساحه (هکتار)"),
            ("The farmer's plot is ${farmer_ha} ha.", "زمین دهقان ${farmer_ha} هکتار است.", "د بزګر ځمکه ${farmer_ha} هکتاره ده."),
            "yes", "${planted} = 'yes' and string-length(${number_planted}) = 0", "", "", "",
        ),
        (
            "select_one yes_no",
            "spacing_ok",
            ("Planted at the trained spacing and depth?", "آیا با فاصله و عمق آموزش‌داده‌شده کشت شده است؟", "ایا د روزل شوي واټن او ژوروالي سره کرل شوي؟"),
            None, "yes", "${planted} = 'yes'", "", "", "",
        ),
        (
            "text",
            "issue",
            ("What needs follow-up?", "چه چیزی نیاز به پیگیری دارد؟", "څه تعقیب ته اړتیا لري؟"),
            ("Say what the farmer or the team must do, and by when.", "بگویید دهقان یا تیم چه باید بکند و تا چه وقت.", "ووایاست چې بزګر یا ټیم باید څه وکړي او تر کومې نېټې."),
            "yes", followup, "multiline", "", "",
        ),
        ("image", "photo", ("Photo of the plot", "عکس زمین", "د ځمکې انځور"), None, "yes", "", "", "", ""),
        ("geopoint", "location", ("Plot location (GPS)", "موقعیت زمین (GPS)", "د ځمکې ځای (GPS)"), None, "", "", "", "", ""),
    ]
    choices = [
        ("purpose", "planting_followup", ("Planting follow-up", "پیگیری کشت", "د کرنې تعقیب")),
        ("purpose", "germination", ("Germination check", "بررسی جوانه‌زنی", "د زرغونېدو کتنه")),
        ("purpose", "crop_care", ("Crop care check", "بررسی مراقبت محصول", "د فصل د ساتنې کتنه")),
        ("purpose", "harvest_planning", ("Harvest planning", "برنامه‌ریزی برداشت", "د حاصل د راټولولو پلان")),
        *YES_NO,
    ]
    return survey, choices, "visit_date"


FORMS = [
    ("training_attendance", "training attendance", training),
    ("field_visit", "farm visit", visit),
]


def main():
    code = sys.argv[1] if len(sys.argv) > 1 else "A-2027"
    demo = code == "A-2027"
    version = datetime.date.today().strftime("%Y%m%d") + "01"
    here = os.path.dirname(os.path.abspath(__file__))
    slug = code.lower().replace("-", "_")
    for name, title, make in FORMS:
        base.SURVEY, base.CHOICES, date_field = make(code)
        form_id = f"rop_{name}" if demo else f"{slug}_{name}"
        base.SETTINGS = [(f"ROP {title}" if demo else f"{code} {title}", form_id, version, base.LANGS[0], date_field)]
        out = os.path.join(here, f"{name}.xlsx" if demo else f"{slug}_{name}.xlsx")
        base.build(out)
        print(f"Wrote {out} (version {version})")


if __name__ == "__main__":
    main()
