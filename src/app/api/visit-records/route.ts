import { addDays, differenceInCalendarDays } from 'date-fns';
import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { requireAuthContext, type AuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import {
  conflict,
  forbiddenResponse,
  internalError,
  success,
  validationError,
} from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { buildCursorPage, parsePaginationParams } from '@/lib/api/pagination';
import { decodeKeysetCursor, encodeKeysetCursor } from '@/lib/api/keyset-cursor';
import { formatDateKey } from '@/lib/date-key';
import { allocateDisplayId } from '@/lib/db/display-id';
import { isValidDateKey } from '@/lib/validations/date-key';
import {
  createVisitRecordSchema,
  type CreateVisitRecordInput,
} from '@/lib/validations/visit-record';
import { prisma } from '@/lib/db/client';
import { normalizeJsonInput, readJsonObject } from '@/lib/db/json';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { getRequestAuthContext, runWithRequestAuthContext } from '@/lib/auth/request-context';
import {
  buildVisitRecordScheduleAssignmentWhere,
  canAccessVisitScheduleAssignment,
} from '@/lib/auth/visit-schedule-access';
import { buildAllSoapTexts } from '@/lib/utils/soap-text-builder';
import { transitionCycleStatus } from '@/lib/db/cycle-transition';
import { getNextSimpleRruleOccurrence } from '@/lib/visits/rrule';
import { ACTIVE_VISIT_SCHEDULE_STATUSES } from '@/lib/constants/visit';
import { buildVisitRecordPdfHref } from '@/lib/visits/navigation';
import {
  getMissingHomeVisit2026CompletionItems,
  isHomeVisit2026CompletionOutcome,
} from '@/lib/visits/home-visit-2026-evidence';
import type { StructuredSoap } from '@/types/structured-soap';
import type { VisitRecordConflictServerSnapshot } from '@/types/visit-record-conflict';
import { Prisma, type ScheduleStatus } from '@prisma/client';
import {
  listBillingEvidenceBlockers,
  upsertBillingEvidenceForVisit,
} from '@/server/services/billing-evidence';
import {
  normalizeStructuredSoapForVisitRecordSave,
  processHandoffExtraction,
} from '@/server/services/visit-handoff';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import { buildPatientStateSnapshot } from '@/server/services/patient-state-snapshot';
import { getHomeVisitIntake } from '@/lib/patient/home-visit-intake';
import type { ExceptionSeverity, ExceptionStatus } from '@/types/domain-literals';
import {
  findMissingResidualMedicationDrugMasterIds,
  replaceVisitRecordResidualMedications,
  syncVisitRecordLabObservations,
} from '@/server/services/visit-record-derived-data';
import { validatePreviousVisitReuseSource } from '@/server/services/visit-record-source-validation';
import { z } from 'zod';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';

const ROUTE = '/api/visit-records';

const scheduleStatusByOutcome: Record<
  CreateVisitRecordInput['outcome_status'],
  'completed' | 'postponed' | 'cancelled'
> = {
  completed: 'completed',
  revisit_needed: 'completed',
  postponed: 'postponed',
  cancelled: 'cancelled',
  delivery_only: 'completed',
  completed_with_issue: 'completed',
};

const cycleCompletionOutcomes = new Set<CreateVisitRecordInput['outcome_status']>([
  'completed',
  'completed_with_issue',
  'revisit_needed',
]);

const firstVisitDocumentOutcomes = new Set<CreateVisitRecordInput['outcome_status']>([
  'completed',
  'completed_with_issue',
  'revisit_needed',
  'delivery_only',
]);

const VISIT_RECORD_ACTIVE_SOURCE_SCHEDULE_STATUS_SET = new Set<ScheduleStatus>(
  ACTIVE_VISIT_SCHEDULE_STATUSES,
);

type VisitRecordSaveRollbackResult = {
  error: 'schedule_status_conflict';
  scheduleStatus?: ScheduleStatus;
};

class VisitRecordSaveRollback extends Error {
  constructor(readonly result: VisitRecordSaveRollbackResult) {
    super('visit record transaction rolled back');
    this.name = 'VisitRecordSaveRollback';
  }
}

function canSaveVisitRecordForScheduleStatus(args: {
  sourceStatus: ScheduleStatus;
  targetStatus: ScheduleStatus;
  isOverwrite: boolean;
}) {
  if (VISIT_RECORD_ACTIVE_SOURCE_SCHEDULE_STATUS_SET.has(args.sourceStatus)) {
    return true;
  }

  return args.isOverwrite && args.sourceStatus === args.targetStatus;
}

const visitRecordListQuerySchema = z
  .object({
    patient_id: strictIdQueryParam('患者IDを指定してください', '患者IDの形式が不正です').optional(),
    pharmacist_id: strictIdQueryParam(
      '薬剤師IDを指定してください',
      '薬剤師IDの形式が不正です',
    ).optional(),
    date_from: strictDateKeyQueryParam().optional(),
    date_to: strictDateKeyQueryParam().optional(),
    include_history_summary: strictBooleanQueryParam(
      'include_history_summary は true または false で指定してください',
    ).optional(),
    include_attachments: strictBooleanQueryParam(
      'include_attachments は true または false で指定してください',
    ).optional(),
    view: strictViewQueryParam().optional(),
  })
  .refine((value) => !value.date_from || !value.date_to || value.date_to >= value.date_from, {
    path: ['date_to'],
    message: 'date_to は date_from 以降を指定してください',
  })
  .refine((value) => value.view !== 'evidence_gallery' || value.include_attachments === true, {
    path: ['view'],
    message: 'view=evidence_gallery は include_attachments=true と一緒に指定してください',
  });

function strictIdQueryParam(blankMessage: string, formatMessage: string) {
  return z.string().superRefine((value, ctx) => {
    if (value.trim().length === 0) {
      ctx.addIssue({ code: 'custom', message: blankMessage });
      return;
    }

    if (value !== value.trim() || value.length > 100) {
      ctx.addIssue({ code: 'custom', message: formatMessage });
    }
  });
}

function strictDateKeyQueryParam() {
  return z.string().superRefine((value, ctx) => {
    if (value.trim().length === 0 || value !== value.trim() || !isValidDateKey(value)) {
      ctx.addIssue({ code: 'custom', message: '日付形式が不正です（YYYY-MM-DD）' });
    }
  });
}

function strictBooleanQueryParam(message: string) {
  return z.string().transform((value, ctx) => {
    if (value !== 'true' && value !== 'false') {
      ctx.addIssue({ code: 'custom', message });
      return z.NEVER;
    }

    return value === 'true';
  });
}

function strictViewQueryParam() {
  return z.string().superRefine((value, ctx) => {
    if (value !== 'evidence_gallery') {
      ctx.addIssue({ code: 'custom', message: 'view は evidence_gallery を指定してください' });
    }
  });
}

function readVisitRecordListQueryValues(searchParams: URLSearchParams) {
  const values: Record<string, string | undefined> = {};
  const fieldErrors: Record<string, string[]> = {};

  for (const name of [
    'patient_id',
    'pharmacist_id',
    'date_from',
    'date_to',
    'include_history_summary',
    'include_attachments',
    'view',
  ] as const) {
    const allValues = searchParams.getAll(name);
    if (allValues.length === 0) continue;
    if (allValues.length > 1) {
      fieldErrors[name] = [`${name} は1つだけ指定してください`];
      continue;
    }
    values[name] = allValues[0];
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false as const,
      response: withSensitiveNoStore(validationError('検索条件が不正です', fieldErrors)),
    };
  }

  return { ok: true as const, values };
}

function parseVisitRecordListQuery(searchParams: URLSearchParams) {
  const queryValues = readVisitRecordListQueryValues(searchParams);
  if (!queryValues.ok) return queryValues;

  const parsed = visitRecordListQuerySchema.safeParse(queryValues.values);

  if (!parsed.success) {
    return {
      ok: false as const,
      response: withSensitiveNoStore(
        validationError('検索条件が不正です', parsed.error.flatten().fieldErrors),
      ),
    };
  }

  return { ok: true as const, data: parsed.data };
}

function safeHandoffExtractionWarningContext(visitRecordId: string) {
  return {
    event: 'visit_records_handoff_extraction_failed',
    route: ROUTE,
    operation: 'process_handoff_extraction',
    targetId: visitRecordId,
  };
}

const FIRST_VISIT_DOCUMENT_TEMPLATE_TYPES = [
  'contract_document',
  'important_matters',
  'privacy_consent',
  'consent_form',
] as const;

const FIRST_VISIT_DOCUMENT_TYPE_BY_TEMPLATE: Record<
  (typeof FIRST_VISIT_DOCUMENT_TEMPLATE_TYPES)[number],
  'contract' | 'important_matters' | 'privacy_consent' | 'consent'
> = {
  contract_document: 'contract',
  important_matters: 'important_matters',
  privacy_consent: 'privacy_consent',
  consent_form: 'consent',
};

type VisitRecordHandoffExtractionPayload = {
  patientId: string;
  patientName: string;
  structuredSoap: StructuredSoap;
  soapAssessment: string | null;
  soapPlan: string | null;
  expectedVersion: number;
};

function isInputJsonObject(
  value: Prisma.InputJsonValue | null | undefined,
): value is Prisma.InputJsonObject {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !('toJSON' in value)
  );
}

function normalizeOptionalJsonInput(value: unknown): Prisma.InputJsonValue | undefined {
  const normalized = normalizeJsonInput(value);
  return normalized === null || normalized === undefined ? undefined : normalized;
}

function normalizeInputJsonObject(value: unknown): Prisma.InputJsonObject {
  const normalized = normalizeJsonInput(value);
  return isInputJsonObject(normalized) ? normalized : {};
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function loadExistingVisitRecordConflict(
  tx: Prisma.TransactionClient,
  orgId: string,
  scheduleId: string,
): Promise<VisitRecordConflictServerSnapshot | null> {
  const existing = await tx.visitRecord.findFirst({
    where: {
      org_id: orgId,
      schedule_id: scheduleId,
    },
    select: {
      id: true,
      version: true,
      patient_id: true,
      visit_date: true,
      outcome_status: true,
      soap_subjective: true,
      soap_objective: true,
      soap_assessment: true,
      soap_plan: true,
      next_visit_suggestion_date: true,
    },
  });

  if (!existing) return null;

  const residualMedications = await tx.residualMedication.findMany({
    where: {
      org_id: orgId,
      visit_record_id: existing.id,
    },
    select: {
      drug_master_id: true,
      drug_name: true,
      drug_code: true,
      prescribed_quantity: true,
      remaining_quantity: true,
      is_prohibited_reduction: true,
    },
  });

  return {
    id: existing.id,
    version: existing.version,
    patient_id: existing.patient_id,
    visit_date: formatDateKey(existing.visit_date),
    outcome_status: existing.outcome_status,
    soap_subjective: existing.soap_subjective,
    soap_objective: existing.soap_objective,
    soap_assessment: existing.soap_assessment,
    soap_plan: existing.soap_plan,
    next_visit_suggestion_date: existing.next_visit_suggestion_date?.toISOString() ?? null,
    residual_medications: residualMedications.map((item) => ({
      ...item,
      prescribed_quantity: item.prescribed_quantity ?? null,
      prescribed_daily_dose: null,
    })),
  };
}

type ResidualReductionCandidate = {
  drug_master_id?: string;
  drug_name: string;
  drug_code?: string;
  remaining_quantity: number;
  prescribed_daily_dose: number;
  excess_days: number;
  is_prohibited_reduction: boolean;
};

function normalizeDrugIdentityCode(code: string | null | undefined) {
  return code?.replace(/\s/g, '').trim() || null;
}

function residualReductionDrugLabel(
  candidate: Pick<ResidualReductionCandidate, 'drug_name' | 'drug_code'>,
) {
  const drugCode = normalizeDrugIdentityCode(candidate.drug_code);
  return drugCode ? `${candidate.drug_name}（${drugCode}）` : candidate.drug_name;
}

function residualReductionIdentityKey(
  candidate: Pick<ResidualReductionCandidate, 'drug_master_id' | 'drug_name' | 'drug_code'>,
) {
  const drugMasterId = candidate.drug_master_id?.trim();
  if (drugMasterId) return `master:${drugMasterId}`;
  const drugCode = normalizeDrugIdentityCode(candidate.drug_code);
  return drugCode ? `code:${drugCode}` : `name:${candidate.drug_name.trim()}`;
}

function residualReductionIssueTitleWhere(
  candidate: Pick<ResidualReductionCandidate, 'drug_name' | 'drug_code'>,
): Prisma.MedicationIssueWhereInput {
  const exactTitle = `${residualReductionDrugLabel(candidate)} の残薬調整`;
  const drugCode = normalizeDrugIdentityCode(candidate.drug_code);
  if (!drugCode) return { title: exactTitle };

  return {
    OR: [{ title: exactTitle }, { title: { contains: `（${drugCode}） の残薬調整` } }],
  };
}

function collectResidualReductionCandidates(
  residualMedications: CreateVisitRecordInput['residual_medications'],
): ResidualReductionCandidate[] {
  const candidates: ResidualReductionCandidate[] = [];

  for (const medication of residualMedications ?? []) {
    const prescribedDailyDose = medication.prescribed_daily_dose ?? 0;
    if (prescribedDailyDose <= 0 || medication.remaining_quantity <= 0) continue;

    const excessDays = Math.floor(medication.remaining_quantity / prescribedDailyDose);
    if (excessDays <= 7) continue;

    candidates.push({
      drug_name: medication.drug_name,
      drug_master_id: medication.drug_master_id ?? undefined,
      drug_code: medication.drug_code ?? undefined,
      remaining_quantity: medication.remaining_quantity,
      prescribed_daily_dose: prescribedDailyDose,
      excess_days: excessDays,
      is_prohibited_reduction: medication.is_prohibited_reduction,
    });
  }

  return candidates;
}

async function upsertFirstVisitDocument(args: {
  tx: Prisma.TransactionClient;
  ctx: AuthContext;
  orgId: string;
  patientId: string;
  caseId: string;
  recordId: string;
  receiptAt?: string;
  receiptPersonName?: string;
}) {
  const contacts = await args.tx.contactParty.findMany({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      OR: [{ is_emergency_contact: true }, { relation: 'facility_staff' }],
    },
    orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
    select: {
      id: true,
      name: true,
      relation: true,
      phone: true,
      email: true,
      fax: true,
      organization_name: true,
      department: true,
      is_primary: true,
      is_emergency_contact: true,
    },
  });

  const emergencyContacts = contacts.map((contact) => ({
    id: contact.id,
    name: contact.name,
    relation: contact.relation,
    phone: contact.phone,
    email: contact.email,
    fax: contact.fax,
    organization_name: contact.organization_name,
    department: contact.department,
    is_primary: contact.is_primary,
    is_emergency_contact: contact.is_emergency_contact,
  })) satisfies Prisma.InputJsonValue;

  const existing = await args.tx.firstVisitDocument.findFirst({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      case_id: args.caseId,
    },
    select: {
      id: true,
      document_url: true,
      delivered_at: true,
      delivered_to: true,
    },
  });

  const documentUrl = existing?.document_url ?? buildVisitRecordPdfHref(args.recordId);
  const deliveredAt = args.receiptAt ? new Date(args.receiptAt) : (existing?.delivered_at ?? null);
  const deliveredTo = args.receiptPersonName?.trim() || existing?.delivered_to || null;

  if (existing) {
    await args.tx.firstVisitDocument.update({
      where: { id: existing.id },
      data: {
        emergency_contacts: emergencyContacts,
        document_url: documentUrl,
        delivered_at: deliveredAt,
        delivered_to: deliveredTo,
      },
    });
    return;
  }

  const template = await args.tx.template.findFirst({
    where: {
      org_id: args.orgId,
      template_type: { in: [...FIRST_VISIT_DOCUMENT_TEMPLATE_TYPES] },
      is_default: true,
      OR: [{ effective_from: null }, { effective_from: { lte: new Date() } }],
      AND: [{ OR: [{ effective_to: null }, { effective_to: { gte: new Date() } }] }],
    },
    orderBy: [{ template_type: 'asc' }, { version: 'desc' }, { updated_at: 'desc' }],
    select: {
      id: true,
      name: true,
      template_type: true,
      version: true,
    },
  });

  const created = await args.tx.firstVisitDocument.create({
    data: {
      org_id: args.orgId,
      patient_id: args.patientId,
      case_id: args.caseId,
      emergency_contacts: emergencyContacts,
      document_url: documentUrl,
      delivered_at: deliveredAt,
      delivered_to: deliveredTo,
    },
  });

  await createAuditLogEntry(args.tx, args.ctx, {
    action: 'first_visit_document.generated',
    targetType: 'first_visit_document',
    targetId: created.id,
    changes: {
      document_action: {
        action: 'generated',
        document_type: template
          ? FIRST_VISIT_DOCUMENT_TYPE_BY_TEMPLATE[
              template.template_type as (typeof FIRST_VISIT_DOCUMENT_TEMPLATE_TYPES)[number]
            ]
          : 'first_visit_document',
        template_id: template?.id ?? null,
        template_name: template?.name ?? null,
        template_version: template ? String(template.version) : null,
        source: 'initial_visit_record',
      },
      patient_id: args.patientId,
      case_id: args.caseId,
      visit_record_id: args.recordId,
      delivered_at: deliveredAt?.toISOString() ?? null,
      delivered_to: deliveredTo,
      document_url: documentUrl,
    },
  });
}

function getNextVisitSuggestionDate(args: {
  explicitSuggestion: string | undefined;
  recurrenceRule: string | null;
  recurrenceAnchorDate?: Date | null;
  visitRecordedAt: Date;
  medicationEndDate: Date | null;
  visitDeadlineDate: Date | null;
}) {
  if (args.explicitSuggestion) {
    return new Date(args.explicitSuggestion);
  }

  if (!args.recurrenceRule) {
    return null;
  }

  const cutoffCandidates = [args.medicationEndDate, args.visitDeadlineDate].filter(
    (value): value is Date => value instanceof Date,
  );
  const cutoff =
    cutoffCandidates.length > 0
      ? new Date(Math.min(...cutoffCandidates.map((value) => value.getTime())))
      : addDays(args.visitRecordedAt, 90);

  return getNextSimpleRruleOccurrence(args.recurrenceRule, args.visitRecordedAt, cutoff, {
    seriesAnchorDate: args.recurrenceAnchorDate ?? args.visitRecordedAt,
  });
}

type VisitRecordListItem = {
  id: string;
  patient_id: string;
};

function collectVisitRecordListItems(records: readonly { id: string }[]) {
  return records.flatMap((record) => {
    if (!('patient_id' in record) || typeof record.patient_id !== 'string') {
      return [];
    }

    return [
      {
        id: record.id,
        patient_id: record.patient_id,
      } satisfies VisitRecordListItem,
    ];
  });
}

function parseStoredVisitRecordAttachmentSummaries(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    const record = readJsonObject(entry);
    if (!record) return [];

    if (
      typeof record.file_id !== 'string' ||
      typeof record.file_name !== 'string' ||
      typeof record.mime_type !== 'string' ||
      typeof record.size_bytes !== 'number'
    ) {
      return [];
    }

    return [
      {
        file_id: record.file_id,
        file_name: record.file_name,
        uploaded_at: typeof record.uploaded_at === 'string' ? record.uploaded_at : null,
        kind: record.kind === 'attachment' ? 'attachment' : 'photo',
      },
    ];
  });
}

const VISIT_RECORD_CURSOR_KEYS = ['visit_date', 'created_at'] as const;

function buildVisitRecordKeysetWhere(
  cursor: ReturnType<typeof decodeKeysetCursor<(typeof VISIT_RECORD_CURSOR_KEYS)[number]>>,
): Prisma.VisitRecordWhereInput | null {
  if (!cursor) return null;

  return {
    OR: [
      { visit_date: { lt: cursor.visit_date } },
      {
        visit_date: cursor.visit_date,
        created_at: { lt: cursor.created_at },
      },
      {
        visit_date: cursor.visit_date,
        created_at: cursor.created_at,
        id: { lt: cursor.id },
      },
    ],
  };
}

type LatestPrescriptionHistoryRow = {
  patient_id: string;
  id: string;
  prescribed_date: Date;
  prescriber_name: string | null;
  prescription_count: bigint | number | string;
  drug_names: string[] | null;
  medications: Prisma.JsonValue | null;
};

type PreviousVisitHistoryRow = {
  record_id: string;
  visit_count: bigint | number | string | null;
  previous_visit_id: string | null;
  previous_visit_date: Date | null;
  previous_outcome_status: string | null;
  previous_next_visit_suggestion_date: Date | null;
};

function toCount(value: bigint | number | string | null | undefined) {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return 0;
}

function normalizeLatestPrescriptionMedications(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    const drug = readJsonObject(entry);
    if (!drug || typeof drug.drug_name !== 'string') return [];

    return [
      {
        drug_name: drug.drug_name,
        drug_code:
          typeof drug.drug_code === 'string' ? normalizeDrugIdentityCode(drug.drug_code) : null,
      },
    ];
  });
}

async function buildVisitRecordPatientHistorySummaries(
  orgId: string,
  records: VisitRecordListItem[],
) {
  const patientIds = Array.from(new Set(records.map((record) => record.patient_id)));
  const recordIds = records.map((record) => record.id);
  if (patientIds.length === 0) return new Map<string, unknown>();

  const [latestPrescriptions, previousVisits] = await Promise.all([
    prisma.$queryRaw<LatestPrescriptionHistoryRow[]>`
      SELECT
        ranked.patient_id,
        ranked.id,
        ranked.prescribed_date,
        ranked.prescriber_name,
        ranked.prescription_count,
        COALESCE(
          array_agg(line.drug_name ORDER BY line.line_number)
            FILTER (WHERE line.drug_name IS NOT NULL),
          ARRAY[]::text[]
        ) AS drug_names,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'drug_name', line.drug_name,
              'drug_code', line.drug_code
            )
            ORDER BY line.line_number
          ) FILTER (WHERE line.drug_name IS NOT NULL),
          '[]'::jsonb
        ) AS medications
      FROM (
        SELECT
          cycle.patient_id,
          intake.id,
          intake.prescribed_date,
          intake.prescriber_name,
          COUNT(*) OVER (PARTITION BY cycle.patient_id)::bigint AS prescription_count,
          ROW_NUMBER() OVER (
            PARTITION BY cycle.patient_id
            ORDER BY intake.prescribed_date DESC, intake.id DESC
          ) AS rn
        FROM "PrescriptionIntake" intake
        INNER JOIN "MedicationCycle" cycle
          ON cycle.id = intake.cycle_id
          AND cycle.org_id = intake.org_id
        WHERE intake.org_id = ${orgId}
          AND cycle.patient_id = ANY(${patientIds}::text[])
      ) ranked
      LEFT JOIN LATERAL (
        SELECT drug_name, drug_code, line_number
        FROM "PrescriptionLine"
        WHERE org_id = ${orgId}
          AND intake_id = ranked.id
        ORDER BY line_number ASC
        LIMIT 3
      ) line ON TRUE
      WHERE ranked.rn = 1
      GROUP BY
        ranked.patient_id,
        ranked.id,
        ranked.prescribed_date,
        ranked.prescriber_name,
        ranked.prescription_count
    `,
    prisma.$queryRaw<PreviousVisitHistoryRow[]>`
      WITH current_records AS (
        SELECT id, patient_id, visit_date, created_at
        FROM "VisitRecord"
        WHERE org_id = ${orgId}
          AND id = ANY(${recordIds}::text[])
      ),
      visit_counts AS (
        SELECT patient_id, COUNT(*)::bigint AS visit_count
        FROM "VisitRecord"
        WHERE org_id = ${orgId}
          AND patient_id = ANY(${patientIds}::text[])
        GROUP BY patient_id
      )
      SELECT
        current_records.id AS record_id,
        visit_counts.visit_count,
        previous_visit.id AS previous_visit_id,
        previous_visit.visit_date AS previous_visit_date,
        previous_visit.outcome_status::text AS previous_outcome_status,
        previous_visit.next_visit_suggestion_date AS previous_next_visit_suggestion_date
      FROM current_records
      LEFT JOIN visit_counts
        ON visit_counts.patient_id = current_records.patient_id
      LEFT JOIN LATERAL (
        SELECT id, visit_date, outcome_status, next_visit_suggestion_date
        FROM "VisitRecord" visit
        WHERE visit.org_id = ${orgId}
          AND visit.patient_id = current_records.patient_id
          AND (
            visit.visit_date < current_records.visit_date
            OR (
              visit.visit_date = current_records.visit_date
              AND (
                visit.created_at < current_records.created_at
                OR (
                  visit.created_at = current_records.created_at
                  AND visit.id < current_records.id
                )
              )
            )
          )
        ORDER BY visit.visit_date DESC, visit.created_at DESC, visit.id DESC
        LIMIT 1
      ) previous_visit ON TRUE
    `,
  ]);

  const latestPrescriptionByPatient = new Map(
    latestPrescriptions.map((prescription) => [prescription.patient_id, prescription]),
  );
  const previousVisitByRecord = new Map(previousVisits.map((visit) => [visit.record_id, visit]));

  const summaries = new Map<string, unknown>();
  for (const record of records) {
    const latestPrescription = latestPrescriptionByPatient.get(record.patient_id) ?? null;
    const previousVisit = previousVisitByRecord.get(record.id) ?? null;

    summaries.set(record.id, {
      prescription_count: toCount(latestPrescription?.prescription_count),
      visit_count: toCount(previousVisit?.visit_count),
      latest_prescription: latestPrescription
        ? {
            id: latestPrescription.id,
            prescribed_date: latestPrescription.prescribed_date,
            prescriber_name: latestPrescription.prescriber_name,
            drug_names: latestPrescription.drug_names ?? [],
            medications: normalizeLatestPrescriptionMedications(latestPrescription.medications),
          }
        : null,
      previous_visit: previousVisit?.previous_visit_id
        ? {
            id: previousVisit.previous_visit_id,
            visit_date: previousVisit.previous_visit_date,
            outcome_status: previousVisit.previous_outcome_status,
            next_visit_suggestion_date: previousVisit.previous_next_visit_suggestion_date,
          }
        : null,
    });
  }

  return summaries;
}

async function authenticatedGET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問記録の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);
    const keysetCursor = decodeKeysetCursor(VISIT_RECORD_CURSOR_KEYS, cursor);
    const keysetWhere = buildVisitRecordKeysetWhere(keysetCursor);
    const parsedQuery = parseVisitRecordListQuery(searchParams);
    if (!parsedQuery.ok) return parsedQuery.response;

    const patientId = parsedQuery.data.patient_id;
    const pharmacistId = parsedQuery.data.pharmacist_id;
    const dateFrom = parsedQuery.data.date_from;
    const dateTo = parsedQuery.data.date_to;
    const includeHistorySummary = parsedQuery.data.include_history_summary ?? false;
    const includeAttachments = parsedQuery.data.include_attachments ?? false;
    const isEvidenceGalleryView =
      includeAttachments && parsedQuery.data.view === 'evidence_gallery';
    const assignmentWhere = buildVisitRecordScheduleAssignmentWhere(ctx);

    const where: Prisma.VisitRecordWhereInput = {
      org_id: ctx.orgId,
      ...(patientId ? { patient_id: patientId } : {}),
      ...(pharmacistId ? { pharmacist_id: pharmacistId } : {}),
      ...(keysetWhere ?? {}),
      ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
      ...(dateFrom || dateTo
        ? {
            visit_date: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lte: new Date(dateTo + 'T23:59:59') } : {}),
            },
          }
        : {}),
    };

    const select = isEvidenceGalleryView
      ? ({
          id: true,
          visit_date: true,
          created_at: true,
          attachments: true,
        } satisfies Prisma.VisitRecordSelect)
      : ({
          id: true,
          schedule_id: true,
          patient_id: true,
          pharmacist_id: true,
          visit_date: true,
          outcome_status: true,
          soap_subjective: true,
          soap_objective: true,
          soap_assessment: true,
          soap_plan: true,
          receipt_person_name: true,
          receipt_person_relation: true,
          receipt_at: true,
          next_visit_suggestion_date: true,
          version: true,
          created_at: true,
          updated_at: true,
          ...(includeAttachments ? { attachments: true } : {}),
          schedule: {
            select: {
              visit_type: true,
              scheduled_date: true,
              case_: {
                select: {
                  patient: {
                    select: {
                      id: true,
                      name: true,
                      name_kana: true,
                    },
                  },
                },
              },
            },
          },
        } satisfies Prisma.VisitRecordSelect);

    const records = await prisma.visitRecord.findMany({
      where,
      take: limit + 1,
      orderBy: [{ visit_date: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
      select,
    });

    const page = buildCursorPage(records, limit, (record) =>
      encodeKeysetCursor(VISIT_RECORD_CURSOR_KEYS, record),
    );
    const pageRecords = page.data;
    const patientHistorySummaries =
      includeHistorySummary && !isEvidenceGalleryView
        ? await buildVisitRecordPatientHistorySummaries(
            ctx.orgId,
            collectVisitRecordListItems(pageRecords),
          )
        : null;
    const data = isEvidenceGalleryView
      ? pageRecords.map((record) => ({
          id: record.id,
          visit_date: record.visit_date,
          created_at: record.created_at,
          attachments: parseStoredVisitRecordAttachmentSummaries(
            'attachments' in record ? record.attachments : null,
          ),
        }))
      : pageRecords.map((record) => ({
          ...record,
          ...(includeAttachments
            ? {
                attachments: parseStoredVisitRecordAttachmentSummaries(
                  'attachments' in record ? record.attachments : null,
                ),
              }
            : {}),
          patient_history_summary: patientHistorySummaries?.get(record.id) ?? null,
        }));

    return withSensitiveNoStore(
      success({
        data,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      }),
    );
  });
}

export async function GET(req: NextRequest) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'visit_records_get_unhandled_error',
          route: ROUTE,
          method: req.method,
          status: 500,
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  });
}

async function saveVisitRecord(ctx: AuthContext, input: CreateVisitRecordInput) {
  const {
    schedule_id,
    patient_id,
    visit_date,
    visit_started_at,
    visit_ended_at,
    outcome_status,
    next_visit_suggestion_date,
    structured_soap,
    visit_geo_log,
    receipt_at,
    residual_medications,
    conflict_resolution,
    existing_record_id,
    expected_version,
    carry_item_warning_acknowledged,
    ...rest
  } = input;
  const visitRecordedAt = new Date(visit_date);
  const visitStartedAt = visit_started_at ? new Date(visit_started_at) : null;
  const visitEndedAt = visit_ended_at ? new Date(visit_ended_at) : null;
  const scheduleStatus = scheduleStatusByOutcome[outcome_status];
  const shouldAdvanceVisitWorkflow = cycleCompletionOutcomes.has(outcome_status);
  const reductionCandidates = collectResidualReductionCandidates(residual_medications);
  const normalizedStructuredSoap = normalizeStructuredSoapForVisitRecordSave(
    structured_soap,
  ) as typeof structured_soap;

  const soapTextOverrides: Partial<ReturnType<typeof buildAllSoapTexts>> = normalizedStructuredSoap
    ? buildAllSoapTexts(normalizedStructuredSoap as StructuredSoap)
    : {};
  const soapAssessment =
    typeof soapTextOverrides.soap_assessment === 'string'
      ? soapTextOverrides.soap_assessment
      : (rest.soap_assessment ?? null);
  const baseSoapPlan =
    typeof soapTextOverrides.soap_plan === 'string'
      ? soapTextOverrides.soap_plan
      : (rest.soap_plan ?? null);

  return withOrgContext(ctx.orgId, async (tx) => {
    const schedule = await tx.visitSchedule.findFirst({
      where: { id: schedule_id, org_id: ctx.orgId },
      select: {
        id: true,
        case_id: true,
        version: true,
        schedule_status: true,
        carry_items_status: true,
        recurrence_rule: true,
        scheduled_date: true,
        cycle_id: true,
        visit_type: true,
        pharmacist_id: true,
        site_id: true,
        time_window_start: true,
        time_window_end: true,
        medication_end_date: true,
        visit_deadline_date: true,
        case_: {
          select: {
            primary_pharmacist_id: true,
            backup_pharmacist_id: true,
          },
        },
      },
    });
    if (!schedule) {
      return { error: 'schedule_not_found' as const };
    }
    if (!canAccessVisitScheduleAssignment(ctx, schedule)) {
      return { error: 'schedule_forbidden' as const };
    }
    const existingRecord = await loadExistingVisitRecordConflict(tx, ctx.orgId, schedule_id);
    const canOverwrite =
      existingRecord != null &&
      conflict_resolution === 'overwrite' &&
      existing_record_id === existingRecord.id &&
      expected_version === existingRecord.version;

    if (existingRecord && !canOverwrite) {
      return {
        error: 'record_conflict' as const,
        existingRecord,
      };
    }
    if (
      !canSaveVisitRecordForScheduleStatus({
        sourceStatus: schedule.schedule_status,
        targetStatus: scheduleStatus,
        isOverwrite: canOverwrite,
      })
    ) {
      return {
        error: 'schedule_status_conflict' as const,
        scheduleStatus: schedule.schedule_status,
      };
    }

    const suggestedNextVisitDate = getNextVisitSuggestionDate({
      explicitSuggestion: next_visit_suggestion_date,
      recurrenceRule: schedule.recurrence_rule,
      recurrenceAnchorDate: schedule.scheduled_date,
      visitRecordedAt,
      medicationEndDate: schedule.medication_end_date,
      visitDeadlineDate: schedule.visit_deadline_date,
    });
    const nextVisitSuggestionDateInput = suggestedNextVisitDate
      ? new Date(suggestedNextVisitDate)
      : null;

    const careCase = await tx.careCase.findFirst({
      where: {
        id: schedule.case_id,
        org_id: ctx.orgId,
      },
      select: {
        patient_id: true,
        required_visit_support: true,
      },
    });
    if (!careCase) {
      return { error: 'case_not_found' as const };
    }
    if (careCase.patient_id !== patient_id) {
      return { error: 'patient_mismatch' as const };
    }

    const missingResidualMedicationDrugMasterIds = await findMissingResidualMedicationDrugMasterIds(
      tx,
      residual_medications,
    );
    if (missingResidualMedicationDrugMasterIds.length > 0) {
      return {
        error: 'invalid_residual_medication_drug_master_id' as const,
      };
    }

    const previousVisitReuseValidation = await validatePreviousVisitReuseSource({
      tx,
      orgId: ctx.orgId,
      patientId: careCase.patient_id,
      caseId: schedule.case_id,
      structuredSoap: normalizedStructuredSoap,
    });
    if (!previousVisitReuseValidation.ok) {
      return {
        error: 'previous_visit_source_conflict' as const,
        reason: previousVisitReuseValidation.reason,
        details: previousVisitReuseValidation.details,
      };
    }

    if (
      schedule.carry_items_status === 'blocked' &&
      !['postponed', 'cancelled'].includes(outcome_status)
    ) {
      return { error: 'carry_items_blocked' as const };
    }
    if (
      schedule.carry_items_status === 'partial' &&
      !['postponed', 'cancelled'].includes(outcome_status) &&
      carry_item_warning_acknowledged !== true
    ) {
      return { error: 'carry_items_partial_acknowledgement_required' as const };
    }
    if (
      schedule.carry_items_status === 'blocked' &&
      outcome_status === 'postponed' &&
      !rest.postpone_reason?.trim()
    ) {
      return { error: 'blocked_carry_items_postpone_reason_required' as const };
    }
    if (
      schedule.carry_items_status === 'blocked' &&
      outcome_status === 'cancelled' &&
      !rest.cancellation_reason?.trim()
    ) {
      return { error: 'blocked_carry_items_cancellation_reason_required' as const };
    }
    const shouldRecordCarryItemWarningAcknowledgement =
      schedule.carry_items_status === 'partial' &&
      carry_item_warning_acknowledged === true &&
      outcome_status !== 'postponed' &&
      outcome_status !== 'cancelled';
    const soapPlan = shouldRecordCarryItemWarningAcknowledgement
      ? [baseSoapPlan, '持参物一部未確定の警告確認: 代替手配または現地対応方針を確認済み。']
          .filter((line): line is string => Boolean(line?.trim()))
          .join('\n')
      : baseSoapPlan;

    let billingBlockers: Parameters<
      typeof getMissingHomeVisit2026CompletionItems
    >[0]['billingBlockers'] = [];
    if (isHomeVisit2026CompletionOutcome(outcome_status)) {
      const [scopedVisitRecords, scopedMedicationCycles] = await Promise.all([
        tx.visitRecord.findMany({
          where: {
            org_id: ctx.orgId,
            patient_id,
            schedule: {
              case_id: schedule.case_id,
            },
          },
          select: { id: true },
        }),
        tx.medicationCycle.findMany({
          where: {
            org_id: ctx.orgId,
            patient_id,
            case_id: schedule.case_id,
          },
          select: { id: true },
        }),
      ]);
      const billingEvidence = await listBillingEvidenceBlockers(tx, {
        orgId: ctx.orgId,
        patientId: patient_id,
        visitRecordIds: scopedVisitRecords.map((item) => item.id),
        cycleIds: scopedMedicationCycles.map((item) => item.id),
        limit: 4,
      });
      billingBlockers = billingEvidence.flatMap((item) => item.blockers);
    }
    const intakeInitialTransitionExpected =
      getHomeVisitIntake(careCase.required_visit_support)?.initial_transition_management_expected ??
      null;

    const missingHomeVisit2026Items = getMissingHomeVisit2026CompletionItems({
      outcomeStatus: outcome_status,
      structuredSoap: normalizedStructuredSoap as Partial<StructuredSoap> | null | undefined,
      visitType: schedule.visit_type,
      residualMedicationCount: residual_medications?.length ?? 0,
      billingBlockers,
      intakeInitialTransitionExpected,
    });
    if (missingHomeVisit2026Items.length > 0) {
      return {
        error: 'home_visit_2026_readiness_incomplete' as const,
        missingItems: missingHomeVisit2026Items.map((item) => ({
          key: item.key,
          label: item.label,
          severity: item.severity,
        })),
      };
    }

    // 訪問時点の患者詳細を凍結する(過去訪問の不変参照 / 前回訪問差分の基準点)。
    // findPatientOverviewBase の生現在値読み出しを再利用し、二重実装しない。
    // captured_at は凍結した実時刻(=保存時点)。snapshot は「記録作成時点の現在値」であり
    // visit_date 時点の状態ではない(遡及入力では両者がずれるため意図的に分離)。visit_date は VisitRecord 本体が保持。
    // スナップショットはベストエフォート: 構築に失敗しても訪問記録(臨床データ)の保存は継続する。
    let patientStateSnapshot: Prisma.InputJsonValue | null = null;
    try {
      patientStateSnapshot = await buildPatientStateSnapshot(tx, {
        orgId: ctx.orgId,
        patientId: careCase.patient_id,
        caseId: schedule.case_id,
        role: ctx.role,
        userId: ctx.userId,
        source: 'visit_record',
      });
    } catch (snapshotError) {
      logger.error(
        {
          event: 'visit_records_patient_state_snapshot_build_failed',
          route: ROUTE,
          operation: 'build_patient_state_snapshot',
        },
        snapshotError,
      );
    }

    let record;
    if (existingRecord && canOverwrite) {
      const updateResult = await tx.visitRecord.updateMany({
        where: {
          id: existingRecord.id,
          org_id: ctx.orgId,
          version: expected_version,
        },
        data: {
          patient_id: careCase.patient_id,
          pharmacist_id: ctx.userId,
          visit_date: visitRecordedAt,
          visit_started_at: visitStartedAt,
          visit_ended_at: visitEndedAt,
          next_visit_suggestion_date: nextVisitSuggestionDateInput,
          receipt_at: receipt_at ? new Date(receipt_at) : null,
          ...rest,
          outcome_status,
          ...soapTextOverrides,
          soap_plan: soapPlan,
          structured_soap: normalizeOptionalJsonInput(normalizedStructuredSoap),
          visit_geo_log: normalizeOptionalJsonInput(visit_geo_log),
          patient_state_snapshot: patientStateSnapshot ?? undefined,
          version: { increment: 1 },
        } as Prisma.VisitRecordUncheckedUpdateInput,
      });
      if (updateResult.count === 0) {
        return {
          error: 'record_conflict' as const,
          existingRecord,
        };
      }
      const updatedRecord = await tx.visitRecord.findFirst({
        where: { id: existingRecord.id, org_id: ctx.orgId },
      });
      if (!updatedRecord) {
        return { error: 'record_conflict' as const, existingRecord };
      }
      record = updatedRecord;
    } else {
      try {
        record = await tx.visitRecord.create({
          data: {
            org_id: ctx.orgId,
            schedule_id,
            patient_id: careCase.patient_id,
            pharmacist_id: ctx.userId,
            visit_date: visitRecordedAt,
            visit_started_at: visitStartedAt ?? undefined,
            visit_ended_at: visitEndedAt ?? undefined,
            next_visit_suggestion_date: nextVisitSuggestionDateInput ?? undefined,
            receipt_at: receipt_at ? new Date(receipt_at) : undefined,
            ...rest,
            outcome_status,
            ...soapTextOverrides,
            soap_plan: soapPlan,
            structured_soap: normalizeOptionalJsonInput(normalizedStructuredSoap),
            visit_geo_log: normalizeOptionalJsonInput(visit_geo_log),
            patient_state_snapshot: patientStateSnapshot ?? undefined,
          } as Prisma.VisitRecordUncheckedCreateInput,
        });
      } catch (err) {
        if (!isUniqueConstraintError(err)) throw err;
        const existingRecordAfterRace = await loadExistingVisitRecordConflict(
          tx,
          ctx.orgId,
          schedule_id,
        );
        return {
          error: 'record_conflict' as const,
          existingRecord: existingRecordAfterRace,
        };
      }
    }

    await replaceVisitRecordResidualMedications(tx, ctx.orgId, record.id, residual_medications);
    await syncVisitRecordLabObservations(
      tx,
      ctx.orgId,
      careCase.patient_id,
      record.id,
      visitRecordedAt,
      normalizedStructuredSoap,
    );

    if (schedule.visit_type === 'initial' && firstVisitDocumentOutcomes.has(outcome_status)) {
      await upsertFirstVisitDocument({
        tx,
        ctx,
        orgId: ctx.orgId,
        patientId: careCase.patient_id,
        caseId: schedule.case_id,
        recordId: record.id,
        receiptAt: receipt_at || undefined,
        receiptPersonName: rest.receipt_person_name,
      });
    }

    if (reductionCandidates.length > 0) {
      const prohibitedCandidates = reductionCandidates.filter(
        (candidate) => candidate.is_prohibited_reduction,
      );
      const allowedCandidates = reductionCandidates.filter(
        (candidate) => !candidate.is_prohibited_reduction,
      );

      for (const candidate of allowedCandidates) {
        const drugLabel = residualReductionDrugLabel(candidate);
        const drugIdentityKey = residualReductionIdentityKey(candidate);
        const existingIssue = await tx.medicationIssue.findFirst({
          where: {
            org_id: ctx.orgId,
            patient_id: careCase.patient_id,
            case_id: schedule.case_id,
            ...residualReductionIssueTitleWhere(candidate),
            status: {
              in: ['open', 'in_progress'],
            },
          },
          select: { id: true },
        });

        const issue =
          existingIssue ??
          (await (async () => {
            const displayId = await allocateDisplayId(tx, 'MedicationIssue', ctx.orgId);
            return tx.medicationIssue.create({
              data: {
                org_id: ctx.orgId,
                display_id: displayId,
                patient_id: careCase.patient_id,
                case_id: schedule.case_id,
                title: `${drugLabel} の残薬調整`,
                description: `${drugLabel} に残薬超過（約${candidate.excess_days}日分）があります。処方医への報告と減数調剤可否の確認が必要です。`,
                status: 'open',
                priority: candidate.excess_days >= 14 ? 'high' : 'medium',
                category: 'adherence',
                identified_by: ctx.userId,
              },
              select: { id: true },
            });
          })());

        const existingTracingReport = await tx.tracingReport.findFirst({
          where: {
            org_id: ctx.orgId,
            patient_id: careCase.patient_id,
            issue_id: issue.id,
            status: {
              in: ['draft', 'sent', 'received'],
            },
          },
          select: { id: true },
        });

        const tracingReport =
          existingTracingReport ??
          (await tx.tracingReport.create({
            data: {
              org_id: ctx.orgId,
              patient_id: careCase.patient_id,
              case_id: schedule.case_id,
              issue_id: issue.id,
              status: 'draft',
              content: {
                category: 'residual_reduction',
                drug_master_id: candidate.drug_master_id ?? null,
                drug_name: candidate.drug_name,
                drug_code: candidate.drug_code ?? null,
                remaining_quantity: candidate.remaining_quantity,
                prescribed_daily_dose: candidate.prescribed_daily_dose,
                excess_days: candidate.excess_days,
                recommendation: '処方医へ残薬調整の可否を照会する',
                source_visit_record_id: record.id,
              } satisfies Prisma.InputJsonValue,
              sent_to_physician: null,
            },
            select: { id: true },
          }));

        const existingTracingRequest = await tx.communicationRequest.findFirst({
          where: {
            org_id: ctx.orgId,
            related_entity_type: 'tracing_report',
            related_entity_id: tracingReport.id,
          },
          select: { id: true },
        });

        if (!existingTracingRequest) {
          await tx.communicationRequest.create({
            data: {
              org_id: ctx.orgId,
              patient_id: careCase.patient_id,
              case_id: schedule.case_id,
              request_type: 'tracing_report',
              template_key: 'tracing_report',
              recipient_name: null,
              recipient_role: 'physician',
              related_entity_type: 'tracing_report',
              related_entity_id: tracingReport.id,
              status: 'draft',
              subject: `${drugLabel} の服薬情報提供書`,
              content: `${drugLabel} の残薬調整について処方医へ共有します。`,
              requested_by: ctx.userId,
              due_date: null,
            },
          });
        }

        await upsertOperationalTask(tx, {
          orgId: ctx.orgId,
          taskType: 'tracing_report_followup',
          title: `${drugLabel} の残薬調整を確認`,
          description: '残薬調整の処方医報告と tracing report 起票を確認してください。',
          priority: candidate.excess_days >= 14 ? 'high' : 'normal',
          assignedTo: ctx.userId,
          dueDate: visitRecordedAt,
          slaDueAt: visitRecordedAt,
          relatedEntityType: 'tracing_report',
          relatedEntityId: tracingReport.id,
          dedupeKey: `tracing-report-followup:${record.id}:${drugIdentityKey}`,
          metadata: {
            patient_id: careCase.patient_id,
            case_id: schedule.case_id,
            issue_id: issue.id,
            tracing_report_id: tracingReport.id,
            drug_name: candidate.drug_name,
            drug_master_id: candidate.drug_master_id ?? null,
            drug_code: normalizeDrugIdentityCode(candidate.drug_code),
            drug_identity_key: drugIdentityKey,
            excess_days: candidate.excess_days,
          } satisfies Prisma.InputJsonValue,
        });
      }

      if (prohibitedCandidates.length > 0) {
        if (schedule.cycle_id) {
          const description = `減数調剤禁止薬剤が残薬調整候補です: ${prohibitedCandidates
            .map(
              (candidate) =>
                `${residualReductionDrugLabel(candidate)}（約${candidate.excess_days}日分）`,
            )
            .join(' / ')}`;

          const existingException = await tx.workflowException.findFirst({
            where: {
              org_id: ctx.orgId,
              cycle_id: schedule.cycle_id,
              exception_type: 'reduction_prohibited_drug',
              status: 'open' satisfies ExceptionStatus,
            },
            select: { id: true },
          });

          if (!existingException) {
            await tx.workflowException.create({
              data: {
                org_id: ctx.orgId,
                cycle_id: schedule.cycle_id,
                patient_id: careCase.patient_id,
                exception_type: 'reduction_prohibited_drug',
                description,
                severity: 'critical' satisfies ExceptionSeverity,
                status: 'open' satisfies ExceptionStatus,
              },
            });
          }
        }

        await upsertOperationalTask(tx, {
          orgId: ctx.orgId,
          taskType: 'residual_reduction_review',
          title: '減数調剤禁止薬の残薬を確認',
          description: prohibitedCandidates
            .map(
              (candidate) =>
                `${residualReductionDrugLabel(candidate)} は減数調剤禁止です。処方医へ通常報告のみ行ってください。`,
            )
            .join(' / '),
          priority: 'high',
          assignedTo: ctx.userId,
          dueDate: visitRecordedAt,
          slaDueAt: visitRecordedAt,
          relatedEntityType: 'visit_record',
          relatedEntityId: record.id,
          dedupeKey: `residual-reduction-review:${record.id}`,
          metadata: {
            patient_id: careCase.patient_id,
            case_id: schedule.case_id,
            drugs: prohibitedCandidates.map((candidate) => ({
              drug_name: candidate.drug_name,
              drug_master_id: candidate.drug_master_id ?? null,
              drug_code: normalizeDrugIdentityCode(candidate.drug_code),
              drug_identity_key: residualReductionIdentityKey(candidate),
              excess_days: candidate.excess_days,
            })),
          } satisfies Prisma.InputJsonValue,
        });
      }
    }

    const scheduleStatusClaim = await tx.visitSchedule.updateMany({
      where: {
        id: schedule_id,
        org_id: ctx.orgId,
        version: schedule.version,
        schedule_status: schedule.schedule_status,
      },
      data: {
        schedule_status: scheduleStatus,
        version: { increment: 1 },
      },
    });
    if (scheduleStatusClaim.count !== 1) {
      const currentSchedule = await tx.visitSchedule.findFirst({
        where: { id: schedule_id, org_id: ctx.orgId },
        select: { schedule_status: true },
      });
      throw new VisitRecordSaveRollback({
        error: 'schedule_status_conflict',
        scheduleStatus: currentSchedule?.schedule_status ?? schedule.schedule_status,
      });
    }

    if (shouldAdvanceVisitWorkflow && schedule.cycle_id) {
      const activeVisitConsent = await tx.consentRecord.findFirst({
        where: {
          org_id: ctx.orgId,
          patient_id: careCase.patient_id,
          consent_type: 'visit_medication_management',
          is_active: true,
          revoked_date: null,
          OR: [{ expiry_date: null }, { expiry_date: { gte: visitRecordedAt } }],
        },
        select: { id: true },
      });

      const cycle = await tx.medicationCycle.findFirst({
        where: { id: schedule.cycle_id, org_id: ctx.orgId },
        select: { id: true, overall_status: true },
      });

      if (
        cycle &&
        (cycle.overall_status === 'set_audited' || cycle.overall_status === 'visit_ready')
      ) {
        if (cycle.overall_status === 'set_audited') {
          await transitionCycleStatus(tx, cycle.id, ctx.orgId, 'visit_ready', ctx.userId, {
            note: '訪問記録作成に伴う訪問準備完了',
          });
        }
        await transitionCycleStatus(tx, cycle.id, ctx.orgId, 'visit_completed', ctx.userId, {
          note: '訪問記録作成に伴う訪問完了',
        });
      }

      if (!activeVisitConsent) {
        const existingException = await tx.workflowException.findFirst({
          where: {
            org_id: ctx.orgId,
            cycle_id: schedule.cycle_id,
            exception_type: 'missing_visit_consent',
            status: 'open' satisfies ExceptionStatus,
          },
          select: { id: true },
        });

        if (!existingException) {
          await tx.workflowException.create({
            data: {
              org_id: ctx.orgId,
              cycle_id: schedule.cycle_id,
              patient_id: careCase.patient_id,
              exception_type: 'missing_visit_consent',
              description: '訪問薬剤管理の有効な同意記録がない状態で訪問記録が登録されました',
              severity: 'critical' satisfies ExceptionSeverity,
              status: 'open' satisfies ExceptionStatus,
            },
          });

          await tx.medicationCycle.update({
            where: { id: schedule.cycle_id },
            data: { exception_status: 'missing_visit_consent' },
          });
        }
      }
    }

    let suggestedSchedule = null;
    if (nextVisitSuggestionDateInput) {
      const intervalDays = differenceInCalendarDays(nextVisitSuggestionDateInput, visitRecordedAt);
      suggestedSchedule = {
        suggested_date: formatDateKey(nextVisitSuggestionDateInput),
        auto_generated: !next_visit_suggestion_date,
        interval_days: intervalDays,
        message: '次回訪問日の作成を検討してください',
      };

      await upsertOperationalTask(tx, {
        orgId: ctx.orgId,
        taskType: 'visit_followup',
        title: '次回訪問候補の調整が必要です',
        description: '訪問記録で次回訪問日の提案が入力されています。',
        priority: outcome_status === 'revisit_needed' ? 'urgent' : 'high',
        assignedTo: ctx.userId,
        dueDate: nextVisitSuggestionDateInput,
        slaDueAt: nextVisitSuggestionDateInput,
        relatedEntityType: 'visit_record',
        relatedEntityId: record.id,
        dedupeKey: `visit-followup:${record.id}`,
        metadata: normalizeInputJsonObject({
          patient_id: careCase.patient_id,
          case_id: schedule.case_id,
          schedule_id,
          auto_generated: !next_visit_suggestion_date,
          source_visit_type: schedule.visit_type,
        }),
      });
    }

    await upsertOperationalTask(tx, {
      orgId: ctx.orgId,
      taskType: 'care_report_followup',
      title: '訪問後報告の送付確認が必要です',
      description: '医師・ケアマネ向け報告書の送付状況を確認してください。',
      priority: 'high',
      assignedTo: ctx.userId,
      dueDate: visitRecordedAt,
      slaDueAt: visitRecordedAt,
      relatedEntityType: 'visit_record',
      relatedEntityId: record.id,
      dedupeKey: `care-report-followup:${record.id}`,
      metadata: normalizeInputJsonObject({
        patient_id: careCase.patient_id,
        case_id: schedule.case_id,
      }),
    });

    await upsertBillingEvidenceForVisit(tx, {
      orgId: ctx.orgId,
      visitRecordId: record.id,
    });

    let handoffExtraction: VisitRecordHandoffExtractionPayload | null = null;
    if (normalizedStructuredSoap) {
      const patient = await tx.patient.findFirst({
        where: {
          id: careCase.patient_id,
          org_id: ctx.orgId,
        },
        select: {
          name: true,
        },
      });

      if (patient) {
        handoffExtraction = {
          patientId: careCase.patient_id,
          patientName: patient.name,
          structuredSoap: normalizedStructuredSoap as StructuredSoap,
          soapAssessment,
          soapPlan,
          expectedVersion: record.version,
        };
      }
    }

    return {
      record,
      suggestedSchedule,
      conflictResolved: canOverwrite,
      handoffExtraction,
    };
  }).catch((cause: unknown) => {
    if (cause instanceof VisitRecordSaveRollback) {
      return cause.result;
    }
    throw cause;
  });
}

async function authenticatedPOST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問記録の作成権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createVisitRecordSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const result = await saveVisitRecord(ctx, parsed.data);

    if ('error' in result) {
      if (result.error === 'schedule_not_found') {
        return validationError('指定されたスケジュールが見つかりません');
      }
      if (result.error === 'schedule_forbidden') {
        return forbiddenResponse('この訪問予定の記録を作成する権限がありません');
      }
      if (result.error === 'schedule_status_conflict') {
        return conflict('訪問予定が同時に更新されました。再読み込みしてください', {
          current_schedule_status: result.scheduleStatus ?? null,
        });
      }
      if (result.error === 'case_not_found') {
        return validationError('訪問予定に紐づくケースが見つかりません');
      }
      if (result.error === 'patient_mismatch') {
        return validationError('訪問予定に紐づく患者と記録対象患者が一致しません');
      }
      if (result.error === 'invalid_residual_medication_drug_master_id') {
        return validationError('入力値が不正です', {
          drug_master_id: ['存在する医薬品マスターを選択してください'],
        });
      }
      if (result.error === 'carry_items_blocked') {
        return validationError(
          '持参物が未確定のため訪問記録を作成できません。持参物を確定するか代替手配を記録してください',
        );
      }
      if (result.error === 'carry_items_partial_acknowledgement_required') {
        return validationError(
          '持参物が一部未確定のため、代替手配または現地対応方針の確認が必要です',
        );
      }
      if (result.error === 'blocked_carry_items_postpone_reason_required') {
        return validationError('持参物未確定で延期する場合は延期理由を入力してください');
      }
      if (result.error === 'blocked_carry_items_cancellation_reason_required') {
        return validationError(
          '持参物未確定でキャンセルする場合はキャンセル理由を入力してください',
        );
      }
      if (result.error === 'home_visit_2026_readiness_incomplete') {
        return validationError('訪問完了には訪問薬剤管理の必須確認が必要です', {
          home_visit_2026_readiness: result.missingItems.map((item) => item.label),
        });
      }
      if (result.error === 'record_conflict') {
        return conflict(
          'この訪問予定には既に記録があります。サーバー版との差分を確認してください。',
          {
            existing_record: result.existingRecord,
          },
        );
      }
      if (result.error === 'previous_visit_source_conflict') {
        return conflict(
          '前回訪問データが他のユーザーによって更新されています。訪問準備を再読み込みしてください。',
          {
            reason: result.reason,
            source: result.details,
          },
        );
      }
      return validationError('指定されたスケジュールが見つかりません');
    }

    const requestContext = getRequestAuthContext();
    if (result.handoffExtraction) {
      void processHandoffExtraction(prisma, {
        orgId: ctx.orgId,
        visitRecordId: result.record.id,
        patientId: result.handoffExtraction.patientId,
        patientName: result.handoffExtraction.patientName,
        structuredSoap: result.handoffExtraction.structuredSoap,
        soapAssessment: result.handoffExtraction.soapAssessment,
        soapPlan: result.handoffExtraction.soapPlan,
        expectedVersion: result.handoffExtraction.expectedVersion,
        requestContext,
      }).catch((cause) => {
        logger.warn(safeHandoffExtractionWarningContext(result.record.id), cause);
      });
    }

    const responsePayload = {
      record: result.record,
      suggestedSchedule: result.suggestedSchedule,
      conflictResolved: result.conflictResolved,
    };
    return success(responsePayload, result.conflictResolved ? 200 : 201);
  });
}

export async function POST(req: NextRequest) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedPOST(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'visit_records_post_unhandled_error',
          route: ROUTE,
          method: req.method,
          status: 500,
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  });
}
