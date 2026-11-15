#!/usr/bin/env python3
"""
Builds an input distribution XLSForm for any project from a small JSON spec (e.g. kobo/acrp_distribution.json).
Standard library only; reuses the readiness form's writer. Run:

    python3 kobo/build_package_form.py kobo/acrp_distribution.json

DRAFT for review. How it differs from the demo maize form (build_distribution_form.py):
- The package can be partial: each item asks "Given to this farmer?" and only then the amount.
  An item answered "No" is not counted, checked against stock or charged to a purchase.
- Planned amounts are not written into the form. The app pushes two media files with the farmer list:
  farmers.csv (ID, village, initials, hectares) and package.csv (each item's amount, unit and whether it
  is per farmer or per hectare, from the package saved in Field activities). The form shows each
  farmer's planned amount from them, so a change to the package needs no new form.
- Answers are <key>_given (yes/no) and <key>_qty (in the package unit). The keys in the spec must match
  the item keys of the project's package in Field activities.

Everything else follows the demo form: farmer picked from farmers.csv (no names on devices), signed
list photo, recipient signature or thumbprint, condition at handover, GPS. Labels in English, Dari and
Pashto; the Dari and Pashto are drafts for a native speaker to review.
"""
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_readiness_form as base  # noqa: E402

GIVEN = ("Given to this farmer?", "آیا به این دهقان داده شد؟", "ایا دې بزګر ته ورکړل شو؟")
AMOUNT = ("Amount given", "مقدار داده‌شده", "ورکړل شوې اندازه")


def plan_calc(key):
    # Planned for this farmer: the item's amount, times the farmer's hectares when it is per hectare.
    qty = f"pulldata('package', 'qty', 'name', '{key}')"
    per = f"pulldata('package', 'per', 'name', '{key}')"
    return f"if({per} = 'hectare', round({qty} * number(${{farmer_ha}}), 2), {qty})"


def survey(spec):
    rows = [
        ("calculate", "project_code", None, None, "", "", "", f"'{spec['project_code']}'", ""),
        (
            "select_one_from_file farmers.csv",
            "farmer",
            ("Farmer receiving the inputs", "دهقان دریافت‌کننده مواد", "هغه بزګر چې توکي ترلاسه کوي"),
            ("Search by farmer ID or village", "بر اساس شماره دهقان یا قریه جستجو کنید", "د بزګر د شمېرې یا کلي له مخې ولټوئ"),
            "yes", "", "autocomplete", "", "",
        ),
        ("calculate", "farmer_ha", None, None, "", "", "", "pulldata('farmers', 'hectares', 'name', ${farmer})", ""),
        ("date", "distribution_date", ("Distribution date", "تاریخ توزیع", "د وېش نېټه"), None, "yes", "", "", "", "today()"),
        ("text", "distribution_point", ("Distribution point", "محل توزیع", "د وېش ځای"), ("Village or store where the inputs were handed over", "قریه یا گدامی که مواد در آن تحویل داده شد", "هغه کلی یا ګدام چې توکي پکې وسپارل شول"), "yes", "", "", "", ""),
    ]
    for it in spec["items"]:
        k = it["key"]
        en, prs, ps = it["label"]
        unit = f"pulldata('package', 'unit', 'name', '{k}')"
        rows += [
            ("calculate", f"{k}_plan", None, None, "", "", "", plan_calc(k), ""),
            ("calculate", f"{k}_unit", None, None, "", "", "", unit, ""),
            ("select_one yes_no", f"{k}_given", (f"{en}: {GIVEN[0]}", f"{prs}: {GIVEN[1]}", f"{ps}: {GIVEN[2]}"), None, "yes", "", "", "", ""),
            (
                "decimal",
                f"{k}_qty",
                (f"{en}: {AMOUNT[0]} (${{{k}_unit}})", f"{prs}: {AMOUNT[1]} (${{{k}_unit}})", f"{ps}: {AMOUNT[2]} (${{{k}_unit}})"),
                (f"Planned for this farmer: ${{{k}_plan}} ${{{k}_unit}}", f"برنامه برای این دهقان: ${{{k}_plan}} ${{{k}_unit}}", f"د دې بزګر لپاره پلان: ${{{k}_plan}} ${{{k}_unit}}"),
                "yes", f"${{{k}_given}} = 'yes'", "", "", "",
            ),
        ]
    rows += [
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
    return rows


def main():
    if len(sys.argv) != 2:
        sys.exit("Usage: python3 kobo/build_package_form.py kobo/<project>_distribution.json")
    with open(sys.argv[1], encoding="utf-8") as f:
        spec = json.load(f)
    keys = [i["key"] for i in spec["items"]]
    if not keys or len(set(keys)) != len(keys):
        sys.exit("The spec needs items with distinct keys.")
    base.SURVEY = survey(spec)
    base.CHOICES = [
        ("yes_no", "yes", ("Yes", "بلی", "هو")),
        ("yes_no", "no", ("No", "نخیر", "نه")),
        ("condition", "good", ("Good, undamaged", "خوب، بدون آسیب", "ښه، بې زیانه")),
        ("condition", "some_damaged", ("Some damaged", "بعضی آسیب دیده", "ځینې زیانمن شوي")),
        ("condition", "damaged", ("Mostly damaged or unusable", "اکثراً آسیب دیده یا غیرقابل استفاده", "ډېری زیانمن یا د کارولو وړ نه")),
    ]
    version = datetime.date.today().strftime("%Y%m%d") + "01"
    base.SETTINGS = [(spec["form_title"], spec["form_id"], version, base.LANGS[0], "distribution_date")]
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), spec["out"])
    base.build(out)
    print(f"Wrote {out} (version {version}, items: {', '.join(keys)})")


if __name__ == "__main__":
    main()
