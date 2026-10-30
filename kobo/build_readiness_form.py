#!/usr/bin/env python3
"""
Builds kobo/readiness_check.xlsx, the XLSForm for the joint readiness visit.
Standard library only. Run:  python3 kobo/build_readiness_form.py

Rules this form follows (see kobo/README.md):
- Hidden project_code so submissions attach to the right project (A-2027).
- The farmer is picked from farmers.csv (form media pushed by the app): ID, village and
  household-head initials. No names on devices.
- Labels in English, Dari and Pashto. The Dari and Pashto are drafts: have a native
  speaker review them before field use.
"""
import datetime
import os
import zipfile
from xml.sax.saxutils import escape

LANGS = ["English (en)", "Dari (prs)", "Pashto (ps)"]

# type, name, (en, prs, ps) label, (en, prs, ps) hint, required, relevance, appearance, calculation, default
SURVEY = [
    ("calculate", "project_code", None, None, "", "", "", "'A-2027'", ""),
    (
        "select_one_from_file farmers.csv",
        "farmer",
        ("Farmer", "دهقان", "بزګر"),
        ("Search by farmer ID or village", "بر اساس شماره دهقان یا قریه جستجو کنید", "د بزګر د شمېرې یا کلي له مخې ولټوئ"),
        "yes", "", "autocomplete", "", "",
    ),
    ("date", "visit_date", ("Visit date", "تاریخ بازدید", "د لیدنې نېټه"), None, "yes", "", "", "", "today()"),
    ("select_one visit_type", "visit_type", ("Type of visit", "نوع بازدید", "د لیدنې ډول"), None, "yes", "", "", "", ""),
    (
        "select_one yes_no",
        "both_present",
        (
            "Are the extension agent and the MEL officer both at the plot?",
            "آیا مامور ترویج و مامور نظارت و ارزیابی هر دو در زمین حاضر هستند؟",
            "ایا د ترویج مامور او د څارنې او ارزونې مامور دواړه په ځمکه کې شته دي؟",
        ),
        None, "yes", "", "", "", "",
    ),
    (
        "select_one yes_no",
        "ready",
        (
            "Is the plot ready for the input package?",
            "آیا زمین برای دریافت بسته مواد زراعتی آماده است؟",
            "ایا ځمکه د کرنیزو توکو د کڅوړې لپاره چمتو ده؟",
        ),
        (
            "Prepared to the technical spec: cleared, ridges and spacing as trained.",
            "مطابق مشخصات فنی آماده شده: پاک‌کاری، جویچه‌ها و فاصله مطابق آموزش.",
            "د تخنیکي معیار سره سم چمتو شوې: پاکه، لښتي او واټن لکه څنګه چې روزل شوي.",
        ),
        "yes", "", "", "", "",
    ),
    (
        "text",
        "issue",
        ("What needs fixing?", "چه چیزی باید اصلاح شود؟", "څه باید سم شي؟"),
        ("Say exactly what the farmer must change before the recheck.", "دقیقاً بگویید دهقان قبل از بررسی مجدد چه چیزی را باید تغییر دهد.", "په دقیق ډول ووایاست چې بزګر باید له بیا کتنې مخکې څه بدل کړي."),
        "yes", "${ready} = 'no'", "multiline", "", "",
    ),
    ("geopoint", "location", ("Plot location (GPS)", "موقعیت زمین (GPS)", "د ځمکې ځای (GPS)"), None, "", "", "", "", ""),
    ("image", "photo", ("Photo of the plot", "عکس زمین", "د ځمکې انځور"), None, "", "", "", "", ""),
]

CHOICES = [
    ("visit_type", "first", ("First visit", "بازدید اول", "لومړۍ لیدنه")),
    ("visit_type", "recheck", ("Recheck after correction", "بررسی مجدد بعد از اصلاح", "له سمون وروسته بیا کتنه")),
    ("yes_no", "yes", ("Yes", "بلی", "هو")),
    ("yes_no", "no", ("No", "نخیر", "نه")),
]

VERSION = datetime.date.today().strftime("%Y%m%d") + "01"
SETTINGS = [("ROP readiness check", "rop_readiness_check", VERSION, LANGS[0], "visit_date")]


def survey_rows():
    head = ["type", "name"] + [f"label::{l}" for l in LANGS] + [f"hint::{l}" for l in LANGS] + ["required", "relevant", "appearance", "calculation", "default", "parameters"]
    rows = [head]
    for typ, name, label, hint, req, rel, app, calc, default in SURVEY:
        # Smaller photos upload faster on field connections.
        params = "max-pixels=1024" if typ == "image" else ""
        rows.append([typ, name, *(label or ("", "", "")), *(hint or ("", "", "")), req, rel, app, calc, default, params])
    return rows


def choice_rows():
    return [["list_name", "name"] + [f"label::{l}" for l in LANGS]] + [[ln, n, *labels] for ln, n, labels in CHOICES]


def settings_rows():
    return [["form_title", "form_id", "version", "default_language", "instance_name"]] + [[t, i, v, d, f"concat(${{farmer}}, ' ', ${{{n}}})"] for t, i, v, d, n in SETTINGS]


def col(n):
    s = ""
    n += 1
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def sheet_xml(rows):
    out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>']
    for r, row in enumerate(rows, start=1):
        cells = "".join(f'<c r="{col(c)}{r}" t="inlineStr"><is><t xml:space="preserve">{escape(str(v))}</t></is></c>' for c, v in enumerate(row) if v != "")
        out.append(f'<row r="{r}">{cells}</row>')
    out.append("</sheetData></worksheet>")
    return "".join(out)


def build(path):
    sheets = [("survey", survey_rows()), ("choices", choice_rows()), ("settings", settings_rows())]
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            + "".join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1, len(sheets) + 1))
            + "</Types>",
        )
        z.writestr(
            "_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        )
        z.writestr(
            "xl/workbook.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
            + "".join(f'<sheet name="{n}" sheetId="{i}" r:id="rId{i}"/>' for i, (n, _) in enumerate(sheets, start=1))
            + "</sheets></workbook>",
        )
        z.writestr(
            "xl/_rels/workbook.xml.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + "".join(
                f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>'
                for i in range(1, len(sheets) + 1)
            )
            + "</Relationships>",
        )
        for i, (_, rows) in enumerate(sheets, start=1):
            z.writestr(f"xl/worksheets/sheet{i}.xml", sheet_xml(rows))


if __name__ == "__main__":
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "readiness_check.xlsx")
    build(out)
    print(f"Wrote {out} (version {VERSION})")
