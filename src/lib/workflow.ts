/** Content from docs/ROP-END-TO-END-WORKFLOW-DRAFT.md, shaped for the UI. */

export type StepKind = "step" | "gate" | "yes" | "no";

export type WorkflowStep = {
  id: string;
  label: string;
  title: string;
  short: string;
  kind: StepKind;
  what: string;
  owner: string;
  record: string;
  links: string[];
};

export const workflowSteps: WorkflowStep[] = [
  {
    id: "1",
    label: "01",
    title: "Plan the season",
    short: "Dates, owners, inputs, budget",
    kind: "step",
    what: "Set crop-stage training, field activity dates, responsibilities, the input plan, budget links, and MEL questions against the project’s development logic.",
    owner: "Project team. Exact roles follow the project’s org chart.",
    record: "Seasonal plan with linked activities, budget lines, owners, dates, and MEL questions.",
    links: ["Season", "Activity", "Budget line", "Owner", "Dev logic"],
  },
  {
    id: "2",
    label: "02",
    title: "Train farmers",
    short: "Classroom and field, by crop stage",
    kind: "step",
    what: "Deliver classroom and field training for the relevant crop stage, such as land preparation and planting. Farmers must have joined officially and paid their agreed contribution first.",
    owner: "Extension agents lead technical delivery.",
    record: "Training record, attendance and source evidence, issues, and follow-up actions.",
    links: ["Farmer", "Activity", "Evidence"],
  },
  {
    id: "3",
    label: "03",
    title: "Prepare land",
    short: "Plot prepared to technical spec",
    kind: "step",
    what: "Farmers prepare the agreed plot to the technical specifications.",
    owner: "Farmer, supported by the Extension agent.",
    record: "Plot linked to farmer, crop, season, and project.",
    links: ["Plot", "Farmer", "Crop", "Season"],
  },
  {
    id: "4",
    label: "04",
    title: "Verify readiness",
    short: "Joint site visit: Yes or No",
    kind: "gate",
    what: "The Extension agent and MEL staff visit the plot together and record a simple Yes / No finding. Inputs move only on Yes.",
    owner: "Joint site visit. Readiness is a yes/no decision.",
    record: "Standardized field-visit form and evidence reference.",
    links: ["Plot", "Readiness check", "Evidence"],
  },
  {
    id: "5a",
    label: "5A",
    title: "Distribute inputs",
    short: "Package linked to expenditure",
    kind: "yes",
    what: "Confirm readiness and distribute the farm input package.",
    owner: "Authorized project staff record the distribution.",
    record: "Input package, quantities, date, recipient, and expenditure evidence linked together.",
    links: ["Distribution", "Expenditure", "Budget line", "Procurement ID", "Evidence"],
  },
  {
    id: "5b",
    label: "5B",
    title: "Correct & recheck",
    short: "Deadline, recheck, decision",
    kind: "no",
    what: "Give the farmer a defined opportunity and deadline to fix the issue, then recheck. If it is unresolved by the deadline, the farmer is removed. This is expected to be rare after contribution.",
    owner: "Extension agent communicates the corrective action; project authority confirms any removal per local rules.",
    record: "Issue, correction deadline, recheck result, and decision history.",
    links: ["Correction", "Readiness check", "Audit log"],
  },
  {
    id: "6",
    label: "06",
    title: "Plant & follow up",
    short: "Right time, right manner",
    kind: "step",
    what: "Farmers plant the targeted crop at the right time and in the right manner. Technical and MEL teams conduct follow-up site visits and complete the standardized forms.",
    owner: "Farmer; Extension agent; MEL team.",
    record: "Planting and field-visit records, including season-specific measures such as harvest data when due.",
    links: ["Field visit", "Plot", "Evidence"],
  },
  {
    id: "7",
    label: "07",
    title: "Analyze & act",
    short: "Findings, owners, deadlines",
    kind: "step",
    what: "MEL analyzes what is working, what problems need action, and where follow-up is needed, then organizes site-visit findings for management review.",
    owner: "MEL prepares and validates the analysis. Management sets adjustments, owners, and deadlines.",
    record: "Analysis linked to source records, management decisions, action owners, due dates, and next-season changes.",
    links: ["MEL finding", "Management action", "Next season"],
  },
];

export const lifecycle = [
  { title: "Opportunity & go/no-go", detail: "A donor RFP/RFA, an open call, or a self-funded opportunity. Decide whether to pursue it." },
  { title: "Design foundation", detail: "Regions, beneficiaries, value-chain and net-income analysis, selection criteria, and development logic." },
  { title: "Proposal & scope", detail: "Develop the proposal and agree the scope, shaped by donor requirements." },
  { title: "Funding & mobilization", detail: "Hire staff, obtain approvals, set up offices, and localize workflows." },
  { title: "Prepare delivery", detail: "Train trainers, select farmers, collect contributions, and run the baseline survey." },
  { title: "Seasonal delivery", detail: "Crop-stage training, land preparation, readiness, inputs, and planting.", mvp: true },
  { title: "MEL & next season", detail: "Standardized evidence, analysis, management action, and the next seasonal plan.", mvp: true },
  { title: "Closeout or transition", detail: "Preserve evidence, results, obligations, and lessons for what comes next." },
];

export const principles = [
  {
    title: "One reference, many uses",
    body: "Project, farmer, plot, crop, season, activity, budget, and evidence are recorded once and linked everywhere. No copying facts between forms.",
  },
  {
    title: "Trace need to decision",
    body: "Every record connects need → activity → output → outcome → evidence → management decision, and can generate forward actions and dates.",
  },
  {
    title: "Paper counts",
    body: "Paper and offline records are valid source evidence. Capture who completed them, when, where, and where the original is stored.",
  },
  {
    title: "AI drafts, people decide",
    body: "AI may organize records, check completeness, and draft analysis. MEL validates evidence and interpretation; management decides.",
  },
  {
    title: "Earn every output",
    body: "Each new report, form, or task records what it replaces, or why it is genuinely new, and whether it saves effort, time, or improves quality.",
  },
];
