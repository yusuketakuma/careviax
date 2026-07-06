import type { Prisma, MemberRole } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { isoOrNull } from '@/lib/utils/date';
import { mapWithConcurrency, normalizeConcurrencyLimit } from '@/lib/utils/concurrency';
import { normalizeJsonInput, readJsonObject } from '@/lib/db/json';
import { formatDateKey } from '@/lib/date-key';
import { buildPatientArchiveSummary } from '@/lib/patient/archive-summary';
import { listBillingEvidenceBlockers } from '@/server/services/billing-evidence';
import type { BillingEvidenceBlockersReader } from '@/server/services/billing-evidence';
import {
  getInquiryPresentationBadges,
  getInquiryPrimaryDetail,
} from '@/lib/inquiries/presentation';
import { listCommunicationQueue } from '@/server/services/communication-queue';
import { buildCommunicationRequestsHref } from '@/lib/communications/navigation';
import { buildPatientHref } from '@/lib/patient/navigation';
import { formatLabAnalyteLabel } from '@/lib/patient/lab-analytes';
import { formatCommunicationRequestTypeLabel } from '@/lib/communications/request-labels';
import { describeOperationalTask } from '@/lib/tasks/operational-task-presentation';
import { generateVisitBriefAiSummary } from '@/server/services/visit-brief-ai';
import { buildPatientStateSnapshot } from '@/server/services/patient-state-snapshot';
import { diffPatientStateSnapshots } from '@/server/services/visit-brief-patient-diff';
import {
  listPatientLabSummary,
  type PatientLabSummaryDb,
} from '@/server/services/patient-detail-labs';
import { getHomeVisitIntake, buildBaselineContext } from '@/lib/patient/home-visit-intake';
import { timeDateToString } from '@/lib/visits/time-of-day';
import {
  buildPharmacyVisitBriefDispensingItems,
  detectPharmacyVisitBriefMedicationChanges,
  normalizePharmacyJahisSupplementalRecordsForVisitBrief,
} from '@/modules/pharmacy';
import type {
  VisitBrief,
  VisitBriefAiSummary,
  VisitBriefCommunicationItem,
  VisitBriefConferenceSummary,
  VisitBriefDeliveryItem,
  VisitBriefDispensingItem,
  VisitBriefDosageFormCandidate,
  VisitBriefDrugCaution,
  VisitBriefFacilityContext,
  VisitBriefLatestLab,
  VisitBriefMedicationChange,
  VisitBriefMedicationItem,
  VisitBriefJahisSupplementalRecord,
  VisitBriefRuleSummary,
  VisitBriefSeverity,
  VisitBriefUnresolvedItem,
} from '@/types/visit-brief';

type FindManyDelegate<T> = {
  findMany(args: unknown): Promise<T[]>;
};

type FindFirstDelegate<T> = {
  findFirst(args: unknown): Promise<T | null>;
};

type VisitBriefDataReader = BillingEvidenceBlockersReader & {
  auditLog?: {
    count?(args: unknown): Promise<number>;
    create?(args: unknown): Promise<unknown>;
  };
  careCase: FindManyDelegate<{ id: string; required_visit_support?: unknown }> & {
    findFirst?(args: unknown): Promise<{ required_visit_support: unknown } | null>;
  };
  conferenceNote?: FindManyDelegate<{
    id: string;
    title: string;
    conference_date: Date;
    action_items: unknown;
    metadata: unknown;
  }>;
  communicationEvent: FindManyDelegate<{
    event_type: string;
    subject: string | null;
    content: string | null;
    counterpart_name: string | null;
    occurred_at: Date;
    direction: string;
    channel: string;
  }>;
  communicationRequest: FindManyDelegate<{
    id: string;
    patient_id: string | null;
    request_type: string;
    subject: string;
    content: string;
    related_entity_type: string | null;
    related_entity_id: string | null;
    status: string;
    due_date: Date | null;
    requested_at: Date;
  }>;
  drugMaster?: FindManyDelegate<DrugMasterEnrichment>;
  drugPackageInsert: FindManyDelegate<{
    drug_master: { yj_code: string; drug_name: string };
    contraindications: unknown;
    adverse_effects: unknown;
    precautions_elderly: unknown;
  }>;
  jahisSupplementalRecord?: FindManyDelegate<JahisSupplementalRecordForBrief>;
  inquiryRecord: FindManyDelegate<{
    id: string;
    reason: string;
    inquiry_content: string;
    proposal_origin?: 'post_inquiry' | 'pre_issuance' | null;
    residual_adjustment?: boolean | null;
    change_detail?: string | null;
  }>;
  medicationCycle: FindManyDelegate<{ id: string }>;
  medicationIssue: FindManyDelegate<{
    id: string;
    title: string;
    description: string;
    priority: string;
    category: string | null;
  }>;
  medicationProfile: FindManyDelegate<{
    drug_name: string;
    dose: string | null;
    frequency: string | null;
    start_date: Date | null;
    end_date: Date | null;
    prescriber: string | null;
    source: string | null;
  }>;
  patient: FindFirstDelegate<{
    id: string;
    name: string;
    archived_at?: Date | string | null;
    scheduling_preference?: {
      visit_before_contact_required: boolean | null;
    } | null;
  }>;
  patientSelfReport: FindManyDelegate<{
    subject: string;
    category: string;
    content: string;
    status: string;
    reported_by_name: string;
    requested_callback: boolean;
    created_at: Date;
  }>;
  prescriptionIntake: FindManyDelegate<{
    prescribed_date: Date;
    prescriber_name: string | null;
    lines: PrescriptionLineLike[];
  }>;
  residence?: FindFirstDelegate<{
    facility: {
      acceptance_time_from: Date | null;
      acceptance_time_to: Date | null;
      notes: string | null;
    } | null;
  }>;
  setPlan: FindFirstDelegate<{
    set_method?: string | null;
    target_period_start?: Date | null;
    target_period_end?: Date | null;
    notes?: string | null;
    audits?: Array<{ result: string }>;
  }>;
  task: FindManyDelegate<{
    task_type: string;
    title: string;
    description: string | null;
    priority: string;
    related_entity_type: string | null;
    related_entity_id: string | null;
  }>;
  visitScheduleContactLog: FindManyDelegate<{
    outcome: string;
    contact_name: string | null;
    note: string | null;
    callback_due_at: Date | null;
    called_at: Date;
  }>;
  visitRecord: FindFirstDelegate<{
    soap_plan: string | null;
    patient_state_snapshot?: Prisma.JsonValue;
  }> & {
    findMany?(args: unknown): Promise<Array<{ id: string }>>;
  };
};

export type VisitBriefDbClient = typeof prisma | Prisma.TransactionClient | VisitBriefDataReader;

type DbClient = VisitBriefDbClient;

function compactTimelineValues(values: Array<string | null | undefined | false>) {
  return values.filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
}

type PackageInsertTextEntry = {
  text: string;
  severity?: string;
};

function readPackageInsertTextEntry(value: unknown): PackageInsertTextEntry | null {
  if (typeof value === 'string') {
    const text = value.trim();
    return text.length > 0 ? { text } : null;
  }

  const entry = readJsonObject(value);
  if (!entry) return null;

  const text = ['text', 'description', 'name', 'summary']
    .map((key) => entry[key])
    .find(
      (candidate): candidate is string =>
        typeof candidate === 'string' && candidate.trim().length > 0,
    );
  if (!text) return null;

  const severity =
    typeof entry.severity === 'string' && entry.severity.trim().length > 0
      ? entry.severity.trim()
      : undefined;

  return { text: text.trim(), severity };
}

function readPackageInsertTextEntries(value: unknown): PackageInsertTextEntry[] {
  if (Array.isArray(value)) {
    return value
      .map(readPackageInsertTextEntry)
      .filter((entry): entry is PackageInsertTextEntry => entry !== null);
  }

  const entry = readPackageInsertTextEntry(value);
  return entry ? [entry] : [];
}

type PrescriptionLineLike = {
  drug_name: string;
  drug_code: string | null;
  dosage_form: string | null;
  dose: string;
  frequency: string;
  route: string | null;
  dispensing_method: string | null;
  packaging_instructions: string | null;
  packaging_instruction_tags?: string[] | null;
  notes?: string | null;
  unit?: string | null;
  start_date: Date | null;
  end_date: Date | null;
};

type BuildVisitBriefArgs = {
  orgId: string;
  patientId: string;
  context: 'patient' | 'schedule';
  limit?: number;
  actorId?: string;
  caseIds?: string[];
  currentScheduleId?: string;
  scheduledDate?: Date;
  // patient_changes(前回訪問差分)算出に必要。揃わない経路(schedule バッチ等)は差分を出さない。
  role?: MemberRole;
  userId?: string;
};

type ScheduleBriefRequest = Omit<BuildVisitBriefArgs, 'context' | 'patientId' | 'caseIds'> & {
  scheduleId: string;
  patientId: string;
  caseId: string;
};

const OPEN_TASK_STATUSES = ['pending', 'in_progress'] as const;
const OPEN_SELF_REPORT_STATUSES = ['submitted', 'triaged', 'converted_to_task'] as const;
const OPEN_REQUEST_STATUSES = ['draft', 'sent', 'received', 'in_progress', 'escalated'] as const;
const OPEN_ISSUE_STATUSES = ['open', 'in_progress'] as const;
const VISIT_BRIEF_LAB_STALE_DAYS = 90;

async function listVisitBriefBillingRefs(
  db: DbClient,
  args: BuildVisitBriefArgs,
  caseIds: string[],
) {
  if (args.caseIds === undefined || caseIds.length === 0) {
    return { visitRecordIds: undefined, cycleIds: undefined };
  }
  if (typeof db.visitRecord.findMany !== 'function') {
    return { visitRecordIds: undefined, cycleIds: undefined };
  }

  const [visitRecords, cycles] = await Promise.all([
    db.visitRecord.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        schedule: {
          case_id: { in: caseIds },
        },
      },
      select: { id: true },
    }),
    db.medicationCycle.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        case_id: { in: caseIds },
      },
      select: { id: true },
    }),
  ]);

  return {
    visitRecordIds: visitRecords.map((item) => item.id),
    cycleIds: cycles.map((item) => item.id),
  };
}

type JahisSupplementalRecordForBrief = {
  id: string;
  record_type: string;
  record_label: string;
  summary: string | null;
  payload: unknown;
  raw_line: string;
  created_at: Date;
};

// facility acceptance_time_from/to are @db.Time() values (stored as a UTC
// 1970-01-01 date). Format them through the shared UTC-based helper so the
// clock time is not shifted by the server's local timezone. Using getHours()
// here (local tz) renders the wrong time on a non-UTC server (e.g. JST +9).
function timeToHHMM(value: Date | null | undefined): string | null {
  return timeDateToString(value) ?? null;
}

async function listLatestLabsForVisitBrief(
  db: DbClient,
  args: Pick<BuildVisitBriefArgs, 'orgId' | 'patientId'>,
) {
  const labDb = db as Partial<PatientLabSummaryDb>;
  if (!labDb.patientLabObservation?.findMany) return [];
  return listPatientLabSummary(labDb as PatientLabSummaryDb, args);
}

function formatVisitBriefLabValue(lab: { value_numeric: number | null; unit: string | null }) {
  if (lab.value_numeric != null) {
    return `${lab.value_numeric}${lab.unit ? ` ${lab.unit}` : ''}`;
  }
  return lab.unit ? `値なし ${lab.unit}` : '値なし';
}

function buildVisitBriefLatestLabs(
  labs: Awaited<ReturnType<typeof listPatientLabSummary>>,
  now: Date,
): VisitBriefLatestLab[] {
  return labs.slice(0, 6).map((lab) => {
    const ageDays = Math.floor((now.getTime() - lab.measured_at.getTime()) / (24 * 60 * 60_000));
    const stale = ageDays > VISIT_BRIEF_LAB_STALE_DAYS;
    const measuredAtLabel = formatDateKey(lab.measured_at) ?? '測定日未設定';
    return {
      analyte_code: lab.analyte_code,
      analyte_label: formatLabAnalyteLabel(lab.analyte_code),
      value_numeric: lab.value_numeric,
      unit: lab.unit,
      value_label: formatVisitBriefLabValue(lab),
      measured_at: lab.measured_at.toISOString(),
      measured_at_label: measuredAtLabel,
      stale,
      abnormal: Boolean(lab.abnormal_flag),
      abnormal_flag: lab.abnormal_flag,
    };
  });
}

async function listJahisSupplementalRecordsForBrief(
  db: DbClient,
  args: { orgId: string; patientId: string; limit?: number },
): Promise<JahisSupplementalRecordForBrief[]> {
  const client = (
    db as unknown as {
      jahisSupplementalRecord?: {
        findMany?: (args: Record<string, unknown>) => Promise<JahisSupplementalRecordForBrief[]>;
      };
    }
  ).jahisSupplementalRecord;

  if (!client?.findMany) return [];

  return client.findMany({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
    },
    orderBy: [{ created_at: 'desc' }, { line_number: 'asc' }],
    take: args.limit ?? 6,
    select: {
      id: true,
      record_type: true,
      record_label: true,
      summary: true,
      payload: true,
      raw_line: true,
      created_at: true,
    },
  });
}

function severityFromPriority(priority: string | null | undefined): VisitBriefSeverity {
  switch (priority) {
    case 'urgent':
    case 'emergency':
      return 'urgent';
    case 'high':
    case 'escalated':
      return 'high';
    case 'low':
      return 'low';
    default:
      return 'normal';
  }
}

type DrugMasterEnrichment = {
  yj_code: string;
  drug_price: { toNumber: () => number } | null;
  is_generic: boolean;
  is_narcotic: boolean;
  is_psychotropic: boolean;
  therapeutic_category: string | null;
};

function buildMedicationItems(args: {
  currentLines: PrescriptionLineLike[];
  medicationProfiles: Array<{
    drug_name: string;
    dose: string | null;
    frequency: string | null;
    start_date: Date | null;
    end_date: Date | null;
    prescriber: string | null;
    source: string | null;
  }>;
  prescriberName: string | null;
  drugMasterMap: Map<string, DrugMasterEnrichment>;
}): VisitBriefMedicationItem[] {
  const enrich = (drugCode: string | null) => {
    const dm = drugCode ? args.drugMasterMap.get(drugCode) : undefined;
    return {
      drug_price: dm?.drug_price?.toNumber() ?? null,
      is_generic: dm?.is_generic ?? null,
      is_narcotic: dm?.is_narcotic ?? null,
      is_psychotropic: dm?.is_psychotropic ?? null,
      therapeutic_category: dm?.therapeutic_category ?? null,
    };
  };

  if (args.currentLines.length > 0) {
    return args.currentLines.map((line) => ({
      drug_name: line.drug_name,
      dose: line.dose,
      frequency: line.frequency,
      dosage_form: line.dosage_form,
      route: line.route,
      prescriber_name: args.prescriberName,
      start_date: isoOrNull(line.start_date),
      end_date: isoOrNull(line.end_date),
      source: 'prescription',
      ...enrich(line.drug_code),
    }));
  }

  return args.medicationProfiles.map((item) => ({
    drug_name: item.drug_name,
    dose: item.dose ?? '—',
    frequency: item.frequency ?? '—',
    dosage_form: null,
    route: null,
    prescriber_name: item.prescriber,
    start_date: isoOrNull(item.start_date),
    end_date: isoOrNull(item.end_date),
    source: item.source,
    drug_price: null,
    is_generic: null,
    is_narcotic: null,
    is_psychotropic: null,
    therapeutic_category: null,
  }));
}

/**
 * Build drug cautions from DrugPackageInsert data for visit preparation.
 * Surfaces contraindications, adverse effects, and elderly precautions
 * so pharmacists can review them before visiting.
 */
async function buildDrugCautions(
  db: DbClient,
  drugCodes: string[],
): Promise<VisitBriefDrugCaution[]> {
  if (drugCodes.length === 0) return [];

  const packageInserts = await db.drugPackageInsert.findMany({
    where: { drug_master: { yj_code: { in: drugCodes } } },
    include: { drug_master: { select: { yj_code: true, drug_name: true } } },
  });

  const cautions: VisitBriefDrugCaution[] = [];

  for (const pi of packageInserts) {
    const code = pi.drug_master.yj_code;
    const name = pi.drug_master.drug_name;

    for (const c of readPackageInsertTextEntries(pi.contraindications).slice(0, 3)) {
      cautions.push({
        drug_name: name,
        drug_code: code,
        caution_type: 'contraindication',
        severity: 'critical',
        summary: c.text.slice(0, 120),
      });
    }

    for (const a of readPackageInsertTextEntries(pi.adverse_effects).slice(0, 3)) {
      cautions.push({
        drug_name: name,
        drug_code: code,
        caution_type: 'adverse_effect',
        severity: a.severity?.toLowerCase() === 'serious' ? 'critical' : 'warning',
        summary: a.text.slice(0, 120),
      });
    }

    for (const e of readPackageInsertTextEntries(pi.precautions_elderly).slice(0, 2)) {
      cautions.push({
        drug_name: name,
        drug_code: code,
        caution_type: 'elderly_precaution',
        severity: 'warning',
        summary: e.text.slice(0, 120),
      });
    }
  }

  return cautions;
}

function buildDeliveryItems(
  timeline: Array<{
    source_type: 'care_report' | 'tracing_report' | 'communication_request' | 'delivery_record';
    title: string;
    summary: string;
    status: string;
    occurred_at: string | null;
    action_href: string;
  }>,
): VisitBriefDeliveryItem[] {
  const actionableStatuses = new Set(['draft', 'failed', 'response_waiting', 'sent', 'received']);
  return timeline
    .filter(
      (item) =>
        item.source_type === 'delivery_record' ||
        item.source_type === 'care_report' ||
        item.source_type === 'tracing_report',
    )
    .filter((item) => actionableStatuses.has(item.status))
    .map((item) => {
      const statusBucket: VisitBriefDeliveryItem['status_bucket'] =
        item.status === 'failed'
          ? 'failed'
          : item.status === 'response_waiting' || item.status === 'received'
            ? 'reply_waiting'
            : item.status === 'sent'
              ? 'shared'
              : 'unconfirmed';

      return {
        title: item.title,
        status_bucket: statusBucket,
        summary: item.summary,
        occurred_at: item.occurred_at,
        action_href: item.action_href,
      };
    })
    .slice(0, 4);
}

function buildDosageFormSupport(args: {
  currentLines: PrescriptionLineLike[];
  selfReports: Array<{
    category: string;
    subject: string;
    content: string;
  }>;
  medicationIssues: Array<{
    title: string;
    description: string;
    category: string | null;
  }>;
}): VisitBriefDosageFormCandidate[] {
  const candidates: VisitBriefDosageFormCandidate[] = [];
  const textSignals = [
    ...args.selfReports.flatMap((item) => [item.category, item.subject, item.content]),
    ...args.medicationIssues.flatMap((item) => [item.title, item.description, item.category ?? '']),
  ].join(' ');

  const wantsUnitDose = /一包化|飲み忘れ|服薬管理|タイミング/.test(textSignals);
  const wantsCrush = /粉砕|嚥下|むせ|飲みにく/.test(textSignals);
  const wantsFormChange = /剤形|貼付|液剤|ゼリー|飲めない/.test(textSignals);

  const primaryDrugName = args.currentLines[0]?.drug_name ?? null;

  if (wantsUnitDose) {
    candidates.push({
      drug_name: primaryDrugName,
      category: 'unit_dose',
      reason: '自己申告または薬学的課題に服薬タイミング管理・飲み忘れシグナルがあります。',
      caution: '一包化済み薬や頓用薬は重複運用に注意してください。',
    });
  }
  if (wantsCrush) {
    candidates.push({
      drug_name: primaryDrugName,
      category: 'crush',
      reason: '嚥下・飲みにくさ関連の記載があり、粉砕可否の確認候補です。',
      caution: '徐放製剤や腸溶剤は粉砕不可の可能性があります。',
    });
  }
  if (wantsFormChange) {
    candidates.push({
      drug_name: primaryDrugName,
      category: 'form_change',
      reason: '剤形変更や貼付/液剤への切替検討シグナルがあります。',
      caution: '同効薬切替時は処方意図と残薬の整合を確認してください。',
    });
  }

  return candidates.slice(0, 3);
}

function sortCommunications(left: VisitBriefCommunicationItem, right: VisitBriefCommunicationItem) {
  const severityRank: Record<VisitBriefSeverity, number> = {
    urgent: 0,
    high: 1,
    normal: 2,
    low: 3,
  };
  const severityDelta = severityRank[left.severity] - severityRank[right.severity];
  if (severityDelta !== 0) return severityDelta;

  const leftTime = left.occurred_at ? new Date(left.occurred_at).getTime() : 0;
  const rightTime = right.occurred_at ? new Date(right.occurred_at).getTime() : 0;
  return rightTime - leftTime;
}

function buildCommunicationItems(args: {
  selfReports: Array<{
    subject: string;
    category: string;
    content: string;
    status: string;
    reported_by_name: string;
    requested_callback: boolean;
    created_at: Date;
  }>;
  communicationEvents: Array<{
    event_type: string;
    subject: string | null;
    content: string | null;
    counterpart_name: string | null;
    occurred_at: Date;
    direction: string;
    channel: string;
  }>;
  communicationRequests: Array<{
    id: string;
    patient_id: string | null;
    request_type: string;
    subject: string;
    content: string;
    related_entity_type: string | null;
    related_entity_id: string | null;
    status: string;
    due_date: Date | null;
    requested_at: Date;
  }>;
  contactLogs: Array<{
    outcome: string;
    contact_name: string | null;
    note: string | null;
    callback_due_at: Date | null;
    called_at: Date;
  }>;
}): VisitBriefCommunicationItem[] {
  const items: VisitBriefCommunicationItem[] = [
    ...args.selfReports.map((item) => ({
      source_type: 'self_report' as const,
      title: `自己申告 ${item.category}`,
      summary: `${item.subject} / ${item.content}`,
      occurred_at: item.created_at.toISOString(),
      counterpart: item.reported_by_name,
      severity: (item.requested_callback ? 'high' : 'normal') as VisitBriefSeverity,
    })),
    ...args.communicationEvents.map((item) => ({
      source_type: 'communication' as const,
      title: item.subject ?? item.event_type,
      summary: `${item.direction} / ${item.channel}${item.content ? ` / ${item.content}` : ''}`,
      occurred_at: item.occurred_at.toISOString(),
      counterpart: item.counterpart_name,
      severity: (item.direction === 'inbound' ? 'high' : 'normal') as VisitBriefSeverity,
    })),
    ...args.communicationRequests.map((item) => ({
      source_type: 'request' as const,
      title: item.subject,
      summary: `${formatCommunicationRequestTypeLabel(item.request_type)} / ${item.status}${
        item.content ? ` / ${item.content}` : ''
      }`,
      occurred_at: (item.due_date ?? item.requested_at).toISOString(),
      counterpart: null,
      severity: severityFromPriority(item.status),
      action_href: buildCommunicationRequestsHref({
        status: item.status,
        requestType: item.request_type,
        patientId: item.patient_id,
        requestId: item.id,
        relatedEntityType: item.related_entity_type,
        relatedEntityId: item.related_entity_id,
      }),
      action_label: '依頼を確認',
    })),
    ...args.contactLogs.map((item) => ({
      source_type: 'contact_log' as const,
      title: `架電 ${item.outcome}`,
      summary: item.note ?? 'メモなし',
      occurred_at: (item.callback_due_at ?? item.called_at).toISOString(),
      counterpart: item.contact_name,
      severity: (item.outcome === 'unreachable' || item.outcome === 'attempted'
        ? 'high'
        : 'normal') as VisitBriefSeverity,
    })),
  ];

  return items.sort(sortCommunications).slice(0, 6);
}

function buildUnresolvedItems(args: {
  patientId: string;
  tasks: Array<{
    task_type: string;
    title: string;
    description: string | null;
    priority: string;
    related_entity_type: string | null;
    related_entity_id: string | null;
  }>;
  medicationIssues: Array<{
    id: string;
    title: string;
    description: string;
    priority: string;
    category: string | null;
  }>;
  inquiries: Array<{
    id: string;
    reason: string;
    inquiry_content: string;
    proposal_origin?: 'post_inquiry' | 'pre_issuance' | null;
    residual_adjustment?: boolean | null;
    change_detail?: string | null;
  }>;
  blockedBillingEvidence: Array<{
    blockers: Array<{
      reason: string;
    }>;
    validation_notes: string | null;
  }>;
}): VisitBriefUnresolvedItem[] {
  return [
    ...args.tasks.map((item) => {
      const presentation = describeOperationalTask(item);
      return {
        source_type: 'task' as const,
        title: item.title,
        summary: item.description ?? `優先度: ${item.priority}`,
        severity: severityFromPriority(item.priority),
        href: presentation.actionHref,
      };
    }),
    ...args.medicationIssues.map((item) => ({
      source_type: 'issue' as const,
      title: item.title,
      summary: `${item.description}${item.category ? ` / ${item.category}` : ''}`,
      severity: severityFromPriority(item.priority),
      href: buildPatientHref(args.patientId, '/safety-check'),
    })),
    ...args.inquiries.map((item) => ({
      source_type: 'inquiry' as const,
      title: `疑義照会 ${item.reason}`,
      summary:
        compactTimelineValues([
          getInquiryPrimaryDetail({
            inquiryContent: item.inquiry_content,
            changeDetail: item.change_detail,
          }),
          ...getInquiryPresentationBadges({
            proposalOrigin: item.proposal_origin,
            residualAdjustment: item.residual_adjustment,
          }),
        ]).join(' / ') || item.inquiry_content,
      severity: 'high' as const,
      href: buildCommunicationRequestsHref({
        patientId: args.patientId,
        relatedEntityType: 'inquiry_record',
        relatedEntityId: item.id,
      }),
    })),
    ...args.blockedBillingEvidence.map((item) => ({
      source_type: 'billing' as const,
      title: '算定を止めている理由',
      summary: item.blockers[0]?.reason ?? item.validation_notes ?? '算定条件の再確認が必要です。',
      severity: 'normal' as const,
      href: '/billing',
    })),
  ]
    .sort((left, right) => {
      const rank: Record<VisitBriefSeverity, number> = {
        urgent: 0,
        high: 1,
        normal: 2,
        low: 3,
      };
      return rank[left.severity] - rank[right.severity];
    })
    .slice(0, 6);
}

function buildMustCheckToday(args: {
  medicationChanges: VisitBriefMedicationChange[];
  dispensingItems: VisitBriefDispensingItem[];
  deliveryItems: VisitBriefDeliveryItem[];
  dosageFormSupport: VisitBriefDosageFormCandidate[];
  communicationItems: VisitBriefCommunicationItem[];
  jahisSupplementalRecords: VisitBriefJahisSupplementalRecord[];
  latestLabs: VisitBriefLatestLab[];
  unresolvedItems: VisitBriefUnresolvedItem[];
  previousVisitPlan: string | null;
}): string[] {
  const items = new Set<string>();

  if (args.medicationChanges.some((item) => item.change_type !== 'unchanged')) {
    items.add('直近の処方変更内容と残薬の整合');
  }
  if (args.medicationChanges.some((item) => item.change_type === 'removed')) {
    items.add('中止薬の残薬・継続服用有無');
  }
  if (args.dispensingItems.some((item) => item.dispensing_method === '一包化')) {
    items.add('一包化の運用と服薬タイミング');
  }
  if (args.dispensingItems.some((item) => item.dispensing_method === '粉砕')) {
    items.add('粉砕対象薬と服用可否');
  }
  for (const item of args.deliveryItems.slice(0, 1)) {
    items.add(item.title);
  }
  for (const item of args.dosageFormSupport.slice(0, 2)) {
    items.add(item.reason);
  }
  for (const item of args.communicationItems.slice(0, 2)) {
    items.add(item.title);
  }
  for (const record of args.jahisSupplementalRecords.slice(0, 3)) {
    const summary = record.summary ?? record.raw_line;
    if (record.record_type === '421') {
      items.add(`JAHIS残薬確認: ${summary}`);
      continue;
    }
    if (record.record_type === '4' || record.record_type === '601') {
      items.add(`${record.record_label}: ${summary}`);
      continue;
    }
    if (record.record_type === '701') {
      items.add('JAHISかかりつけ薬剤師情報の確認');
    }
  }
  for (const lab of args.latestLabs.filter((item) => item.abnormal).slice(0, 2)) {
    items.add(`検査値要確認: ${lab.analyte_label} ${lab.value_label}`);
  }
  const staleLab = args.latestLabs.find((item) => item.stale);
  if (staleLab) {
    items.add(`検査値測定日確認: ${staleLab.analyte_label} ${staleLab.measured_at_label}`);
  }
  for (const item of args.unresolvedItems.slice(0, 2)) {
    items.add(item.title);
  }
  if (args.previousVisitPlan) {
    items.add(args.previousVisitPlan);
  }

  return Array.from(items).slice(0, 6);
}

function buildFallbackHeadline(args: {
  medicationChanges: VisitBriefMedicationChange[];
  communicationItems: VisitBriefCommunicationItem[];
  unresolvedItems: VisitBriefUnresolvedItem[];
  dispensingItems: VisitBriefDispensingItem[];
  latestLabs: VisitBriefLatestLab[];
}) {
  const urgentCommunication = args.communicationItems.find((item) => item.severity === 'urgent');
  if (urgentCommunication) {
    return `${urgentCommunication.title} の確認が最優先です。`;
  }

  const highUnresolved = args.unresolvedItems.find(
    (item) => item.severity === 'urgent' || item.severity === 'high',
  );
  if (highUnresolved) {
    return `${highUnresolved.title} が未解決です。`;
  }

  if (args.medicationChanges.length > 0) {
    return `直近処方で ${args.medicationChanges.length} 件の変更があります。`;
  }

  if (args.dispensingItems.length > 0) {
    return '調剤方法と包装指示の確認が必要です。';
  }

  const abnormalLab = args.latestLabs.find((item) => item.abnormal);
  if (abnormalLab) {
    return `${abnormalLab.analyte_label} ${abnormalLab.value_label} の確認が必要です。`;
  }

  if (args.communicationItems.length > 0) {
    return '他職種・家族からの更新があります。';
  }

  return '処方・連携情報に大きな変化はありません。';
}

function buildRuleBullets(args: {
  medicationChanges: VisitBriefMedicationChange[];
  dispensingItems: VisitBriefDispensingItem[];
  communicationItems: VisitBriefCommunicationItem[];
  unresolvedItems: VisitBriefUnresolvedItem[];
  latestLabs: VisitBriefLatestLab[];
}) {
  const bullets: string[] = [];

  if (args.medicationChanges.length > 0) {
    const top = args.medicationChanges
      .slice(0, 2)
      .map((item) => `${formatMedicationChangeLabel(item)}: ${item.current}`)
      .join(' / ');
    bullets.push(`処方変更: ${top}`);
  }

  if (args.dispensingItems.length > 0) {
    bullets.push(`調剤方法: ${args.dispensingItems[0]?.note}`);
  }

  if (args.communicationItems.length > 0) {
    const item = args.communicationItems[0];
    bullets.push(`連携更新: ${item.title}${item.counterpart ? ` / ${item.counterpart}` : ''}`);
  }

  if (args.latestLabs.length > 0) {
    const top = args.latestLabs
      .slice(0, 3)
      .map((item) => `${item.analyte_label} ${item.value_label}`)
      .join(' / ');
    bullets.push(`最新検査値: ${top}`);
  }

  if (bullets.length === 0 && args.unresolvedItems.length > 0) {
    bullets.push(`未解決: ${args.unresolvedItems[0].title}`);
  }

  return bullets.slice(0, 3);
}

function formatMedicationChangeLabel(
  item: Pick<VisitBriefMedicationChange, 'drug_name' | 'drug_code'>,
) {
  return item.drug_code ? `${item.drug_name} [${item.drug_code}]` : item.drug_name;
}

function sourceRefs(args: {
  medicationChanges: VisitBriefMedicationChange[];
  dispensingItems: VisitBriefDispensingItem[];
  deliveryItems: VisitBriefDeliveryItem[];
  dosageFormSupport: VisitBriefDosageFormCandidate[];
  communicationItems: VisitBriefCommunicationItem[];
  jahisSupplementalRecords: VisitBriefJahisSupplementalRecord[];
  latestLabs: VisitBriefLatestLab[];
  unresolvedItems: VisitBriefUnresolvedItem[];
}) {
  const refs = new Set<string>();
  if (args.medicationChanges.length > 0) refs.add('処方履歴');
  if (args.dispensingItems.length > 0) refs.add('調剤方法・セット計画');
  if (args.deliveryItems.length > 0) refs.add('送達・共有ログ');
  if (args.dosageFormSupport.length > 0) refs.add('自己申告・薬学的課題');
  if (args.communicationItems.length > 0) refs.add('他職種/家族からの更新');
  if (args.jahisSupplementalRecords.length > 0) refs.add('JAHIS補足情報');
  if (args.latestLabs.length > 0) refs.add('最新検査値');
  if (args.unresolvedItems.length > 0) refs.add('未解決タスク・課題');
  return Array.from(refs);
}

function buildRuleSummary(args: {
  medicationChanges: VisitBriefMedicationChange[];
  dispensingItems: VisitBriefDispensingItem[];
  deliveryItems: VisitBriefDeliveryItem[];
  dosageFormSupport: VisitBriefDosageFormCandidate[];
  communicationItems: VisitBriefCommunicationItem[];
  jahisSupplementalRecords: VisitBriefJahisSupplementalRecord[];
  latestLabs: VisitBriefLatestLab[];
  unresolvedItems: VisitBriefUnresolvedItem[];
  mustCheckToday: string[];
}): VisitBriefRuleSummary {
  const generationId = globalThis.crypto?.randomUUID?.() ?? `rule_${Date.now()}`;
  return {
    generation_id: generationId,
    headline: buildFallbackHeadline(args),
    bullets: buildRuleBullets(args),
    must_check_today: args.mustCheckToday.slice(0, 4),
    source_refs: sourceRefs(args),
    generated_at: new Date().toISOString(),
  };
}

async function getVisitBriefAiOperationStats(db: DbClient, orgId: string) {
  const auditLogClient = (
    db as unknown as {
      auditLog?: {
        count?: (args: Record<string, unknown>) => Promise<number>;
      };
    }
  ).auditLog;
  if (!auditLogClient?.count) {
    return {
      successCount: 0,
      failureCount: 0,
    };
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [successCount, failureCount] = await Promise.all([
    auditLogClient.count({
      where: {
        org_id: orgId,
        action: 'visit_brief_generated_success',
        created_at: {
          gte: since,
        },
      },
    }),
    auditLogClient.count({
      where: {
        org_id: orgId,
        action: 'visit_brief_generated_fallback',
        created_at: {
          gte: since,
        },
      },
    }),
  ]);

  return {
    successCount,
    failureCount,
  };
}

async function buildAiSummary(args: {
  patientName: string;
  context: 'patient' | 'schedule';
  medicationChanges: VisitBriefMedicationChange[];
  dispensingItems: VisitBriefDispensingItem[];
  deliveryItems: VisitBriefDeliveryItem[];
  dosageFormSupport: VisitBriefDosageFormCandidate[];
  communicationItems: VisitBriefCommunicationItem[];
  jahisSupplementalRecords: VisitBriefJahisSupplementalRecord[];
  latestLabs: VisitBriefLatestLab[];
  unresolvedItems: VisitBriefUnresolvedItem[];
  mustCheckToday: string[];
}): Promise<VisitBriefAiSummary> {
  const fallbackHeadline = buildFallbackHeadline(args);
  const fallbackBullets = buildRuleBullets(args);
  const refs = sourceRefs(args);

  return generateVisitBriefAiSummary({
    patientName: args.patientName,
    context: args.context,
    medicationChanges: args.medicationChanges
      .slice(0, 5)
      .map(
        (item) => `${formatMedicationChangeLabel(item)} / ${item.change_type} / ${item.current}`,
      ),
    dispensing: args.dispensingItems.slice(0, 5).map((item) => item.note),
    multidisciplinary: [
      ...args.communicationItems.slice(0, 5).map((item) => `${item.title} / ${item.summary}`),
      ...args.jahisSupplementalRecords
        .slice(0, 3)
        .map((item) => `${item.record_label} / ${item.summary ?? item.raw_line}`),
    ],
    latestLabs: args.latestLabs
      .slice(0, 6)
      .map(
        (item) =>
          `${item.analyte_label} ${item.value_label} / ${item.measured_at_label}${
            item.abnormal_flag ? ` / 異常${item.abnormal_flag}` : ''
          }${item.stale ? ' / 測定日確認' : ''}`,
      ),
    unresolved: args.unresolvedItems.slice(0, 5).map((item) => `${item.title} / ${item.summary}`),
    mustCheckToday: args.mustCheckToday,
    fallbackHeadline,
    fallbackBullets,
    sourceRefs: refs,
  });
}

export async function getPatientVisitBrief(
  db: DbClient,
  args: BuildVisitBriefArgs,
): Promise<VisitBrief> {
  const patientCaseIds = (
    await db.careCase.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
      },
      // 現在側 snapshot は caseIds[0] で構築するため、先頭選択を決定的にする。
      // 複数ケースで前回訪問の case と食い違っても diff の caseComparable ガードが安全側にスキップする。
      orderBy: [{ created_at: 'desc' }],
      select: { id: true },
    })
  ).map((item) => item.id);
  const caseIds = args.caseIds ?? patientCaseIds;
  const caseScope =
    args.caseIds === undefined
      ? undefined
      : {
          OR: [{ case_id: null }, ...(caseIds.length > 0 ? [{ case_id: { in: caseIds } }] : [])],
        };
  const billingRefs = await listVisitBriefBillingRefs(db, args, caseIds);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [
    patient,
    latestIntakes,
    medicationProfiles,
    latestSetPlan,
    selfReports,
    communicationEvents,
    communicationRequests,
    contactLogs,
    tasks,
    medicationIssues,
    inquiries,
    blockedBillingEvidence,
    previousVisit,
    activeCase,
    recentConferenceNotes,
    facilityResidence,
    jahisSupplementalRows,
    latestLabRows,
    currentPatientSnapshot,
  ] = await Promise.all([
    db.patient.findFirst({
      where: {
        id: args.patientId,
        org_id: args.orgId,
      },
      select: {
        id: true,
        name: true,
        archived_at: true,
        scheduling_preference: {
          select: {
            visit_before_contact_required: true,
          },
        },
      },
    }),
    db.prescriptionIntake.findMany({
      where: {
        org_id: args.orgId,
        cycle: {
          patient_id: args.patientId,
          ...(args.caseIds === undefined ? {} : { case_id: { in: caseIds } }),
        },
      },
      orderBy: [{ prescribed_date: 'desc' }, { created_at: 'desc' }],
      take: 2,
      select: {
        prescribed_date: true,
        prescriber_name: true,
        lines: {
          orderBy: [{ line_number: 'asc' }],
          select: {
            drug_name: true,
            drug_master_id: true,
            drug_code: true,
            dosage_form: true,
            dose: true,
            frequency: true,
            route: true,
            dispensing_method: true,
            packaging_instructions: true,
            packaging_instruction_tags: true,
            notes: true,
            unit: true,
            start_date: true,
            end_date: true,
          },
        },
      },
    }),
    db.medicationProfile.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        is_current: true,
      },
      orderBy: [{ created_at: 'desc' }],
      take: args.limit ?? 12,
      select: {
        drug_name: true,
        dose: true,
        frequency: true,
        start_date: true,
        end_date: true,
        prescriber: true,
        source: true,
      },
    }),
    db.setPlan.findFirst({
      where: {
        org_id: args.orgId,
        cycle: {
          patient_id: args.patientId,
          ...(args.caseIds === undefined ? {} : { case_id: { in: caseIds } }),
        },
      },
      orderBy: [{ target_period_end: 'desc' }, { created_at: 'desc' }],
      select: {
        set_method: true,
        target_period_start: true,
        target_period_end: true,
        notes: true,
        audits: {
          orderBy: [{ audited_at: 'desc' }],
          take: 1,
          select: {
            result: true,
          },
        },
      },
    }),
    db.patientSelfReport.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        status: {
          in: [...OPEN_SELF_REPORT_STATUSES],
        },
      },
      orderBy: [{ created_at: 'desc' }],
      take: 4,
      select: {
        subject: true,
        category: true,
        content: true,
        status: true,
        reported_by_name: true,
        requested_callback: true,
        created_at: true,
      },
    }),
    db.communicationEvent.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        ...(caseScope ? { AND: [caseScope] } : {}),
      },
      orderBy: [{ occurred_at: 'desc' }],
      take: 4,
      select: {
        event_type: true,
        subject: true,
        content: true,
        counterpart_name: true,
        occurred_at: true,
        direction: true,
        channel: true,
      },
    }),
    db.communicationRequest.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        ...(caseScope ? { AND: [caseScope] } : {}),
        status: {
          in: [...OPEN_REQUEST_STATUSES],
        },
      },
      orderBy: [{ due_date: 'asc' }, { requested_at: 'desc' }],
      take: 4,
      select: {
        id: true,
        patient_id: true,
        request_type: true,
        subject: true,
        content: true,
        related_entity_type: true,
        related_entity_id: true,
        status: true,
        due_date: true,
        requested_at: true,
      },
    }),
    db.visitScheduleContactLog.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        ...(args.caseIds === undefined ? {} : { case_id: { in: caseIds } }),
      },
      orderBy: [{ called_at: 'desc' }],
      take: 3,
      select: {
        outcome: true,
        contact_name: true,
        note: true,
        callback_due_at: true,
        called_at: true,
      },
    }),
    db.task.findMany({
      where: {
        org_id: args.orgId,
        status: {
          in: [...OPEN_TASK_STATUSES],
        },
        OR: [
          {
            related_entity_type: 'patient',
            related_entity_id: args.patientId,
          },
          ...(caseIds.length > 0
            ? [
                {
                  related_entity_type: 'case' as const,
                  related_entity_id: {
                    in: caseIds,
                  },
                },
              ]
            : []),
        ],
      },
      orderBy: [{ sla_due_at: 'asc' }, { due_date: 'asc' }, { created_at: 'asc' }],
      take: 4,
      select: {
        task_type: true,
        title: true,
        description: true,
        priority: true,
        related_entity_type: true,
        related_entity_id: true,
      },
    }),
    db.medicationIssue.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        ...(caseScope ? { AND: [caseScope] } : {}),
        status: {
          in: [...OPEN_ISSUE_STATUSES],
        },
      },
      orderBy: [{ priority: 'desc' }, { identified_at: 'desc' }],
      take: 3,
      select: {
        id: true,
        title: true,
        description: true,
        priority: true,
        category: true,
      },
    }),
    db.inquiryRecord.findMany({
      where: {
        org_id: args.orgId,
        cycle: {
          patient_id: args.patientId,
          ...(args.caseIds === undefined ? {} : { case_id: { in: caseIds } }),
        },
        resolved_at: null,
      },
      orderBy: [{ inquired_at: 'desc' }],
      take: 2,
      select: {
        id: true,
        reason: true,
        inquiry_content: true,
        proposal_origin: true,
        residual_adjustment: true,
        change_detail: true,
      },
    }),
    listBillingEvidenceBlockers(db, {
      orgId: args.orgId,
      patientId: args.patientId,
      visitRecordIds: billingRefs.visitRecordIds,
      cycleIds: billingRefs.cycleIds,
      limit: 2,
    }),
    db.visitRecord.findFirst({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        ...(args.currentScheduleId ? { schedule_id: { not: args.currentScheduleId } } : {}),
        ...(args.scheduledDate ? { visit_date: { lt: args.scheduledDate } } : {}),
        ...(args.caseIds === undefined
          ? {}
          : {
              schedule: {
                case_id: { in: caseIds },
              },
            }),
      },
      orderBy: [{ visit_date: 'desc' }, { created_at: 'desc' }],
      select: {
        soap_plan: true,
        patient_state_snapshot: true,
      },
    }),
    typeof db.careCase.findFirst === 'function'
      ? db.careCase.findFirst({
          where: {
            org_id: args.orgId,
            patient_id: args.patientId,
            ...(args.caseIds === undefined ? {} : { id: { in: caseIds } }),
            status: { in: ['active', 'assessment'] },
          },
          orderBy: [{ start_date: 'desc' }, { created_at: 'desc' }],
          select: {
            required_visit_support: true,
          },
        })
      : db.careCase
          .findMany({
            where: {
              org_id: args.orgId,
              patient_id: args.patientId,
              ...(args.caseIds === undefined ? {} : { id: { in: caseIds } }),
              status: { in: ['active', 'assessment'] },
            },
            orderBy: [{ start_date: 'desc' }, { created_at: 'desc' }],
            take: 1,
            select: {
              required_visit_support: true,
            },
          })
          .then((cases) => cases[0] ?? null),
    caseIds.length === 0 || typeof db.conferenceNote?.findMany !== 'function'
      ? Promise.resolve([])
      : db.conferenceNote.findMany({
          where: {
            org_id: args.orgId,
            case_id: { in: caseIds },
            conference_date: { gte: thirtyDaysAgo },
          },
          orderBy: [{ conference_date: 'desc' }],
          take: 10,
          select: {
            id: true,
            title: true,
            conference_date: true,
            action_items: true,
            metadata: true,
          },
        }),
    typeof db.residence?.findFirst === 'function'
      ? db.residence.findFirst({
          where: {
            org_id: args.orgId,
            patient_id: args.patientId,
            is_primary: true,
            facility_id: { not: null },
          },
          select: {
            facility: {
              select: {
                acceptance_time_from: true,
                acceptance_time_to: true,
                notes: true,
              },
            },
          },
        })
      : Promise.resolve(null),
    listJahisSupplementalRecordsForBrief(db, {
      orgId: args.orgId,
      patientId: args.patientId,
    }),
    listLatestLabsForVisitBrief(db, {
      orgId: args.orgId,
      patientId: args.patientId,
    }),
    // patient_changes 用の現在側スナップショット。context==='patient' かつ role/userId が揃う経路のみ。
    // schedule バッチ(role/userId 未指定)は null=差分なしで perf 退行を避ける。snapshot 構築は
    // 既存 Promise.all に同居させ直列レイテンシ増を避ける。
    args.context === 'patient' && args.role && args.userId && caseIds.length > 0
      ? buildPatientStateSnapshot(db as Parameters<typeof buildPatientStateSnapshot>[0], {
          orgId: args.orgId,
          patientId: args.patientId,
          role: args.role,
          userId: args.userId,
          caseId: caseIds[0],
          source: 'visit_brief_current',
        })
      : Promise.resolve(null),
  ]);

  if (!patient) {
    throw new Error(`VISIT_BRIEF_PATIENT_NOT_FOUND:${args.patientId}`);
  }

  // Build conference summary from recent notes
  const conferenceSummary = ((): VisitBriefConferenceSummary | null => {
    if (recentConferenceNotes.length === 0) return null;
    let pendingActionItems = 0;
    for (const note of recentConferenceNotes) {
      const items = note.action_items as Array<{ converted_task_id?: string }> | null;
      if (Array.isArray(items)) {
        for (const item of items) {
          if (!item.converted_task_id) pendingActionItems += 1;
        }
      }
    }
    const latest = recentConferenceNotes[0];
    const visitBriefMetadata = readJsonObject(readJsonObject(latest?.metadata)?.visit_brief);
    const highlightedRisks = Array.isArray(visitBriefMetadata?.highlighted_risks)
      ? visitBriefMetadata.highlighted_risks.filter(
          (item): item is string => typeof item === 'string' && item.length > 0,
        )
      : [];

    return {
      recent_conferences: recentConferenceNotes.length,
      pending_action_items: pendingActionItems,
      last_conference_date: latest ? latest.conference_date.toISOString() : null,
      last_conference_type: latest ? latest.title : null,
      summary:
        visitBriefMetadata && typeof visitBriefMetadata.summary === 'string'
          ? visitBriefMetadata.summary
          : null,
      highlighted_risks: highlightedRisks,
    };
  })();

  const intakeData = getHomeVisitIntake(activeCase?.required_visit_support ?? null);
  const visitBeforeContactRequired =
    patient.scheduling_preference?.visit_before_contact_required ?? null;
  const baselineContext = buildBaselineContext(intakeData, visitBeforeContactRequired);

  const communicationQueue = await listCommunicationQueue(db, {
    orgId: args.orgId,
    patientId: args.patientId,
    caseIds: args.caseIds,
    limit: 6,
  });

  const currentIntake = latestIntakes[0] ?? null;
  const previousIntake = latestIntakes[1] ?? null;
  const currentLines = currentIntake?.lines ?? [];
  const previousLines = previousIntake?.lines ?? [];

  const medicationChanges = currentIntake
    ? detectPharmacyVisitBriefMedicationChanges(
        currentLines,
        previousLines,
        currentIntake.prescribed_date.toISOString(),
        currentIntake.prescriber_name,
      )
    : [];

  // Enrich with DrugMaster data for price/generic/narcotic display
  const drugCodes = currentLines.map((l) => l.drug_code).filter((c): c is string => c !== null);

  const drugMasters =
    drugCodes.length > 0 && db.drugMaster
      ? await db.drugMaster.findMany({
          where: { yj_code: { in: drugCodes } },
          select: {
            yj_code: true,
            drug_price: true,
            is_generic: true,
            is_narcotic: true,
            is_psychotropic: true,
            therapeutic_category: true,
          },
        })
      : [];

  const drugMasterMap = new Map(drugMasters.map((dm) => [dm.yj_code, dm]));

  const medications = buildMedicationItems({
    currentLines,
    medicationProfiles,
    prescriberName: currentIntake?.prescriber_name ?? null,
    drugMasterMap,
  }).slice(0, args.limit ?? 12);

  // Build drug cautions from package inserts for visit preparation
  const drugCautions = await buildDrugCautions(db, drugCodes);
  const dispensingItems = buildPharmacyVisitBriefDispensingItems({
    currentLines,
    latestSetPlan,
  });
  const deliveryItems = buildDeliveryItems(communicationQueue.timeline);
  const dosageFormSupport = buildDosageFormSupport({
    currentLines,
    selfReports,
    medicationIssues,
  });
  const communicationItems = buildCommunicationItems({
    selfReports,
    communicationEvents,
    communicationRequests,
    contactLogs,
  });
  const jahisSupplementalRecords =
    normalizePharmacyJahisSupplementalRecordsForVisitBrief(jahisSupplementalRows);
  const latestLabs = buildVisitBriefLatestLabs(latestLabRows, new Date());
  const unresolvedInquiries = inquiries.map((item) => ({
    ...item,
    proposal_origin: (item.proposal_origin === 'pre_issuance' ? 'pre_issuance' : 'post_inquiry') as
      | 'post_inquiry'
      | 'pre_issuance',
  }));
  const unresolvedItems = buildUnresolvedItems({
    patientId: args.patientId,
    tasks,
    medicationIssues,
    inquiries: unresolvedInquiries,
    blockedBillingEvidence,
  });
  const mustCheckToday = buildMustCheckToday({
    medicationChanges,
    dispensingItems,
    deliveryItems,
    dosageFormSupport,
    communicationItems,
    jahisSupplementalRecords,
    latestLabs,
    unresolvedItems,
    previousVisitPlan: previousVisit?.soap_plan ?? null,
  });
  const ruleSummary = buildRuleSummary({
    medicationChanges,
    dispensingItems,
    deliveryItems,
    dosageFormSupport,
    communicationItems,
    jahisSupplementalRecords,
    latestLabs,
    unresolvedItems,
    mustCheckToday,
  });
  const aiSummary = await buildAiSummary({
    patientName: patient.name,
    context: args.context,
    medicationChanges,
    dispensingItems,
    deliveryItems,
    dosageFormSupport,
    communicationItems,
    jahisSupplementalRecords,
    latestLabs,
    unresolvedItems,
    mustCheckToday,
  });
  const recentOperationStats = await getVisitBriefAiOperationStats(db, args.orgId);
  const recentGenerationCount =
    recentOperationStats.successCount + recentOperationStats.failureCount + 1;
  const recentFailureCount = recentOperationStats.failureCount + (aiSummary.is_fallback ? 1 : 0);
  const hydratedAiSummary: VisitBriefAiSummary = {
    ...aiSummary,
    recent_generation_count_24h: recentGenerationCount,
    recent_failure_count_24h: recentFailureCount,
    recent_failure_rate_24h:
      recentGenerationCount > 0
        ? Math.round((recentFailureCount / recentGenerationCount) * 1000) / 10
        : null,
  };

  const auditLogClient = (
    db as unknown as {
      auditLog?: {
        create?: (args: Record<string, unknown>) => Promise<unknown>;
      };
    }
  ).auditLog;
  if (auditLogClient?.create) {
    await auditLogClient.create({
      data: {
        org_id: args.orgId,
        actor_id: args.actorId ?? 'system_visit_brief',
        action: aiSummary.is_fallback
          ? 'visit_brief_generated_fallback'
          : 'visit_brief_generated_success',
        target_type: 'visit_brief',
        target_id: aiSummary.generation_id,
        changes:
          normalizeJsonInput({
            patient_id: args.patientId,
            context: args.context,
            provider: aiSummary.provider,
            requested_provider: aiSummary.requested_provider,
            model: aiSummary.model,
            fallback_reason: aiSummary.fallback_reason,
            source_refs: aiSummary.source_refs,
            duration_ms: aiSummary.duration_ms,
            generated_at: aiSummary.generated_at,
          }) ?? {},
      },
    });
  }

  return {
    patient: {
      id: patient.id,
      name: patient.name,
      archive: buildPatientArchiveSummary(patient.archived_at ?? null),
    },
    context: args.context,
    generated_at: new Date().toISOString(),
    last_prescribed_date: currentIntake?.prescribed_date.toISOString() ?? null,
    baseline_context: baselineContext,
    medication_changes: medicationChanges.slice(0, 8),
    patient_changes:
      currentPatientSnapshot && previousVisit?.patient_state_snapshot
        ? diffPatientStateSnapshots(previousVisit.patient_state_snapshot, currentPatientSnapshot)
        : [],
    medications,
    dispensing_items: dispensingItems,
    delivery_status: deliveryItems,
    dosage_form_support: dosageFormSupport,
    multidisciplinary_updates: communicationItems,
    jahis_supplemental_records: jahisSupplementalRecords,
    latest_labs: latestLabs,
    unresolved_items: unresolvedItems,
    must_check_today: mustCheckToday,
    rule_summary: ruleSummary,
    ai_summary: hydratedAiSummary,
    conference_summary: conferenceSummary,
    facility_context: ((): VisitBriefFacilityContext | null => {
      const f = facilityResidence?.facility;
      if (!f) return null;
      return {
        acceptance_time_from: timeToHHMM(f.acceptance_time_from),
        acceptance_time_to: timeToHHMM(f.acceptance_time_to),
        notes: f.notes ?? null,
      };
    })(),
    drug_cautions: drugCautions,
  };
}

export async function getScheduleVisitBrief(
  db: DbClient,
  args: Omit<BuildVisitBriefArgs, 'context'>,
): Promise<VisitBrief> {
  return getPatientVisitBrief(db, {
    ...args,
    context: 'schedule',
  });
}

function getVisitBriefBatchConcurrency() {
  return normalizeConcurrencyLimit(process.env.VISIT_BRIEF_BATCH_CONCURRENCY, {
    defaultValue: 4,
    max: 8,
  });
}

export async function getScheduleVisitBriefsForPatients(
  db: DbClient,
  args: Omit<BuildVisitBriefArgs, 'context' | 'patientId'> & { patientIds: string[] },
): Promise<Map<string, VisitBrief>> {
  const { patientIds, ...briefArgs } = args;
  const uniquePatientIds = Array.from(new Set(patientIds.filter(Boolean)));
  const entries = await mapWithConcurrency(
    uniquePatientIds,
    getVisitBriefBatchConcurrency(),
    async (patientId) => {
      const brief = await getScheduleVisitBrief(db, {
        ...briefArgs,
        patientId,
      });
      return [patientId, brief] as const;
    },
  );

  return new Map(entries);
}

export async function getScheduleVisitBriefsForSchedules(
  db: DbClient,
  args: { schedules: ScheduleBriefRequest[] },
): Promise<Map<string, VisitBrief>> {
  const requestByKey = new Map<string, ScheduleBriefRequest>();
  const keyByScheduleId = new Map<string, string>();
  for (const schedule of args.schedules) {
    const key = JSON.stringify([
      schedule.orgId,
      schedule.patientId,
      schedule.caseId,
      schedule.scheduleId,
      schedule.scheduledDate?.toISOString() ?? null,
      schedule.limit ?? null,
      schedule.actorId ?? null,
    ]);
    keyByScheduleId.set(schedule.scheduleId, key);
    if (!requestByKey.has(key)) {
      requestByKey.set(key, schedule);
    }
  }

  const briefEntries = await mapWithConcurrency(
    [...requestByKey.entries()],
    getVisitBriefBatchConcurrency(),
    async ([key, schedule]) => {
      const brief = await getScheduleVisitBrief(db, {
        orgId: schedule.orgId,
        patientId: schedule.patientId,
        caseIds: [schedule.caseId],
        currentScheduleId: schedule.scheduleId,
        scheduledDate: schedule.scheduledDate,
        limit: schedule.limit,
        actorId: schedule.actorId,
      });
      return [key, brief] as const;
    },
  );

  const briefByKey = new Map(briefEntries);
  return new Map(
    args.schedules.flatMap((schedule) => {
      const key = keyByScheduleId.get(schedule.scheduleId);
      const brief = key ? briefByKey.get(key) : undefined;
      return brief ? ([[schedule.scheduleId, brief]] as const) : [];
    }),
  );
}
