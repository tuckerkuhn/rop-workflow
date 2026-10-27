/**
 * Core data model for the ROP seasonal workflow MVP.
 * See docs/ROP-END-TO-END-WORKFLOW-DRAFT.md, sections 2 and 3.
 *
 * Rule: shared references (project, farmer, plot, crop, season, activity,
 * budget line, evidence) are stored once and linked, never copied.
 */
import {
  boolean,
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
export const actionStatusEnum = pgEnum("action_status", [
  "open",
  "in_progress",
  "done",
  "cancelled",
]);

// ---------- Organization & people ----------

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  ...timestamps,
});

/** App users (staff). `authUserId` links to Supabase Auth. */
export const staff = pgTable("staff", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  authUserId: uuid("auth_user_id").unique(),
  fullName: text("full_name").notNull(),
  email: text("email"),
  ...timestamps,
});

// ---------- Projects & design logic ----------

export const projects = pgTable("projects", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  country: text("country").notNull(), // ISO 3166-1 alpha-2
  donor: text("donor"),
  startDate: date("start_date"),
  endDate: date("end_date"),
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
  projectId: uuid("project_id").notNull().references(() => projects.id),
  /** Short human-readable code used in Kobo forms, e.g. "F-0001". */
  code: text("code").notNull().unique(),
  fullName: text("full_name").notNull(),
  phone: text("phone"),
  village: text("village"),
  status: farmerStatusEnum("status").notNull().default("applicant"),
  contributionPaid: boolean("contribution_paid").notNull().default(false),
  contributionPaidOn: date("contribution_paid_on"),
  enrolledOn: date("enrolled_on"),
  baselineCompletedOn: date("baseline_completed_on"),
  removedOn: date("removed_on"),
  removalReason: text("removal_reason"),
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
export const evidence = pgTable("evidence", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  source: evidenceSourceEnum("source").notNull(),
  koboAssetUid: text("kobo_asset_uid"),
  koboSubmissionUuid: text("kobo_submission_uuid").unique(),
  completedBy: text("completed_by"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  location: text("location"),
  originalStoredAt: text("original_stored_at"), // where paper original lives
  fileUrl: text("file_url"), // Supabase Storage path
  payload: jsonb("payload"), // raw submission for audit
  ...timestamps,
});

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
