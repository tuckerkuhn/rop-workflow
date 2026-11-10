# Plain words: the before and after list (C4)

Written 10 Nov 2026 for your review. **Nothing in the app has been changed.** The build list asks for this list first; the change itself is one branch once you have marked it up.

The rule, from the build list: in the app's own screens use **Target**, **Result** and **Proof**; say "by women and men, age and place" where the app says "disaggregation"; anything that goes to a donor keeps the donor's words.

How the list was made: a script read every string in `src/lib/i18n/` (1,256 English strings) and kept those with "indicator", "actual" or "disaggregation". That gave 28. Text typed straight into screens was found by search and is in section 2; a search can miss a sentence built from parts, so section 2 may not be complete.

## Words in the other three languages

My proposals. A native reader should choose; the Dari and Pashto in particular.

| English | Spanish | Dari | Pashto |
|---|---|---|---|
| Target | Meta | هدف | هدف |
| Result | Resultado | نتیجه | پایله |
| Proof | Prueba | مدرک | ثبوت |
| Spending (for "actual") | Gasto | مصارف | لګښت |
| by women and men, age and place | por mujeres y hombres, edad y lugar | به تفکیک زنان و مردان، سن و محل | د ښځو او نارینه وو، عمر او ځای په توپیر |

Today Spanish says "indicador", and Dari and Pashto say "شاخص", wherever English says "indicator". `nav.budget` is already "budget and spending" in all three.

## 1. Strings in the dictionaries (28)

"Keep" means the string goes to a donor and stays as it is.

| Key | Before | After | Note |
|---|---|---|---|
| `nav.budget` | Budget vs actual | Budget and spending | As the build list says. |
| `stage.signOffWhat` | Signing off confirms the indicators, targets and budget in setup as the approved plan, and moves the project to Execute. It is recorded with your name and the date. | Signing off confirms the targets and budget in setup as the approved plan, and moves the project to Execute. It is recorded with your name and the date. | "indicators, targets" becomes "targets". |
| `home.keyIndicators` | Key indicators | Main targets |  |
| `progress.notSaved` | Indicators for this demo project are not set up yet. | Targets for this demo project are not set up yet. |  |
| `progress.empty` | No indicators yet. | No targets yet. |  |
| `progress.outputs` | Project indicators | Project targets |  |
| `report.col.indicator` | Indicator | **Keep** | Donor report export. Also used once as an input's label in setup (`setup-page.tsx:381`): give setup its own string, "Target". |
| `report.summary` | {withData} of {count} indicators have new data in the current period. | **Keep** | Donor report export. |
| `report.outputs` | Project indicators | **Keep** | Donor report export. |
| `report.forecast` | Forecast vs actual | **Keep** | Donor report export. |
| `report.forecastNote` | Forecasts are the totals expected by 31 December of each year. This year's actual is the total to date; \"expected by now\" assumes steady progress through the year. | **Keep** | Donor report export. |
| `report.col.actual` | Actual | **Keep** | Donor report export. |
| `settings.tracks` | Tracks {n} indicators | Tracks {n} targets |  |
| `settings.codes` | Donor indicator codes | The donor's codes for targets |  |
| `settings.codesHelp` | The donor's code for each indicator it tracks. Leave blank for indicators it does not track. | The donor's code for each target it tracks. Leave blank for targets it does not track. | The codes themselves do not change. |
| `setup.h.indicators` | Add the indicators and targets. Each one can later be counted from a KoboToolbox question. | Add the targets: what will be counted, and how many. Each one can later be counted from a KoboToolbox question. | Question 1 below. |
| `setup.addIndicator` | Add indicator | Add a target |  |
| `setup.newIndicator` | New indicator | New target |  |
| `setup.h.donors` | Add each donor's name. Reporting deadlines and indicator codes go in project settings later. You can skip this. | Add each donor's name. Reporting deadlines and the donor's codes for targets go in project settings later. You can skip this. |  |
| `setup.r.indicators` | Indicators | Targets |  |
| `setup.h.doneConnected` | Pull the submissions now to see the indicators fill in. You can sync again any time from Progress. | Pull the submissions now to see the targets fill in. You can sync again any time from Progress. |  |
| `kobo.h.connect` | Field data stays in KoboToolbox. The app reads the project's submissions to fill in its indicators. | Field data stays in KoboToolbox. The app reads the project's submissions to count results toward its targets. |  |
| `kobo.purpose.data` | Field data: submissions count straight toward indicators | Field data: submissions count straight toward targets |  |
| `kobo.q.map` | Which question counts toward each indicator? | Which question counts toward each target? |  |
| `assistant.intro` | Ask about this project: what is running late, how an indicator is counted, or what to write in the next donor report. | Ask about this project: what is running late, how a target is counted, or what to write in the next donor report. | The AI assistant is on the do-not-touch list. This changes one sentence of its screen text, not what it does. Question 3 below. |
| `assistant.ex.noData` | Which indicators have no data this month? | Which targets have no results this month? | Same. |
| `detail.reportIndicators` | {n} indicators reported with this donor's own names. | {n} targets reported with this donor's own names. |  |
| `ks.help` | Claude looks at the forms' questions (never the answers) and suggests one for each indicator. Nothing changes until you accept a suggestion and save. | Claude looks at the forms' questions (never the answers) and suggests one for each target. Nothing changes until you accept a suggestion and save. |  |

### The same 28 in Spanish, Dari and Pashto, as they read today

For the native reader: each row that is not "Keep" above needs the new word from the table at the top.

| Key | Spanish | Dari | Pashto |
|---|---|---|---|
| `nav.budget` | Presupuesto vs. gasto | بودجه و مصارف | بودیجه او لګښت |
| `stage.signOffWhat` | Al aprobar, los indicadores, metas y presupuesto de la configuración quedan como el plan aprobado y el proyecto pasa a Ejecución. Se registra con tu nombre y la fecha. | با تأیید، شاخص‌ها، اهداف و بودجهٔ تنظیمات به‌عنوان پلان تأییدشده ثبت می‌شود و پروژه به مرحلهٔ اجرا می‌رود. این کار با نام شما و تاریخ ثبت می‌شود. | په تایید سره د تنظیماتو شاخصونه، موخې او بودیجه د تایید شوي پلان په توګه ثبتېږي او پروژه اجرا ته ځي. دا ستاسو له نوم او نېټې سره ثبتېږي. |
| `home.keyIndicators` | Indicadores clave | شاخص‌های کلیدی | مهم شاخصونه |
| `progress.notSaved` | Los indicadores de este proyecto de demostración aún no están configurados. | شاخص‌های این پروژهٔ نمایشی هنوز تنظیم نشده‌اند. | د دې نمایشي پروژې شاخصونه لا نه دي جوړ شوي. |
| `progress.empty` | Todavía no hay indicadores. | هنوز شاخصی نیست. | لا شاخص نشته. |
| `progress.outputs` | Indicadores del proyecto | شاخص‌های پروژه | د پروژې شاخصونه |
| `settings.tracks` | Sigue {n} indicadores | {n} شاخص را دنبال می‌کند | {n} شاخصونه څاري |
| `settings.codes` | Códigos de indicador del donante | کدهای شاخص تمویل‌کننده | د تمویلوونکي د شاخص کوډونه |
| `settings.codesHelp` | El código del donante para cada indicador que sigue. Déjalo en blanco para los que no sigue. | کد تمویل‌کننده برای هر شاخصی که دنبال می‌کند. برای شاخص‌هایی که دنبال نمی‌کند خالی بگذارید. | د هر هغه شاخص لپاره د تمویلوونکي کوډ چې څاري یې. هغه چې نه یې څاري تش پرېږدئ. |
| `setup.h.indicators` | Agrega los indicadores y metas. Cada uno se podrá contar después a partir de una pregunta de KoboToolbox. | شاخص‌ها و هدف‌ها را بیفزایید. هر کدام بعداً از یک سؤال KoboToolbox شمرده می‌شود. | شاخصونه او موخې زیاتې کړئ. هر یو وروسته د KoboToolbox له یوې پوښتنې شمېرل کېدای شي. |
| `setup.addIndicator` | Agregar indicador | افزودن شاخص | شاخص زیاتول |
| `setup.newIndicator` | Indicador nuevo | شاخص جدید | نوی شاخص |
| `setup.h.donors` | Agrega el nombre de cada donante. Los plazos de informe y los códigos de indicador se agregan después en la configuración. Puedes omitir este paso. | نام هر تمویل‌کننده را بیفزایید. مهلت‌های گزارش و کدهای شاخص بعداً در تنظیمات افزوده می‌شوند. می‌توانید این را رد کنید. | د هر تمویلوونکي نوم زیات کړئ. د راپور نېټې او د شاخص کوډونه وروسته په تنظیماتو کې ځي. دا پرېښودلی شئ. |
| `setup.r.indicators` | Indicadores | شاخص‌ها | شاخصونه |
| `setup.h.doneConnected` | Trae los envíos ahora para ver cómo se llenan los indicadores. Puedes sincronizar cuando quieras desde Avance. | اکنون فرم‌های ارسالی را بیاورید تا شاخص‌ها پر شوند. هر زمان از پیشرفت دوباره همگام کنید. | اوس سپارل شوې فورمې راوړئ چې شاخصونه ډک شي. هر وخت له پرمختګ څخه بیا همغږي کړئ. |
| `kobo.h.connect` | Los datos de campo se quedan en KoboToolbox. La aplicación lee los envíos del proyecto para llenar sus indicadores. | داده‌های ساحوی در KoboToolbox می‌ماند. برنامه فرم‌های ارسالی پروژه را می‌خواند تا شاخص‌ها را پر کند. | ساحوي معلومات په KoboToolbox کې پاتې کېږي. اپ د پروژې سپارل شوې فورمې لولي چې شاخصونه ډک کړي. |
| `kobo.purpose.data` | Datos de campo: los envíos cuentan directamente para los indicadores | (falls back to English) | (falls back to English) |
| `kobo.q.map` | ¿Qué pregunta cuenta para cada indicador? | کدام سؤال برای هر شاخص شمرده می‌شود؟ | د هر شاخص لپاره کومه پوښتنه شمېرل کېږي؟ |
| `assistant.intro` | Pregunta sobre este proyecto: qué va con retraso, cómo se cuenta un indicador o qué escribir en el próximo informe al donante. | دربارهٔ این پروژه بپرسید: چه چیزی عقب افتاده، یک شاخص چگونه شمرده می‌شود، یا در گزارش بعدی تمویل‌کننده چه بنویسید. | د دې پروژې په اړه وپوښتئ: څه ځنډېدلي، یو شاخص څنګه شمېرل کېږي، یا د تمویلوونکي په راتلونکي راپور کې څه ولیکئ. |
| `assistant.ex.noData` | ¿Qué indicadores no tienen datos este mes? | کدام شاخص‌ها این ماه داده ندارند؟ | کوم شاخصونه دا میاشت معلومات نه لري؟ |
| `detail.reportIndicators` | {n} indicadores con los nombres que usa este donante. | {n} شاخص با نام‌هایی که این تمویل‌کننده به کار می‌برد. | {n} شاخصونه د دې تمویلوونکي په خپلو نومونو. |
| `ks.help` | Claude revisa las preguntas de los formularios (nunca las respuestas) y sugiere una para cada indicador. Nada cambia hasta que acepte una sugerencia y guarde. | Claude سؤال‌های فورم‌ها را (نه پاسخ‌ها را) می‌بیند و برای هر شاخص یکی پیشنهاد می‌کند. تا پیشنهادی را نپذیرید و ذخیره نکنید، چیزی تغییر نمی‌کند. | Claude د فورمو پوښتنې (نه ځوابونه) ګوري او د هر شاخص لپاره یوه وړاندیز کوي. تر هغه چې وړاندیز ونه منئ او خوندي یې نه کړئ، هېڅ نه بدلېږي. |

## 2. Text typed straight into screens (English only today)

Each would also move into the dictionaries, so it exists in four languages.

| Where | Before | After |
|---|---|---|
| `src/components/progress/budget-page.tsx:59` (page title) | Budget vs actual | Budget and spending |
| `src/app/(app)/progress/budget/page.tsx:6` (browser tab) | Budget vs actual · ROP Workflow | Budget and spending · ROP Workflow |
| `src/components/progress/progress-page.tsx:154` (link) | Budget vs actual | Budget and spending |
| `src/app/(app)/progress/page.tsx:6` (browser tab text) | Indicators, impact and the donor report for the current project. | Targets, results and the donor report for the current project. |
| `src/app/(app)/progress/framework/page.tsx:6` (browser tab text) | Goal, outcomes, outputs, activities and indicators as a tree, with this year's progress. | Goal, outcomes, outputs, activities and targets as a tree, with this year's progress. |
| `src/components/progress/framework-page.tsx:168` | From the goal down to each indicator and ROP's activities, with this year's progress. … | From the goal down to each target and ROP's activities, with this year's progress. … |
| `src/components/home/role-home.tsx:242` | "{n} indicator" / "{n} indicators" | "{n} target" / "{n} targets" |
| `src/components/progress/indicator-table.tsx:48` | "indicators" (in a count) | "targets" |
| `src/components/progress/progress-summary.tsx:46` | "{n} indicator has" / "{n} indicators have" | "{n} target has" / "{n} targets have" |
| `src/components/progress/review-page.tsx:120` (column heading) | Indicator | Target |
| `src/components/progress/results-page.tsx:45, 61` | "indicators" / "indicator" (in counts) | "targets" / "target" |
| `src/components/progress/results-page.tsx:137` | This project has no indicators that take recorded results. | This project has no targets that take recorded results. |
| `src/components/progress/results-page.tsx:182` (heading) | Indicators | Targets |
| `src/components/progress/results-page.tsx:215` | This indicator comes from Kobo: its results are counted from the form, not recorded here. | This target is counted from a KoboToolbox form, so its results are not recorded here. |
| `src/components/progress/results-page.tsx:1115–1116` | Which indicator is the result for? | Which target is the result for? |
| `src/components/progress/weekly-page.tsx:498` | This project's indicators have no activity numbers (such as 1.1.1) yet, … | This project's targets have no activity numbers (such as 1.1.1) yet, … |
| `src/components/progress/qpr-page.tsx:704` (hover text) | The budget line that pays for this indicator | The budget line that pays for this target |
| `src/components/progress/qpr-page.tsx:921` | Import Finance's budget against actual | Import Finance's budget and spending workbook |
| `src/components/progress/period-report-page.tsx:172` | Baselines marked — are not recorded on the indicator; add them in setup. | Baselines marked — are not recorded for the target; add them in Target details. |
| `src/components/project/gated-project.tsx:115` | Results, indicators and budget are drafted after the target is set. | Question 2 below. |
| `src/components/tasks/work.ts:143` | Approve this period's actuals | Approve this period's results |

`src/components/project/project-page.tsx` (the demo project's page) has about 20 more: "Targets vs actuals", "Budget vs actuals", "Actual", "Approve actual", "Actuals not approved", "Indicator", "Donor indicator", "Impact indicator library", "Disaggregations collected: gender, age band, household size, community." I would change them the same way ("Targets and results", "Budget and spending", "Result", "Accept the result", "Results not accepted", "Target", "Donor's code", "Library of impact targets", "Counted by women and men, age and place: …"). They are not listed line by line because the file is 1,300 lines and only demo projects show it.

## 3. Kept, because they go to a donor

- `report.*` strings: the progress report export (`src/lib/report-formats.ts`).
- `src/components/progress/qpr-page.tsx:653` "Output indicator": the heading of UNDP's own table.
- `src/components/progress/period-report-page.tsx:124` "Indicator": the annual report's table.
- `src/components/progress/face-page.tsx:128` "B Actual": the FACE form's column.
- `src/components/progress/downloads.tsx` "Indicator", "Actual", "budget against actual": the evidence pack a donor or auditor opens.
- Donor codes, everywhere.

## 4. Questions before anything changes

1. **"Indicators and targets."** Setup says "Add the indicators and targets", as two things: what is counted, and how many. With "Target" for both, is "Add the targets: what will be counted, and how many" right, or do you want a second word for the thing counted?
2. **`gated-project.tsx:115`** says "Results, indicators and budget are drafted after the target is set", where "target" means the market window the project aims at ("the target window"). If "Target" now means an indicator, that screen needs another word for the window. Which? Market windows are on the do-not-touch list, so I would leave the screen and only avoid the clash.
3. **The AI assistant** is not to be touched. Two of its screen sentences say "indicator". Change those two sentences, or leave them?
4. **"MEL", "Pre-flight", "claim check", "query".** The audit lists these as hard for a field officer too (section 4, Jargon). They are outside C4 as written. Add them?
5. **The quarterly report's older check sentences** (18 places in `checksFor` in `src/lib/qpr.ts`) were to move into the four languages with C4. At least two say "indicator". Reword them in the same pass?
