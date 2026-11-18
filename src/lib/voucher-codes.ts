/**
 * Code lists for the expense voucher, taken from the lists in ROP's Excel expense voucher form
 * (the "IND EVENTS FZE" example, November 2026). Expense accounts, departments and Afghan
 * locations only. Bank and cash accounts are not listed here because their names carry account
 * numbers: Finance types the paying account's code on the voucher.
 *
 * A few names were damaged in the Excel file, where "Mar" had been replaced with "Apr"
 * ("Aprketing", "AsApr"...). They are corrected here.
 */

export type Code = { code: string; name: string; group?: string };

const list = (group: string, rows: string) =>
  rows
    .trim()
    .split("\n")
    .map((r) => {
      const [code, ...name] = r.trim().split(" ");
      return { code, name: name.join(" ").trim(), group };
    });

/** General ledger expense accounts (5000–8740). */
export const GL_EXPENSE: Code[] = [
  ...list(
    "Personnel",
    `5000 Long-Term Expatriates, US - Salaries
5010 Long-Term Expatriates, TCN - Salaries
5020 Long-Term Local Professionals - Salaries
5030 Home Office Professionals - Salaries
5040 Short-Term Expatriates, US - Salaries
5050 Short-Term Expatriates, TCN - Salaries
5060 Short-Term Local Professionals - Salaries
5070 Local Support Staff - Salaries
5080 Consultants - Salaries
5100 Salary Tax Expense
5110 SUI Expense
5120 Medical & Health Insurance
5130 Workers Comp Insurance
5133 Bonus - Merit
5135 Bonus - 13th Month
5140 Employer Income Tax - Local Staff
5150 Employer Income Tax - Expatriates Staff`,
  ),
  ...list(
    "Fringe benefits",
    `5200 Long-Term Expatriates, US - Medical & Health Insurance
5210 Long-Term Expatriates, TCN - Medical & Health Insurance
5220 Long-Term Expatriates, US - Workers Comp
5230 Long-Term Expatriates, TCN - Workers Comp
5240 Long-Term Expatriates, US - Paid Leave
5250 Long-Term Expatriates, TCN - Paid Leave
5260 Long-Term Local Professionals - Fringe Benefits
5270 Home Office Professionals - Fringe Benefits
5280 Local Support Staff - Fringe Benefits
5290 403b Accrued Payable - Employer Vanguard`,
  ),
  ...list(
    "Allowances",
    `5300 Danger Pay - Allowance
5310 Post Differential - Allowance
5320 Meals for Non-ROP Workers - Allowance
5330 Transportation & Meals - Allowance
5340 Living Quarters - Allowance
5350 Other - Allowance
5360 Per diem - Allowance`,
  ),
  ...list("Cost of goods sold", `5400 Cost of Goods Sold`),
  ...list(
    "Operating expense",
    `6000 Consulting Expense
6010 Legal Fees
6020 Accounting Fees
6030 Rent
6040 Rental Tax
6050 Utilities
6060 Generator Fuel
6070 Facility Maintenance
6080 Office Equipment
6090 Equipment, Vehicles & Freight
6100 Vehicle Rental
6110 Vehicle Fuel & Maintenance
6120 Telephone - Land Lines
6130 Monthly Mobile Phone Service
6140 Calling Cards
6150 Internet
6160 Web Site
6170 Insurance
6180 Supplies
6190 Postage
6200 Printing
6220 Taxes & Licenses
6230 Interest and Loan Fees
6240 Bank and Credit Card Fees
6250 Memberships & Subscriptions
6260 Professional Services
6270 Personnel Relations
6280 Business Entertainment
6290 Video Production & Photography
6300 Fundraising
6310 Employee Training
6320 Food
6330 Household Supplies
6340 Household Furnishings
6350 Depreciation
6360 Other
6370 Unrealized Gain/Loss
6380 Realized Gain/Loss`,
  ),
  ...list(
    "Travel",
    `7000 US Travel - Airfare
7010 International Travel - Airfare
7020 Local Program Travel - Airfare
7030 Visa
7040 Taxi
7050 Per Diem - Travel
7060 Lodging
7070 Parking & Tolls
7080 Car Rental
7090 Mileage`,
  ),
  ...list("Infrastructure & rehabilitation", `8000 Farm Rehabilitation\n8010 Infrastructure`),
  ...list(
    "Agriculture expense and input",
    `8100 Nursery
8110 Plant Materials - Import
8120 Plant Materials - Local
8130 Project Labor
8140 Procurements
8150 Tools
8160 Demo Inputs`,
  ),
  ...list("Equipment", `8200 Equipment - Owned\n8210 Equipment - Rent`),
  ...list("Marketing", `8300 Marketing General\n8310 Marketing Center Operations`),
  ...list("Demining", `8400 Subcontractor`),
  ...list("Workshops & training", `8500 Workshops and Training Sessions`),
  ...list("Studies, surveys & reports", `8600 Studies, Surveys & Reports`),
  ...list(
    "Industry development",
    `8700 Industry Development
8710 Visibility & External Communications
8720 Construction & Support
8730 School Construction & Support
8740 Contractor Taxes`,
  ),
];

/** Departments. */
export const DEPARTMENTS: Code[] = [
  ...list("General and administrative", `10 Executive\n11 Finance\n12 Information Technology\n13 Human Resources\n14 General Admin`),
  ...list("Fundraising / development", `20 Public Relations\n21 Donor Relations\n22 Corporate/Foundation Relations\n23 Governmental Relations\n24 Fundraising\n25 Grant and Proposal Development`),
  ...list("Program", `30 Demining\n40 Planting\n50 Demo Plots\n51 Research/Development\n52 Marketing/Trade\n53 Training\n54 Gender`),
];

/** Locations in Afghanistan, by province. */
export const LOCATIONS: Code[] = [
  ...list("Nangarhar", `10001 Behsud\n10002 Batikot\n10003 Shinwar\n10004 Muhmand Dara\n10005 Kama\n10006 Kuz Kunar\n10007 Surkh Rod\n10008 Khogyani\n10009 Sherzad\n10010 Jalalabad`),
  ...list("Kunar", `10011 Khas Kunar\n10012 Asmar\n10013 Asadabad\n10014 Narang\n10015 Ghazi Abad\n10016 Sarkani\n10017 Nari`),
  ...list("Laghman", `10021 Mihtarlam\n10022 Qarghayi\n10023 Alishing`),
  ...list("Paktika", `10031 Sharana\n10032 Mata Khan\n10033 Sar Hawza\n10034 Spera\n10035 Yousaf Khail\n10036 Urgun`),
  ...list("Paktia", `10041 Zurmat\n10042 Gardez\n10043 Sayed Karam\n10044 Jadran\n10045 Lija Mangal\n10046 Chamkani\n10047 Ahmad Abad`),
  ...list("Ghazni", `10051 Khowaja Mory\n10052 Jaghory\n10053 Sharistan\n10054 Muqur\n10055 Ab Band\n10056 Qarabagh\n10057 Ghazni Center\n10058 Malistan`),
  ...list("Logar", `10061 Mohd Agha\n10062 Poli Alam\n10063 Khoshy\n10064 Barky Barak\n10065 Charkh`),
  ...list("Wardak", `10071 Jalrez\n10072 Said\n10073 Jaghato\n10074 Dih Mirdad\n10075 Narkh`),
  ...list("Kabul", `10080 Kabul\n10081 Guldara\n10082 Mir Bocha Kot\n10083 Kalakan\n10084 Qarabagh\n10085 Shakardara\n10086 Istalif`),
  ...list("Parwan", `10091 Charikar\n10092 Bagram\n10093 Ghorband`),
  ...list("Bamyan", `10101 Waras\n10102 Panjab\n10103 Saighan\n10104 Kahmard\n10105 Yakawlang\n10106 Bamyan Center`),
  ...list("Kandahar", `10111 Panjwayi\n10112 Spin Boldak\n10113 Daman\n10114 Dand\n10115 Arghandab\n10116 Maiwand\n10117 Arghistan\n10118 Kandahar Center`),
  ...list("Uruzgan", `10121 Tirin Kot\n10122 Chora\n10123 Daychopan\n10124 Dehrawod`),
  ...list("Helmand", `10131 Lashkar Gah\n10132 Grishk\n10133 Nad Ali\n10134 Nawa Barakzae`),
  ...list("Zabul", `10141 Qalat\n10142 Shahri Safa\n10143 Shah Joy`),
  ...list("Balkh", `10220 Khoja Sabzposh\n10221 Balkh\n10222 Chahar Bolak\n10223 Chahar Kint\n10224 Chimtal\n10225 Dawlatabad\n10226 Dihdadi\n10227 Kaldar\n10228 Khulmi\n10229 Kishindih\n10230 Marmul\n10231 Mazar-e-Sharif\n10232 Nahri Shahi\n10233 Sholgara\n10234 Shortepa\n10235 Zari`),
  ...list("Kapisa", `10401 Alasay\n10402 Hesa Awal Kohistan\n10403 Hesa Dowom Kohistan\n10404 Koh Band\n10405 Mahmud Raqi\n10406 Nijrab\n10407 Tagab`),
  ...list("Khost", `10436 Gurbuz\n10437 Jaji Maidan\n10438 Khost Matun\n10439 Mando Zai\n10440 Mosa Kheil\n10441 Nadir Shah Kot\n10442 Qalandar\n10443 Sabri\n10444 Shamal\n10445 Spira\n10446 Tani\n10447 Tere Zaie`),
  ...list("Herat", `10700 Injil\n10701 Guzara\n10702 Pashtun Zarghun\n10703 Karukh\n10704 Kushk\n10705 Gulran\n10706 Kohsan\n10707 Ghoryan\n10708 Zinda Jan\n10709 Adraskan\n10710 Obe\n10711 Farsi\n10712 Shindand\n10713 Chisht-e Sharif\n10714 Kushk Kuhna\n10715 Central Herat`),
  ...list("Kunduz", `10181 Ali Abad\n10182 Archi\n10183 Chahar Dara\n10184 Imam Sahib\n10185 Khan Abad\n10186 Kunduz`),
];

/** "8300 Marketing General" for a code in a list, or the code as typed. */
export const codeLabel = (codes: Code[], code: string | undefined) => {
  if (!code?.trim()) return "";
  const c = codes.find((x) => x.code === code.trim());
  return c ? `${c.code} ${c.name}` : code.trim();
};
