/**
 * Content from docs/ROP-PROCUREMENT-BLUEPRINT.md, shaped for the UI.
 * Inline tags like "[D1 §4.1]" mark where a statement comes from; see statusTags.
 */

export type StatusKind = "CUR" | "D1" | "D1*" | "TS" | "OPEN" | "PA";

export const statusTags: { kind: StatusKind; label: string; meaning: string }[] = [
  { kind: "CUR", label: "Current per source", meaning: "A source says it is in force or describes it as practice today. Not independently verified." },
  { kind: "D1", label: "Draft 1.0", meaning: "Stated in Procurement Policy Draft 1.0, which is not approved and not in force." },
  { kind: "D1*", label: "Draft, pending", meaning: "Draft 1.0 text its drafter marks as a proposal awaiting confirmation." },
  { kind: "TS", label: "Target state", meaning: "Proposed workflow design. Neither policy nor current practice." },
  { kind: "OPEN", label: "Open", meaning: "Open decision or missing input. Needs a named owner." },
  { kind: "PA", label: "Prototype", meaning: "Prototype assumption, used only to demonstrate a flow." },
];

export type StageField = { term: string; items: string[] };

export type ProcurementStage = {
  id: string;
  label: string;
  title: string;
  short: string;
  upstream?: boolean;
  /** Gate that closes this stage, if any. */
  gate?: string;
  trigger: string;
  fields: StageField[];
  records: string[];
};

export const procurementStages: ProcurementStage[] = [
  {
    id: "0",
    label: "00",
    title: "Programme start-up",
    short: "Award rulebook, once per award",
    upstream: true,
    trigger: "A new award or programme is set up.",
    fields: [
      {
        term: "People and actions",
        items: [
          "Director of Operations reads the instrument classification from the award, and gets written clarification from the agency if it is ambiguous [D1 §1.3b].",
          "Identify the donor and country annex and the forms set for the programme [D1 §1.4].",
        ],
      },
      { term: "AI", items: ["Extract framework terms, budget lines and procurement clauses from the award. AI does not classify the instrument [TS; D1 §1.3b]."] },
      { term: "Human authority", items: ["Director of Operations, including any donor conflict under §1.4 rule 4 [D1]."] },
      {
        term: "Exceptions",
        items: [
          "Donor rule and policy cannot both be met: the procurement does not proceed until a written waiver is obtained [D1 §1.4].",
          "World Bank award with Annex C reserved: the policy body applies in full [D1 Ann. C]. ARLP instrument type unknown [OPEN PI-9].",
        ],
      },
    ],
    records: ["Programme / award", "Award rulebook", "Budget lines"],
  },
  {
    id: "1",
    label: "01",
    title: "Identify the need",
    short: "Plan line comes due, budget holder confirms",
    trigger: "A procurement-plan line comes due given lead time, or an urgent need is raised [D1 §2.7, §4.1; TS].",
    fields: [
      {
        term: "People and actions",
        items: [
          "The technical requester drafts the need. The budget holder owns and submits it [D1 §2.1, §4.1].",
          "Every purchase is tied to a workplan activity and its result, or it is not procured [D1 §2.7].",
          "If the market cannot deliver in time, the activity is re-planned rather than the procurement shortened [D1 §2.7].",
          "Contractor-vs-subrecipient determination in writing before funds pass [D1 §1.3c].",
        ],
      },
      { term: "AI", items: ["Extract planned needs, classify category, flag duplicates and vague specifications [TS]."] },
      { term: "Automation", items: ["Lead-time reminders. Procurement tracker, reported monthly [D1 §2.7]. Cumulative-spend watch for split purchases [D1 §3.3]."] },
      { term: "Exceptions", items: ["No activity or budget link. Unrealistic lead time. Possible split purchase. Subrecipient routes to the Grant-Making Standard."] },
      { term: "Open", items: ["Procurement initiated from the plan is held for a CEO decision. The workflow schedules and reminds; it does not auto-submit or pre-buy [OPEN]."] },
    ],
    records: ["Plan item", "Procurement ID", "Activity", "Budget line"],
  },
  {
    id: "2",
    label: "02",
    title: "Prepare requisition and package",
    short: "Budget left, price basis, method, solicitation",
    trigger: "Need confirmed.",
    fields: [
      {
        term: "People and actions",
        items: [
          "Requisition states item, quantity, specification, date, place, funding source, budget line, planned/urgent and E&S risk [D1 §4.1, §2.8].",
          "Budget verification checks what remains on the line: value, and quantity where the funder budgets quantities. A shortfall is agreed with the funder before approval [D1 §4.1].",
          "Price reasonableness is attached before approval [D1 §4.2]. Level is set from 12-month estimated value [D1 §1.8, §3.1].",
          "After Gate A: RFQ pairs with lowest priced technically acceptable, RFP with best value [D1 §4.3]. Pass/fail criteria are kept out of the score [D1 §4.4].",
        ],
      },
      { term: "AI", items: ["Draft specs. Assemble the price basis with sources. Pre-check the solicitation: weights sum, annexes exist, thresholds consistent [TS]."] },
      { term: "Automation", items: ["Populate forms. Remaining value/quantity check. Level calculation. Missing-field blocking [TS]."] },
      { term: "Exceptions", items: ["Insufficient budget. Missing price basis means the requisition is returned [D1 §4.2]. Restrictive specification."] },
      { term: "Open", items: ["Quantity control on every purchase or above a threshold [OPEN]. Is supplier-installed equipment works? [OPEN C4]"] },
    ],
    records: ["Requisition", "Price reasonableness", "Solicitation", "Bid plan"],
  },
  {
    id: "3",
    label: "03",
    title: "Review and authorize",
    short: "Gate A, HO review, Gate B",
    gate: "A · B",
    trigger: "Requisition complete, then solicitation package complete.",
    fields: [
      {
        term: "People and actions",
        items: [
          "Gate A: requisition approved before any supplier is approached, at every level [D1 §3.2].",
          "Large: Home Office compliance review of the solicitation before issue, 3 working days with a named alternate [D1 §5.4; D1* turnaround].",
          "Gate B: solicitation, evaluation plan and (Large) bid plan approved before issue [D1 §3.2, §5.4].",
          "A signatory who objects files a memo; the decision stays with the approver [D1 §4.1].",
        ],
      },
      { term: "AI", items: ["Draft an approval summary that cites the record and lists gaps [TS]."] },
      { term: "Automation", items: ["Route each approval trigger to a role from the authority table. Block issue until gates clear. Lock the approved version [TS]."] },
      { term: "Human authority", items: ["Approving authority per the authority table, which is not yet approved; the Annex G bridge is blank [OPEN PI-2]."] },
      { term: "Exceptions", items: ["Approval sought after suppliers were approached is a post-facto action [D1 §4.16]."] },
    ],
    records: ["Approvals", "HO review", "Objection memos"],
  },
  {
    id: "4",
    label: "04",
    title: "Conduct and select",
    short: "Sealed bids, committee, screening, SSM",
    trigger: "Solicitation authorized.",
    fields: [
      {
        term: "People and actions",
        items: [
          "Advertise ≥10 days (Medium) or ≥14 days (Large). Q&A goes to all bidders [D1 §4.5, §5.7].",
          "Bids held sealed by two senior managers outside procurement. Receipt time logged [D1 §4.6].",
          "Committee members sign declarations against the named bidder list before seeing bids. Opening record signed [D1 §4.6, §4.7].",
          "Pass/fail first, then scoring. Low bids 20–30% under benchmark investigated [D1 §4.4, §4.7].",
          "Screen the intended awardee (donor lists plus OFAC plan); due diligence at Medium and above [D1 §4.8]. SSM signed by the chair [D1 §4.9].",
        ],
      },
      { term: "AI", items: ["Only after opening: extract bid data, check completeness, draft the comparison matrix and SSM narrative. AI never touches bids before closing [TS; D1 §4.6]."] },
      { term: "Human authority", items: ["The committee decides pass/fail, scores and ranking. A person reviews every screening result [TS]."] },
      { term: "Exceptions", items: ["Failed solicitation: re-advertise once, then re-examine estimate and spec [D1 §7.2]. Suspected collusion goes to the confidential route."] },
      { term: "Open", items: ["One committee or two [OPEN C5]. The dedicated bid mailbox is not current practice [CUR]."] },
    ],
    records: ["Bids", "Declarations", "Opening record", "Screening", "SSM"],
  },
  {
    id: "5",
    label: "05",
    title: "Award and contract",
    short: "Gate C, conformity check, Gate D",
    gate: "C · D",
    trigger: "Source selection memo complete.",
    fields: [
      {
        term: "People and actions",
        items: [
          "Gate C: award approved before any commitment. Large: HO reviews the complete package first [D1 §3.2, §5.4].",
          "Ten required clause areas: audit, records, anti-corruption, safeguarding, labor, E&S, data, IP, termination, subcontracting [D1 §4.11].",
          "Conformity check before signature against the solicitation, winning bid and donor annex [D1 §4.11].",
          "Gate D: checklist pass 1; corrections confirmed in writing; no signature while one is outstanding [D1 §4.17].",
          "Changes to price, scope, quantity or time are approved before they happen [D1 §4.10].",
        ],
      },
      { term: "AI", items: ["Draft the contract. Pre-run the conformity comparison with citations for the human check [TS]."] },
      { term: "Exceptions", items: ["Wrong donor regime or clauses. Damages above the 10% cap [D1 §7.7]. Unapproved change is post-facto [D1 §4.16]."] },
    ],
    records: ["Contract / PO", "Conformity check", "Checklist pass 1", "Modifications"],
  },
  {
    id: "6",
    label: "06",
    title: "Receive and verify",
    short: "Requester signs the GRN",
    trigger: "Delivery or service milestone due or reported complete.",
    fields: [
      {
        term: "People and actions",
        items: [
          "The requester, not procurement, inspects and signs the goods received note [D1 §4.12].",
          "Receipt somewhere other than the contract delivery point is recorded on the GRN itself [D1 §4.12].",
          "Assets are tagged on acceptance [D1 §4.12]. Works are certified on site with dated photos [D1 §4.15].",
        ],
      },
      { term: "AI", items: ["Compare delivered against contracted. Flag a GRN signer outside the requesting department [TS]."] },
      { term: "Connects to", items: ["Seasonal step 5A: distributed input packages trace back to the GRN and the Procurement ID [TS]."] },
      { term: "Open", items: ["Offline capture and sync [OPEN]. Prepositioned stock is held [OPEN]. Works supervision is not performed today [CUR]."] },
    ],
    records: ["GRN / SRN", "Asset register", "Evidence"],
  },
  {
    id: "7",
    label: "07",
    title: "Invoice and payment",
    short: "Gate E, payment-ready handoff",
    gate: "E",
    trigger: "Invoice or payment claim received.",
    fields: [
      {
        term: "People and actions",
        items: [
          "Three-way match: contract, GRN, invoice [TS].",
          "Re-screen if the last screening is over 6 months old [D1* §4.8]. Payee bank account verified against contract and supplier evidence [D1 §4.13].",
          "Tax withholding per country annex [D1 §4.14]. Both exchange rates visible [D1 §4.13].",
          "Gate E: checklist pass 2. Procurement confirms receipt; it does not approve payment [D1 §3.2, §4.17].",
        ],
      },
      { term: "Human authority", items: ["Finance approves and releases payment under the Finance Manual [D1 §4.13]."] },
      { term: "Open", items: ["Finance Manual vs NetSuite configuration as the operative procedure (CFO) [OPEN PI-11]."] },
    ],
    records: ["Invoice", "Payee verification", "Checklist pass 2", "Payment"],
  },
  {
    id: "8",
    label: "08",
    title: "Close out and learn",
    short: "Closeout, performance, file",
    trigger: "Obligations complete, or an authorized closeout decision.",
    fields: [
      {
        term: "People and actions",
        items: [
          "Contracts over 5,000: closeout checklist and vendor performance evaluation [D1 §4.15].",
          "One electronic file, retained for the longest applicable period; 7 years proposed [D1* §4.17].",
          "Post-facto actions reviewed quarterly [D1 §4.16]. Independent HO audit sample [D1 §2.6].",
        ],
      },
      { term: "AI", items: ["Find missing documents, draft the closeout summary, surface patterns across cases [TS]."] },
      { term: "Status", items: ["The closeout checklist and vendor evaluation are not done in any country office today [CUR]. This is new work."] },
    ],
    records: ["Closeout checklist", "Vendor evaluation", "Procurement file"],
  },
];

export const gates = [
  { id: "A", name: "Requisition approved", blocks: "Approaching any supplier", conditions: "Budget value and quantity remaining; price basis attached; funding source; activity link [D1 §3.2, §4.1, §4.2]" },
  { id: "B", name: "Solicitation authorized", blocks: "Issue and advertising", conditions: "Solicitation and evaluation plan approved; Large: bid plan and HO clearance; criteria locked [D1 §3.2, §5.4]" },
  { id: "B′", name: "Bid access", blocks: "Opening and evaluation", conditions: "Closing time passed; declarations signed against named bidders [D1 §4.6, §4.7]" },
  { id: "C", name: "Award approved", blocks: "Any commitment", conditions: "SSM signed; screening recorded; due diligence; Large: HO package approval [D1 §3.2, §4.8, §5.4]" },
  { id: "D", name: "Signature", blocks: "Commitment", conditions: "Conformity check; checklist pass 1; corrections confirmed [D1 §4.11, §4.17]" },
  { id: "E", name: "Payment-ready", blocks: "Payment release", conditions: "Certified GRN; complete file; screening current; payee verified; checklist pass 2 [D1 §4.13, §4.17]" },
];

export const sharedRecords = [
  { name: "Programme / award", note: "Framework, annexes, forms set" },
  { name: "Activity / budget line", note: "Remaining value and quantity" },
  { name: "Supplier and screening", note: "Dated, per list, human-reviewed" },
  { name: "Bids and evaluation", note: "Sealed until closing" },
  { name: "Approvals", note: "One record per trigger" },
  { name: "Contract and modifications", note: "Signed terms never overwritten" },
  { name: "Delivery / acceptance", note: "Requester-signed GRN" },
  { name: "Invoice / payment", note: "Finance-confirmed" },
  { name: "Evidence", note: "Procurement ID on every document" },
  { name: "Cases and tasks", note: "Typed, with visibility class" },
];

export const caseTypes = [
  { type: "Operational issue", route: "Owner resolves; escalate above threshold", shared: true },
  { type: "Gate block", route: "Returned to preparer; gate stays closed", shared: true },
  { type: "Policy exception", route: "Exception authority, in writing, before commitment [D1 §1.7]", shared: true },
  { type: "Post-facto action", route: "Memo; next level up if cost or compliance is affected [D1 §4.16]", shared: true },
  { type: "Objection memo", route: "Filed; decision stays with the approver [D1 §4.1]", shared: true },
  { type: "Donor conflict", route: "Procurement stops; written waiver first [D1 §1.4]", shared: true },
  { type: "Supplier protest", route: "Reviewed by nobody involved in the procurement [D1 §7.1]", shared: false },
  { type: "Integrity concern", route: "Whistleblower channel only, outside the harness [D1 §2.4]", shared: false },
];

export const boundaries = [
  {
    who: "Automation",
    does: "Level and budget checks, routing, gate blocking, timers, sealed bid receipt, three-way match, file index, retention dates.",
    never: "Infer policy where values are bracketed or roles are blank. Every rule is versioned and labelled with its source.",
  },
  {
    who: "AI",
    does: "Extract, draft, and pre-run the two checks that catch errors: solicitation consistency and contract conformity. Always cited.",
    never: "Classify awards, score bids, resolve screening matches, approve, apply damages, exclude suppliers, or see integrity reports.",
  },
  {
    who: "People",
    does: "Every approval, committee evaluation, screening review, conformity check, receipt certification, payment and closeout.",
    never: "Authorize or process a procurement for themselves. Segregation of duties is a condition of every procurement [D1 §2.1].",
  },
];

export const firstSlice = {
  summary:
    "Replay one completed Large goods procurement (RFQ, lowest price) from requisition to the payment-ready gate, under a Draft 1.0 rule set labelled unapproved [PA].",
  why: [
    "Draft 1.0 must be tested against completed procurements, including ones with known errors, before it takes effect. A replay does that test [D1 transition clause].",
    "The payment-ready checks are procurement-file checks and need no finance integration.",
    "Goods-only, no import, no advance: avoids open decision C4 and the bracketed thresholds.",
  ],
  simulated: ["Award and budget context", "Sealed bid log", "Screening results with human review", "Approvers as configurable roles"],
  integrated: ["Historical documents in a sandbox", "AI pre-checks on those documents", "Budget export snapshot, if the CFO agrees"],
  outOfScope: ["Payment approval and release", "Live bid mailbox", "Live screening", "Works, imports, World Bank"],
};

export const decisions = [
  { q: "Can a replay prototype run before Draft 1.0 is approved, and on which record?", owner: "Director of Operations, CEO" },
  { q: "Where does budget-line data come from, and does it carry quantity and unit cost?", owner: "CFO" },
  { q: "Which approval model: current practice, the Annex G bridge, or placeholders?", owner: "Director of Operations, CEO" },
  { q: "Finance boundary: Finance Manual or NetSuite, and where re-screening sits", owner: "CFO" },
  { q: "Confidential routing for protests and integrity reports", owner: "Director of Operations" },
  { q: "One bid committee or two", owner: "CEO" },
  { q: "Procurement ID: when it is assigned and its format", owner: "Director of Operations" },
];
