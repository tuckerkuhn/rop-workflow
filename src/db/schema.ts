/**
 * Core data model for the ROP seasonal workflow MVP.
 * See docs/ROP-END-TO-END-WORKFLOW-DRAFT.md, sections 2 and 3.
 *
 * Rule: shared references (project, farmer, plot, crop, season, activity,
 * budget line, evidence) are stored once and linked, never copied.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// ---------- Enums ----------

export const roleEnum = pgEnum("role", [
  "admin",
  "project_manager",
  "extension_agent",
  "mel_officer",
  "viewer",
]);
export const farmerStatusEnum = pgEnum("farmer_status", [
  "applicant",
  "selected",
  "enrolled", // joined officially and paid contribution
  "removed",
]);
export const activityTypeEnum = pgEnum("activity_type", [
  "training",
  "land_preparation",
  "readiness_check",
  "input_distribution",
  "planting",
  "field_visit",
  "harvest",
  "other",
]);
export const devLogicLevelEnum = pgEnum("dev_logic_level", [
  "need",
  "activity",
  "output",
  "outcome",
]);
export const correctionStatusEnum = pgEnum("correction_status", [
  "open",
  "resolved",
  "unresolved_removed",
]);
export const evidenceSourceEnum = pgEnum("evidence_source", [
  "kobo",
  "paper",
  "upload",
  "manual",
]);
export const findingStatusEnum = pgEnum("finding_status", [
  "draft", // may be AI-assisted; not yet validated
  "validated", // MEL has validated evidence and interpretation
  "reviewed", // management has reviewed
]);
/** MEL decision on an incoming record in the review queue. */
export const reviewStatusEnum = pgEnum("review_status", ["pending", "accepted", "queried"]);

/** Tasks can be ticked off; milestones are dates to plan around. */
export const workItemTypeEnum = pgEnum("work_item_type", ["task", "milestone"]);
export const milestoneKindEnum = pgEnum("milestone_kind", ["report_deadline", "harvest_window", "field_activity", "other"]);

export const actionStatusEnum = pgEnum("action_status", [
  "open",
  "in_progress",
  "done",
  "cancelled",
]);

// ---------- Organization & people ----------

export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    name: text("name").notNull(),
    /** "free" or "paid". Paid unlocks the features in src/lib/plans.ts. Set with npm run plan until billing exists. */
    plan: text("plan").notNull().default("free"),
    ...timestamps,
  },
  (t) => [check("organizations_plan", sql`${t.plan} IN ('free', 'paid')`)],
);

/** App users (staff). `authUserId` links to Supabase Auth. */
/**
 * People who can sign in. `personId` is the id the app uses everywhere (e.g. "omar"); `profile`
 * holds their roles, access, manager and language (the AppUser fields other than id and name).
 * `email` links a Supabase Auth account on first sign-in; `authUserId` is filled in then.
 */
export const staff = pgTable("staff", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  authUserId: uuid("auth_user_id").unique(),
  personId: text("person_id").unique(),
  fullName: text("full_name").notNull(),
  email: text("email").unique(),
  profile: jsonb("profile"),
  active: boolean("active").notNull().default(true),
  ...timestamps,
});

// ---------- Projects & design logic ----------

export const projects = pgTable("projects", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  /** Short code used in the app and in every Kobo form's hidden project_code, e.g. "A-2027". */
  code: text("code").unique(),
  name: text("name").notNull(),
  country: text("country").notNull(), // ISO 3166-1 alpha-2
  donor: text("donor"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  /** Main crop or value chain, e.g. "Maize". Set in project setup. */
  crop: text("crop"),
  /** What changes for people if the project succeeds (top of the results chain). */
  goal: text("goal"),
  ...timestamps,
});

/** Per-project role assignment; exact roles follow the project's org chart. */
export const projectMembers = pgTable(
  "project_members",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    staffId: uuid("staff_id").notNull().references(() => staff.id),
    role: roleEnum("role").notNull(),
  },
  (t) => [uniqueIndex("project_members_unique").on(t.projectId, t.staffId, t.role)],
);

/** Development logic chain: need -> activity -> output -> outcome. */
export const devLogicNodes = pgTable("dev_logic_nodes", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  parentId: uuid("parent_id"),
  level: devLogicLevelEnum("level").notNull(),
  statement: text("statement").notNull(),
  indicator: text("indicator"),
  ...timestamps,
});

export const crops = pgTable("crops", {
  id: id(),
  name: text("name").notNull(),
  variety: text("variety"),
});

export const budgetLines = pgTable("budget_lines", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  code: text("code").notNull(),
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }),
  currency: text("currency").notNull().default("USD"),
});

// ---------- Farmers & plots ----------

export const farmers = pgTable("farmers", {
  id: id(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  /** Short human-readable code used in Kobo forms, e.g. "F-0001". */
  code: text("code").notNull().unique(),
  /** Deprecated: names live in farmer_pii. Kept nullable so older rows still load. */
  fullName: text("full_name"),
  /** Deprecated: phones live in farmer_pii. */
  phone: text("phone"),
  village: text("village"),
  /** Shown on devices instead of a name, e.g. "M.S." */
  householdHeadInitials: text("household_head_initials"),
  status: farmerStatusEnum("status").notNull().default("applicant"),
  contributionPaid: boolean("contribution_paid").notNull().default(false),
  contributionPaidOn: date("contribution_paid_on"),
  enrolledOn: date("enrolled_on"),
  baselineCompletedOn: date("baseline_completed_on"),
  removedOn: date("removed_on"),
  removalReason: text("removal_reason"),
  ...timestamps,
});

/**
 * Participant personal data, kept apart from everything else (build spec: pseudonymized).
 * Only field-staff roles may read it through the server; AI agents, reports and devices never get it.
 */
export const farmerPii = pgTable("farmer_pii", {
  farmerId: uuid("farmer_id")
    .primaryKey()
    .references(() => farmers.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  phone: text("phone"),
  ...timestamps,
});

export const seasons = pgTable("seasons", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(), // e.g. "2027 Long Rains"
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  /** MEL questions for this season, tied to dev logic. */
  melQuestions: jsonb("mel_questions").$type<string[]>().notNull().default([]),
  ...timestamps,
});

export const plots = pgTable("plots", {
  id: id(),
  farmerId: uuid("farmer_id").notNull().references(() => farmers.id),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  cropId: uuid("crop_id").notNull().references(() => crops.id),
  code: text("code").notNull().unique(), // e.g. "P-0001"
  areaHa: numeric("area_ha", { precision: 8, scale: 3 }),
  latitude: numeric("latitude", { precision: 9, scale: 6 }),
  longitude: numeric("longitude", { precision: 9, scale: 6 }),
  ...timestamps,
});

// ---------- Evidence ----------

/**
 * Any source record: Kobo submission, paper form, upload, or manual entry.
 * Paper is valid evidence: record who, when, where the original is stored.
 */
export const evidence = pgTable(
  "evidence",
  {
    id: id(),
    organizationId: uuid("organization_id").references(() => organizations.id),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    source: evidenceSourceEnum("source").notNull(),
    /** Which form this record is: "readiness", "training", "distribution", "visit". */
    form: text("form"),
    /** Farmer the record is about, by code (never by name). */
    farmerCode: text("farmer_code"),
    /** Review queue state: MEL accepts or queries each incoming record. */
    reviewStatus: reviewStatusEnum("review_status").notNull().default("pending"),
    /** Demo user id until real sign-in exists. */
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    queryNote: text("query_note"),
    koboAssetUid: text("kobo_asset_uid"),
    /** Kobo's _uuid. Unique per project: a form shared by two projects gives each its own copy. */
    koboSubmissionUuid: text("kobo_submission_uuid"),
    completedBy: text("completed_by"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    location: text("location"),
    originalStoredAt: text("original_stored_at"), // where paper original lives
    fileUrl: text("file_url"), // Supabase Storage path
    payload: jsonb("payload"), // raw submission for audit
    ...timestamps,
  },
  (t) => [uniqueIndex("evidence_project_submission").on(t.projectId, t.koboSubmissionUuid)],
);

// ---------- Field activities workflow state ----------

/**
 * Current workflow state of each farmer and MEL finding in Field activities
 * (step, checks, timeline, issues, surveys, photos, stories). Never holds names.
 */
export const fieldItems = pgTable(
  "field_items",
  {
    id: id(),
    organizationId: uuid("organization_id").references(() => organizations.id),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    /** "F-0009" for a farmer, "MF-01" for a finding. */
    itemKey: text("item_key").notNull(),
    kind: text("kind").notNull(),
    data: jsonb("data").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("field_items_project_key").on(t.projectId, t.itemKey)],
);

/** Small per-project state documents, e.g. store stock. */
export const projectState = pgTable(
  "project_state",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    key: text("key").notNull(),
    data: jsonb("data").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("project_state_project_key").on(t.projectId, t.key)],
);

// ---------- Indicators & donors ----------

/** Where an indicator sits in the results chain. Goal and outcome indicators are the project's impact. */
export const indicatorLevelEnum = pgEnum("indicator_level", ["goal", "outcome", "output"]);
/** How often an indicator is reported; sets the period in which it should have new data. */
export const indicatorFrequencyEnum = pgEnum("indicator_frequency", ["monthly", "quarterly", "end_of_season"]);

/**
 * What the project measures. `source` is the form whose accepted records count toward it
 * ("survey" for values entered from a survey); `filter` narrows it to one answer.
 */
export const indicators = pgTable(
  "indicators",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    /** Short code shown everywhere and used in donor mappings, e.g. "IND-1". */
    code: text("code").notNull(),
    name: text("name").notNull(),
    unit: text("unit").notNull(),
    target: numeric("target", { precision: 14, scale: 2 }).notNull(),
    level: indicatorLevelEnum("level").notNull(),
    /** The result statement it measures, e.g. "Farmers trained in improved land preparation". */
    result: text("result"),
    source: text("source").notNull(),
    /** e.g. { field: "result", equals: "Yes" }: count only records with that answer. */
    filter: jsonb("filter").$type<{ field: string; equals: string }>(),
    frequency: indicatorFrequencyEnum("frequency").notNull(),
    /** Indicator library theme, e.g. "Net income". */
    theme: text("theme"),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex("indicators_project_code").on(t.projectId, t.code)],
);

/**
 * A donor funding the project. Its reporting deadlines are report_deadline milestones in
 * work_items (linked by donor_id), so they show in Tasks without being stored twice.
 */
export const donors = pgTable("donors", {
  id: id(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(),
  /** Report layout id from src/lib/report-formats.ts. */
  reportFormat: text("report_format").notNull().default("baseline"),
  /** The donor's own code for each indicator it tracks, keyed by indicator code. Indicators left out are not in its report. */
  indicatorRefs: jsonb("indicator_refs").$type<Record<string, string>>().notNull().default({}),
  ...timestamps,
});

// ---------- KoboToolbox link (per project) ----------

/**
 * A project's KoboToolbox account. The API token is encrypted with KOBO_TOKEN_KEY
 * (AES-256-GCM) and only ever decrypted on the server; the browser sees the last 4 characters.
 */
export const koboConnections = pgTable("kobo_connections", {
  id: id(),
  projectId: uuid("project_id")
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: "cascade" }),
  serverUrl: text("server_url").notNull(),
  tokenEncrypted: text("token_encrypted").notNull(),
  tokenHint: text("token_hint").notNull(),
  /** "all": every submission counts. "approved": only those marked Approved in KoboToolbox. */
  countOnly: text("count_only").notNull().default("all"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  connectedBy: text("connected_by"),
  ...timestamps,
});

/** Forms (Kobo assets) whose submissions belong to the project. */
export const koboForms = pgTable(
  "kobo_forms",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    assetUid: text("asset_uid").notNull(),
    name: text("name").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("kobo_forms_project_asset").on(t.projectId, t.assetUid)],
);

/**
 * How one indicator is counted from one form question. Methods: count_answered (submissions
 * that answered it), count_answer (answered `value`), count_unique (distinct answers, e.g. farmer
 * IDs), sum (total of a number question).
 */
export const koboMappings = pgTable("kobo_mappings", {
  id: id(),
  indicatorId: uuid("indicator_id")
    .notNull()
    .unique()
    .references(() => indicators.id, { onDelete: "cascade" }),
  assetUid: text("asset_uid").notNull(),
  /** The question's path in submissions ($xpath), e.g. "training/farmer_id". */
  question: text("question").notNull(),
  method: text("method").notNull(),
  value: text("value"),
  ...timestamps,
});

// ---------- Tasks & milestones ----------

/**
 * Work added in Tasks: to-dos people tick off, and milestones (report deadlines, harvest
 * windows, field activities). Field and procurement steps are not copied here; Tasks reads
 * them from their own workflows.
 */
export const workItems = pgTable(
  "work_items",
  {
    id: id(),
    organizationId: uuid("organization_id").references(() => organizations.id),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    type: workItemTypeEnum("type").notNull(),
    title: text("title").notNull(),
    /** Task: due date, optional. Milestone: its date, or the first day of a range. */
    date: date("date"),
    /** Milestones only: last day of a range, e.g. a harvest window. */
    endDate: date("end_date"),
    milestoneKind: milestoneKindEnum("milestone_kind"),
    /** Tasks only: the person id the app uses, e.g. "omar". Empty means anyone on the project. */
    assignee: text("assignee"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    doneBy: text("done_by"),
    createdBy: text("created_by"),
    /** The donor a report deadline belongs to; deleting the donor removes its deadlines. */
    donorId: uuid("donor_id").references(() => donors.id, { onDelete: "cascade" }),
    /** Set on items the app makes itself (demo data, donor deadlines) so they update instead of duplicating. */
    sourceKey: text("source_key"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("work_items_project_source").on(t.projectId, t.sourceKey),
    check(
      "work_items_shape",
      sql`(${t.type} = 'task' AND ${t.milestoneKind} IS NULL AND ${t.endDate} IS NULL)
        OR (${t.type} = 'milestone' AND ${t.milestoneKind} IS NOT NULL AND ${t.date} IS NOT NULL AND ${t.doneAt} IS NULL
            AND (${t.endDate} IS NULL OR ${t.endDate} >= ${t.date}))`,
    ),
  ],
);

// ---------- Seasonal plan & activities ----------

export const activities = pgTable("activities", {
  id: id(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  type: activityTypeEnum("type").notNull(),
  title: text("title").notNull(),
  devLogicNodeId: uuid("dev_logic_node_id").references(() => devLogicNodes.id),
  budgetLineId: uuid("budget_line_id").references(() => budgetLines.id),
  ownerId: uuid("owner_id").references(() => staff.id),
  plannedStart: date("planned_start"),
  plannedEnd: date("planned_end"),
  completedOn: date("completed_on"),
  notes: text("notes"),
  ...timestamps,
});

export const trainingAttendance = pgTable(
  "training_attendance",
  {
    id: id(),
    activityId: uuid("activity_id").notNull().references(() => activities.id),
    farmerId: uuid("farmer_id").notNull().references(() => farmers.id),
    attended: boolean("attended").notNull(),
    evidenceId: uuid("evidence_id").references(() => evidence.id),
  },
  (t) => [uniqueIndex("training_attendance_unique").on(t.activityId, t.farmerId)],
);

// ---------- Readiness gate (steps 4, 5a, 5b) ----------

export const readinessChecks = pgTable("readiness_checks", {
  id: id(),
  plotId: uuid("plot_id").notNull().references(() => plots.id),
  /** Set when this check is a recheck after a correction. */
  correctionId: uuid("correction_id"),
  visitDate: date("visit_date").notNull(),
  extensionAgentId: uuid("extension_agent_id").references(() => staff.id),
  melOfficerId: uuid("mel_officer_id").references(() => staff.id),
  ready: boolean("ready").notNull(), // the Yes / No finding
  issue: text("issue"),
  evidenceId: uuid("evidence_id").references(() => evidence.id),
  ...timestamps,
});

export const corrections = pgTable("corrections", {
  id: id(),
  readinessCheckId: uuid("readiness_check_id").notNull().references(() => readinessChecks.id),
  requiredAction: text("required_action").notNull(),
  deadline: date("deadline").notNull(),
  communicatedById: uuid("communicated_by_id").references(() => staff.id),
  status: correctionStatusEnum("status").notNull().default("open"),
  /** Project authority who confirmed removal, per local rules. */
  removalConfirmedById: uuid("removal_confirmed_by_id").references(() => staff.id),
  ...timestamps,
});

// ---------- Inputs & expenditure (step 5a) ----------

export const expenditures = pgTable("expenditures", {
  id: id(),
  budgetLineId: uuid("budget_line_id").notNull().references(() => budgetLines.id),
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  spentOn: date("spent_on").notNull(),
  evidenceId: uuid("evidence_id").references(() => evidence.id),
  ...timestamps,
});

export const inputDistributions = pgTable("input_distributions", {
  id: id(),
  plotId: uuid("plot_id").notNull().references(() => plots.id),
  readinessCheckId: uuid("readiness_check_id").notNull().references(() => readinessChecks.id),
  activityId: uuid("activity_id").references(() => activities.id),
  distributedOn: date("distributed_on").notNull(),
  recordedById: uuid("recorded_by_id").references(() => staff.id),
  /** e.g. [{ item: "Maize seed", unit: "kg", quantity: 10 }] */
  items: jsonb("items").$type<{ item: string; unit: string; quantity: number }[]>().notNull(),
  expenditureId: uuid("expenditure_id").references(() => expenditures.id),
  evidenceId: uuid("evidence_id").references(() => evidence.id),
  ...timestamps,
});

// ---------- Planting & follow-up (step 6) ----------

export const fieldVisits = pgTable("field_visits", {
  id: id(),
  plotId: uuid("plot_id").notNull().references(() => plots.id),
  activityId: uuid("activity_id").references(() => activities.id),
  visitDate: date("visit_date").notNull(),
  visitType: text("visit_type").notNull(), // planting, follow_up, harvest...
  visitedById: uuid("visited_by_id").references(() => staff.id),
  /** Season-specific measures, e.g. { planted_on_time: true, yield_kg: 420 } */
  measures: jsonb("measures").$type<Record<string, unknown>>().notNull().default({}),
  issues: text("issues"),
  evidenceId: uuid("evidence_id").references(() => evidence.id),
  ...timestamps,
});

// ---------- MEL & management (step 7) ----------

export const melFindings = pgTable("mel_findings", {
  id: id(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  devLogicNodeId: uuid("dev_logic_node_id").references(() => devLogicNodes.id),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  status: findingStatusEnum("status").notNull().default("draft"),
  aiAssisted: boolean("ai_assisted").notNull().default(false),
  validatedById: uuid("validated_by_id").references(() => staff.id),
  validatedAt: timestamp("validated_at", { withTimezone: true }),
  ...timestamps,
});

/** Links a finding to the source records it is based on. */
export const findingSources = pgTable("finding_sources", {
  id: id(),
  findingId: uuid("finding_id").notNull().references(() => melFindings.id),
  evidenceId: uuid("evidence_id").notNull().references(() => evidence.id),
});

export const managementActions = pgTable("management_actions", {
  id: id(),
  findingId: uuid("finding_id").references(() => melFindings.id),
  title: text("title").notNull(),
  ownerId: uuid("owner_id").references(() => staff.id),
  dueDate: date("due_date"),
  status: actionStatusEnum("status").notNull().default("open"),
  /** Season this action should change (the learning loop). */
  appliesToSeasonId: uuid("applies_to_season_id").references(() => seasons.id),
  /** What existing report/form/task this replaces, or why it is new. */
  replaces: text("replaces"),
  ...timestamps,
});

/** Append-only history of decisions (removals, gate outcomes, approvals). */
export const auditLog = pgTable("audit_log", {
  id: id(),
  projectId: uuid("project_id").references(() => projects.id),
  actorId: uuid("actor_id").references(() => staff.id),
  entity: text("entity").notNull(),
  entityId: uuid("entity_id").notNull(),
  action: text("action").notNull(),
  detail: jsonb("detail"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  sequence: integer("sequence").generatedAlwaysAsIdentity(),
});
