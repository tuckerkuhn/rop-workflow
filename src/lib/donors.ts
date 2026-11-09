import type { Profile } from "@/lib/policy";

/**
 * Donor profiles: each donor's own rules, with their sources, read from the donors' published
 * rules and ROP's donor agreements (November 2026). A value marked "to verify" is not yet
 * confirmed in the primary document, or depends on how the donor applies it. Rules a donor
 * leaves to the partner are left out, so the organization's policy applies.
 */

const RPA = "UNDP–ROP Responsible Party Agreement, ACRP, signed 8 Mar 2025 (with Amendment 1, 31 Dec 2025)";
const OG = "UNDP On-Granting Provisions (CBARD agreement annex, 2015 template)";
const CFR = "2 CFR 200 (eCFR, current to 3 Nov 2026)";
const WB = "World Bank Procurement Regulations for IPF Borrowers, 7th edition (September 2025)";

export const DONORS: Profile[] = [
  {
    id: "undp",
    name: "UNDP",
    kind: "donor",
    summary:
      "ROP follows its own rules where they are consistent with UNDP's Financial Regulations and Rules (RPA Art. 2.5). UNDP adds: competition unless it agrees otherwise in writing, prior approval of subcontractors, equipment remains UNDP's, records for 7 years, quarterly reports 15 days after each quarter.",
    documents: [
      { title: RPA, where: "SharePoint: ACRP agreement folder" },
      { title: OG, where: "SharePoint: corp/proc/ROP_Governance_Corpus_Package/04_Procurement_and_Grants" },
    ],
    values: {
      soleSourceDonorApproval: { value: true, source: `${RPA}, Art. 8.1: competition "unless otherwise agreed upon in writing by UNDP"`, confidence: "to verify" },
      subcontractorApproval: { value: true, source: `${RPA}, Art. 7.1(b): each Subcontractor approved in writing in advance; whether this covers vendors is to confirm with UNDP`, confidence: "to verify" },
      screeningLists: { value: ["UN Security Council 1267 list"], source: "UNDP–ROP agreement for CBARD, §16.3 (the ACRP agreement points to the Project Document's AML/CFT terms)", confidence: "to verify" },
      // Art. 9 covers the equipment ROP uses to run the project, an administrative cost; assets granted to grantees are on-granting,
      // which builds up the private sector (ROP's reading, T. Kuhn, 5 Nov 2026; ACRP's on-granting annex to confirm).
      projectEquipment: { value: "Remains UNDP's property; returned or disposed of as UNDP instructs within 30 days of completion", source: `${RPA}, Art. 9.1, 9.5` },
      grantCapUsd: { value: 50000, source: "ACRP Project Document (RPA Annex A), p.35: market-shelter matching grants up to $50,000; the CBARD annex allowed $60,000" },
      grantCapCumulativeUsd: { value: 120000, source: `${OG}, §4.3 (ACRP's own annex not yet found)`, confidence: "to verify" },
      costSharePct: { value: 50, source: "ACRP Project Document: 50% for male-owned firms, 30% for female-owned" },
      retentionYears: { value: 7, source: `${RPA}, Art. 12.3` },
      quarterlyReportDays: { value: 15, source: `${RPA}: quarterly progress reports 15 days after each quarter (article to cite)`, confidence: "to verify" },
    },
  },
  {
    id: "usaid",
    name: "USAID / US federal",
    kind: "donor",
    summary:
      "US federal awards follow 2 CFR 200 and the award's Standard Provisions; the organization's written policy governs where it is stricter. USAID's awards moved to the State Department on 1 July 2025, so a new award's own terms govern. Restricted goods need the Agreement Officer's approval.",
    documents: [
      { title: CFR, where: "ecfr.gov, Title 2 Part 200" },
      { title: "FAR 48 CFR 2.101 (micro-purchase and simplified acquisition thresholds)", where: "ecfr.gov" },
      { title: "USAID Standard Provisions for non-US NGOs (August 2024) and the AMP award", where: "SharePoint (AMP files)" },
    ],
    values: {
      microMaxUsd: { value: 15000, source: `${CFR} §200.1, §200.320(a)(1); FAR 2.101 (recipients may self-certify up to $50,000)` },
      smallMaxUsd: { value: 350000, source: `${CFR} §200.1, §200.320(a)(2)(ii): simplified acquisition threshold` },
      donorApprovalAboveUsd: { value: null, source: "No general amount; prior approval for subawards not in the approved application (§200.308(f)(6)) and restricted goods" },
      restrictedGoods: {
        value: ["agricultural commodities", "fertilizer", "pesticides", "motor vehicles", "pharmaceuticals", "used equipment", "US government excess property"],
        source: "USAID Standard Provisions (restricted commodities, ADS 312); ROP Procurement Policy 2022 §4.3.18",
        confidence: "restated",
      },
      screeningLists: { value: ["SAM.gov exclusions", "OFAC SDN list", "UN Security Council Consolidated List"], source: `${CFR} 2 CFR 180; USAID Standard Provisions (terrorist financing clause)` },
      perDiemSource: { value: "US State Department (abroad), GSA (in the US)", source: `${CFR} §200.475(b),(d): the organization's written policy, else State Department and GSA rates` },
      airClass: { value: "Economy", source: `${CFR} §200.475: the basic least expensive unrestricted class; Fly America applies` },
      grantCapUsd: { value: 500000, source: `${CFR} §200.333: fixed-amount subawards, with prior written approval` },
      retentionYears: { value: 3, source: `${CFR} §200.334: 3 years from the final financial report` },
    },
  },
  {
    id: "worldbank",
    name: "World Bank (IPF)",
    kind: "donor",
    summary:
      "Investment Project Financing follows the World Bank Procurement Regulations and the project's Procurement Plan in STEP; thresholds below are the Bank's Afghanistan guidance and the project's plan may differ. International competition needs the Bank's standard documents, rated criteria and a standstill before award.",
    documents: [
      { title: WB, where: "thedocs.worldbank.org" },
      { title: "World Bank procurement thresholds for Afghanistan (guidance as of 28 Nov 2023)", where: "World Bank" },
      { title: "ARLP Procurement Plan and PPSD (prepared by AKF)", where: "Not yet available" },
    ],
    values: {
      smallMaxUsd: { value: 50000, source: "World Bank Afghanistan thresholds: RFQ for goods up to $50,000 (the ARLP Procurement Plan may differ)", confidence: "to verify" },
      quotesSmall: { value: 3, source: `${WB}, Annex XII §5.1` },
      advertisingDaysLarge: { value: 42, source: `${WB}, ¶5.36: at least 30 business days for international competition (about 42 calendar days)` },
      donorApprovalAboveUsd: { value: 1500000, source: `${WB}, Annex II: prior review for goods above $1.5m at high risk (ARLP's risk rating not yet known)`, confidence: "to verify" },
      screeningLists: { value: ["World Bank Group debarment list"], source: `${WB}: debarred and suspended firms checked during evaluation as a minimum` },
    },
  },
];

export const donorById = (id: string | null | undefined) => DONORS.find((d) => d.id === id) ?? null;
