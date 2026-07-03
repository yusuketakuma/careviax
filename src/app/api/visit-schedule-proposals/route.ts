import { createHash } from 'node:crypto';
import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError, notFound, conflict, internalError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { hhmmToTimeDate } from '@/lib/datetime/time-of-day';
import { timeDateToString } from '@/lib/visits/time-of-day';
import { prisma } from '@/lib/db/client';
import { formatUtcDateKey } from '@/lib/date-key';
import { validateOrgReferences } from '@/lib/api/org-reference';
import {
  buildVisitScheduleProposalAssignmentWhere,
  buildVisitScheduleProposalCaseAccessWhere,
} from '@/lib/auth/visit-schedule-access';
import {
  generateVisitScheduleProposalSchema,
  patientContactStatusValues,
  proposalStatusSchema,
} from '@/lib/validations/visit-schedule-proposal';
import { visitPriorityValues, visitTypeValues } from '@/lib/validations/visit-schedule';
import {
  omitProposalRejectReason,
  omitProposalRejectReasons,
  redactProposalContactLogs,
  redactProposalPatientFields,
} from '@/lib/visit-schedule-proposals/response';
import {
  OPEN_VISIT_SCHEDULE_PROPOSAL_STATUSES,
  allocateProposalRouteOrders,
  buildProposalRouteCellKey,
} from '@/lib/visit-schedule-proposals/route-order';
import { visitScheduleDateKeySchema } from '@/lib/validations/visit-schedule';
import { resolveBillingRulesForDate } from '@/server/services/billing-rules';
import { resolveBillingPayerBasis } from '@/server/services/billing-payer-basis';
import { resolvePatientInsurance } from '@/server/services/patient-insurance';
import { findLatestPrescriptionIntakeClassification } from '@/server/services/prescription-intake-classification';
import { generateVisitScheduleProposalDrafts } from '@/server/services/visit-schedule-planner';
import { resolveOperationalTasks } from '@/server/services/operational-tasks';
import { buildVisitScheduleReproposalTaskKey } from '@/server/services/visit-schedule-communication';
import {
  formatVisitWorkflowGateIssues,
  type VisitWorkflowGateIssue,
} from '@/server/services/management-plans';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import { loadVisitScheduleBillingGuardRows } from '@/server/services/visit-schedule-billing-guard';
import {
  validateBillingRequirements,
  type BillingCadenceProposalRow,
  type BillingCadenceScheduleRow,
  type BillingRequirementAlert,
} from '@/server/services/billing-requirement-validator';
import type { ProposalCandidateDiagnostic } from '@/server/services/visit-schedule-planner';

const proposalDateQuerySchema = visitScheduleDateKeySchema('日付形式が不正です（YYYY-MM-DD）');
const proposalLimitQuerySchema = z.coerce.number().int().min(1).max(50);
const PROPOSAL_CREATE_SERIALIZABLE_RETRY_LIMIT = 3;

class VisitProposalCreateRetryLimitError extends Error {
  constructor() {
    super('visit proposal creation transaction retry limit exceeded');
    this.name = 'VisitProposalCreateRetryLimitError';
  }
}

function isSerializableTransactionConflict(cause: unknown) {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2034';
}

function isProposalBatchIdempotencyRace(cause: unknown) {
  if (!(cause instanceof Prisma.PrismaClientKnownRequestError) || cause.code !== 'P2002') {
    return false;
  }
  const target = cause.meta?.target;
  if (typeof target === 'string') return target.includes('idempotency_key');
  return Array.isArray(target) && target.includes('idempotency_key');
}

async function withSerializableProposalCreateTransaction<T>(
  orgId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 0; attempt < PROPOSAL_CREATE_SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
    try {
      return await withOrgContext(orgId, work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (cause) {
      if (!isSerializableTransactionConflict(cause)) {
        throw cause;
      }
      if (attempt === PROPOSAL_CREATE_SERIALIZABLE_RETRY_LIMIT - 1) {
        throw new VisitProposalCreateRetryLimitError();
      }
    }
  }

  throw new VisitProposalCreateRetryLimitError();
}

function startOfMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function buildProposalRequestFingerprint(
  input: GenerateProposalFingerprintInput,
  options?: { includeOperatingDayOverrideReason?: boolean },
) {
  const materialObject = {
    case_id: input.caseId,
    visit_type: input.visitType,
    priority: input.priority,
    start_date: input.startDate ?? null,
    locked_date: input.lockedDate ?? null,
    candidate_count: input.candidateCount,
    travel_mode: input.travelMode,
    preferred_time_from: input.preferredTimeFrom ?? null,
    preferred_time_to: input.preferredTimeTo ?? null,
    preferred_pharmacist_id: input.preferredPharmacistId ?? null,
    vehicle_resource_id: input.vehicleResourceId ?? null,
    reschedule_source_schedule_id: input.rescheduleSourceScheduleId ?? null,
    reproposal_source_proposal_id: input.reproposalSourceProposalId ?? null,
    special_cap_eligible: input.specialCapEligible ?? null,
  };
  const material = JSON.stringify(
    options?.includeOperatingDayOverrideReason === false
      ? materialObject
      : {
          ...materialObject,
          operating_day_override_reason: input.operatingDayOverrideReason ?? null,
        },
  );
  return `visit-proposal:v1:${createHash('sha256').update(material).digest('hex')}`;
}

type ProposalRequestFingerprints = {
  current: string;
  legacyWithoutOperatingDayOverride: string | null;
};

function buildProposalRequestFingerprints(
  input: GenerateProposalFingerprintInput,
): ProposalRequestFingerprints {
  return {
    current: buildProposalRequestFingerprint(input),
    legacyWithoutOperatingDayOverride: input.operatingDayOverrideReason
      ? null
      : buildProposalRequestFingerprint(input, {
          includeOperatingDayOverrideReason: false,
        }),
  };
}

function matchesProposalRequestFingerprint(
  stored: string,
  fingerprints: ProposalRequestFingerprints,
) {
  return (
    stored === fingerprints.current || stored === fingerprints.legacyWithoutOperatingDayOverride
  );
}

type GenerateProposalFingerprintInput = {
  caseId: string;
  visitType: string;
  priority: string;
  startDate?: string;
  lockedDate?: string;
  candidateCount: number;
  travelMode: string;
  preferredTimeFrom?: string;
  preferredTimeTo?: string;
  preferredPharmacistId?: string;
  vehicleResourceId?: string;
  operatingDayOverrideReason?: string;
  rescheduleSourceScheduleId?: string;
  reproposalSourceProposalId?: string;
  specialCapEligible?: boolean;
};

type ProposalListQuery =
  | {
      ok: true;
      caseId: string | null;
      patientId: string | null;
      status: z.infer<typeof proposalStatusSchema> | null;
      dateFrom: string | null;
      dateTo: string | null;
      pharmacistId: string | null;
      query: string | null;
      limit: number | undefined;
      view: 'palette' | null;
    }
  | { ok: false; response: ReturnType<typeof validationError> };

function readSingleProposalQueryValue(
  searchParams: URLSearchParams,
  name: string,
  message: string,
  options: { allowPadded?: boolean; maxLength?: number } = {},
) {
  const values = searchParams.getAll(name);
  if (values.length === 0) return { ok: true as const, value: null };
  if (values.length > 1) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', {
        [name]: [`${name} は1つだけ指定してください`],
      }),
    };
  }

  const rawValue = values[0] ?? '';
  const value = rawValue.trim();
  if (!value || (!options.allowPadded && value !== rawValue)) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', { [name]: [message] }),
    };
  }
  if (options.maxLength && value.length > options.maxLength) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', { [name]: [message] }),
    };
  }

  return { ok: true as const, value };
}

function parseProposalDateQuery(value: string | null, fieldName: 'date_from' | 'date_to') {
  if (value === null) {
    return { ok: true as const, value: null };
  }

  const parsed = proposalDateQuerySchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false as const,
      response: validationError(`${fieldName} の日付形式が不正です（YYYY-MM-DD）`),
    };
  }

  return { ok: true as const, value: parsed.data };
}

function parseProposalLimitQuery(value: string | null) {
  if (value === null) {
    return { ok: true as const, value: undefined };
  }

  const parsed = proposalLimitQuerySchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false as const,
      response: validationError('limit は 1〜50 の整数で指定してください'),
    };
  }

  return { ok: true as const, value: parsed.data };
}

function parseProposalListQuery(searchParams: URLSearchParams): ProposalListQuery {
  const caseResult = readSingleProposalQueryValue(searchParams, 'case_id', 'case_id が不正です', {
    maxLength: 100,
  });
  if (!caseResult.ok) return caseResult;

  const patientResult = readSingleProposalQueryValue(
    searchParams,
    'patient_id',
    'patient_id が不正です',
    { maxLength: 100 },
  );
  if (!patientResult.ok) return patientResult;

  const statusResult = readSingleProposalQueryValue(searchParams, 'status', 'status が不正です', {
    maxLength: 100,
  });
  if (!statusResult.ok) return statusResult;
  const parsedStatus = statusResult.value
    ? proposalStatusSchema.safeParse(statusResult.value)
    : null;
  if (parsedStatus && !parsedStatus.success) {
    return { ok: false, response: validationError('status が不正です') };
  }

  const dateFromResult = readSingleProposalQueryValue(
    searchParams,
    'date_from',
    'date_from の日付形式が不正です（YYYY-MM-DD）',
  );
  if (!dateFromResult.ok) return dateFromResult;
  const parsedDateFrom = parseProposalDateQuery(dateFromResult.value, 'date_from');
  if (!parsedDateFrom.ok) return parsedDateFrom;

  const dateToResult = readSingleProposalQueryValue(
    searchParams,
    'date_to',
    'date_to の日付形式が不正です（YYYY-MM-DD）',
  );
  if (!dateToResult.ok) return dateToResult;
  const parsedDateTo = parseProposalDateQuery(dateToResult.value, 'date_to');
  if (!parsedDateTo.ok) return parsedDateTo;

  const pharmacistResult = readSingleProposalQueryValue(
    searchParams,
    'pharmacist_id',
    'pharmacist_id が不正です',
    { maxLength: 100 },
  );
  if (!pharmacistResult.ok) return pharmacistResult;

  const queryResult = readSingleProposalQueryValue(searchParams, 'q', 'q が不正です', {
    maxLength: 100,
  });
  if (!queryResult.ok) return queryResult;

  const limitResult = readSingleProposalQueryValue(searchParams, 'limit', 'limit が不正です');
  if (!limitResult.ok) return limitResult;
  const parsedLimit = parseProposalLimitQuery(limitResult.value);
  if (!parsedLimit.ok) return parsedLimit;

  const viewResult = readSingleProposalQueryValue(searchParams, 'view', 'view が不正です');
  if (!viewResult.ok) return viewResult;
  if (viewResult.value !== null && viewResult.value !== 'palette') {
    return { ok: false, response: validationError('view が不正です') };
  }

  return {
    ok: true,
    caseId: caseResult.value,
    patientId: patientResult.value,
    status: parsedStatus?.data ?? null,
    dateFrom: parsedDateFrom.value,
    dateTo: parsedDateTo.value,
    pharmacistId: pharmacistResult.value,
    query: queryResult.value,
    limit: parsedLimit.value,
    view: viewResult.value,
  };
}

/**
 * 訪問提案作成時の算定制限チェック。
 *
 * 新バリデーター（validateBillingRequirements）に委譲し、
 * severity: 'error' のアラートをブロッキングメッセージに変換する。
 * sameMonthExclusiveCodes チェック（BillingCandidate ベース）は
 * 新バリデーターの対象外のため、ここで保持する。
 *
 * 戻り値:
 * - blockingMessages: string[] — 空でなければ提案作成をブロック
 * - alerts: BillingRequirementAlert[] — 全アラート（UI表示用）
 */
async function validateProposalBillingExclusions(args: {
  db?: Prisma.TransactionClient;
  orgId: string;
  caseId: string;
  visitType: string;
  targetDate: Date;
  pharmacistId?: string;
  prescriptionCategory?: 'regular' | 'emergency';
  specialCapEligible?: boolean;
  excludeSupersededProposalScope?: {
    caseId: string;
    rescheduleSourceScheduleId?: string | null;
  };
  cadenceScheduleRows?: BillingCadenceScheduleRow[];
  cadenceProposalRows?: BillingCadenceProposalRow[];
}): Promise<{ blockingMessages: string[]; alerts: BillingRequirementAlert[] }> {
  const db = args.db ?? prisma;
  const careCase = await db.careCase.findFirst({
    where: {
      id: args.caseId,
      org_id: args.orgId,
    },
    select: {
      patient_id: true,
      patient: {
        select: {
          medical_insurance_number: true,
          care_insurance_number: true,
        },
      },
    },
  });

  if (!careCase) {
    return { blockingMessages: ['ケースが見つかりません'], alerts: [] };
  }

  const [medicalInsurance, careInsurance] = await Promise.all([
    resolvePatientInsurance(db, {
      orgId: args.orgId,
      patientId: careCase.patient_id,
      type: 'medical',
      asOf: args.targetDate,
    }),
    resolvePatientInsurance(db, {
      orgId: args.orgId,
      patientId: careCase.patient_id,
      type: 'care',
      asOf: args.targetDate,
    }),
  ]);

  const payerBasis = resolveBillingPayerBasis({
    medicalInsuranceNumber: medicalInsurance?.number ?? careCase.patient.medical_insurance_number,
    careInsuranceNumber: careInsurance?.number ?? careCase.patient.care_insurance_number,
    visitType: args.visitType,
  });

  const blockingMessages: string[] = [];

  // ── sameMonthExclusiveCodes チェック（BillingCandidate ベース、保持） ──
  if (payerBasis !== 'self_pay') {
    const targetRules = resolveBillingRulesForDate({
      payerBasis,
      asOfDate: args.targetDate,
    }).filter((rule) => rule.rule_type === 'base' && rule.provider_scope === 'pharmacy');
    const sameMonthExclusiveCodes = new Set(
      targetRules.flatMap((rule) => rule.exclusion_rules?.same_month_exclusive ?? []),
    );
    const targetMonth = startOfMonth(args.targetDate);

    const existingCandidates = await db.billingCandidate.findMany({
      where: {
        org_id: args.orgId,
        patient_id: careCase.patient_id,
        billing_month: targetMonth,
        status: { in: ['candidate', 'confirmed', 'exported'] },
      },
      select: { billing_code: true, billing_name: true },
    });

    const sameMonthExclusiveMatches = existingCandidates.filter((candidate) =>
      sameMonthExclusiveCodes.has(candidate.billing_code),
    );
    if (sameMonthExclusiveMatches.length > 0) {
      blockingMessages.push(
        `同月併算定不可の請求候補が存在します: ${sameMonthExclusiveMatches
          .map((candidate) => candidate.billing_name)
          .join(' / ')}`,
      );
    }
  }

  // ── 新バリデーターに委譲（月上限チェック含む） ──
  let alerts: BillingRequirementAlert[] = [];
  if (payerBasis !== 'self_pay' && args.pharmacistId) {
    alerts = await validateBillingRequirements({
      db,
      orgId: args.orgId,
      caseId: args.caseId,
      patientId: careCase.patient_id,
      pharmacistId: args.pharmacistId,
      visitType: args.visitType,
      proposedDate: args.targetDate,
      prescriptionCategory: args.prescriptionCategory,
      payerBasis,
      specialCapEligible: args.specialCapEligible,
      ...(args.excludeSupersededProposalScope
        ? { excludeSupersededProposalScope: args.excludeSupersededProposalScope }
        : {}),
      ...(args.cadenceScheduleRows ? { cadenceScheduleRows: args.cadenceScheduleRows } : {}),
      ...(args.cadenceProposalRows ? { cadenceProposalRows: args.cadenceProposalRows } : {}),
    });

    // severity: 'error' のアラートをブロッキングメッセージに変換
    for (const alert of alerts) {
      if (alert.severity === 'error') {
        blockingMessages.push(alert.message);
      }
    }
  }

  return { blockingMessages, alerts };
}

function dedupeBillingScheduleRows(rows: BillingCadenceScheduleRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key =
      row.id ??
      `${row.patient_id}:${row.pharmacist_id ?? ''}:${row.visit_type ?? ''}:${formatUtcDateKey(row.scheduled_date)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeBillingProposalRows(rows: BillingCadenceProposalRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key =
      row.id ??
      `${row.patient_id}:${row.case_id ?? ''}:${row.proposed_pharmacist_id ?? ''}:${row.visit_type ?? ''}:${formatUtcDateKey(row.proposed_date)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isProposalInSupersededScope(
  row: Pick<BillingCadenceProposalRow, 'case_id' | 'reschedule_source_schedule_id'>,
  scope: { caseId: string; rescheduleSourceScheduleId?: string | null },
) {
  return (
    row.case_id === scope.caseId &&
    (scope.rescheduleSourceScheduleId
      ? row.reschedule_source_schedule_id === scope.rescheduleSourceScheduleId
      : row.reschedule_source_schedule_id == null)
  );
}

function dedupeBillingAlerts(alerts: BillingRequirementAlert[]) {
  const seen = new Set<string>();

  return alerts.filter((alert) => {
    const key = `${alert.type}:${alert.severity}:${alert.message}:${JSON.stringify(alert.details)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

const authenticatedGET = withAuthContext(
  async (req: NextRequest, ctx: AuthContext) => {
    const { searchParams } = new URL(req.url);
    const query = parseProposalListQuery(searchParams);
    const assignmentWhere = buildVisitScheduleProposalAssignmentWhere(ctx);

    if (!query.ok) return query.response;

    const caseRelationWhere: Prisma.CareCaseWhereInput = {};
    if (query.patientId) {
      caseRelationWhere.patient_id = query.patientId;
    }
    if (query.query) {
      caseRelationWhere.patient = {
        is: {
          name: {
            contains: query.query,
            mode: 'insensitive',
          },
        },
      };
    }

    const proposalWhere: Prisma.VisitScheduleProposalWhereInput = {
      org_id: ctx.orgId,
      ...(query.caseId ? { case_id: query.caseId } : {}),
      ...(Object.keys(caseRelationWhere).length > 0 ? { case_: { is: caseRelationWhere } } : {}),
      ...(query.pharmacistId ? { proposed_pharmacist_id: query.pharmacistId } : {}),
      ...(query.status ? { proposal_status: query.status } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            proposed_date: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
      ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
    };

    if (query.view === 'palette') {
      const paletteLimit = query.limit ?? 8;
      const proposals = await prisma.visitScheduleProposal.findMany({
        where: proposalWhere,
        select: {
          id: true,
          display_id: true,
          proposal_status: true,
          patient_contact_status: true,
          proposed_date: true,
          time_window_start: true,
          time_window_end: true,
          proposed_pharmacist_id: true,
          case_: {
            select: {
              display_id: true,
              patient: {
                select: {
                  id: true,
                  display_id: true,
                  name: true,
                },
              },
            },
          },
        },
        orderBy: [{ proposed_date: 'asc' }, { time_window_start: 'asc' }],
        take: paletteLimit + 1,
      });
      const hasMore = proposals.length > paletteLimit;
      const dataRows = hasMore ? proposals.slice(0, paletteLimit) : proposals;
      const pharmacistIds = Array.from(
        new Set(
          dataRows
            .map((proposal) => proposal.proposed_pharmacist_id)
            .filter((id): id is string => Boolean(id)),
        ),
      );
      const pharmacists =
        pharmacistIds.length === 0
          ? []
          : await prisma.user.findMany({
              where: {
                org_id: ctx.orgId,
                id: { in: pharmacistIds },
              },
              select: {
                id: true,
                name: true,
              },
            });
      const pharmacistById = new Map(pharmacists.map((pharmacist) => [pharmacist.id, pharmacist]));

      return success({
        data: dataRows.map((proposal) => ({
          id: proposal.id,
          display_id: proposal.display_id,
          proposal_status: proposal.proposal_status,
          patient_contact_status: proposal.patient_contact_status,
          proposed_date: proposal.proposed_date,
          time_window_start: proposal.time_window_start,
          time_window_end: proposal.time_window_end,
          case_: {
            display_id: proposal.case_.display_id,
            patient: {
              id: proposal.case_.patient.id,
              display_id: proposal.case_.patient.display_id,
              name: proposal.case_.patient.name,
            },
          },
          proposed_pharmacist:
            proposal.proposed_pharmacist_id && pharmacistById.has(proposal.proposed_pharmacist_id)
              ? { name: pharmacistById.get(proposal.proposed_pharmacist_id)!.name }
              : null,
        })),
        hasMore,
      });
    }

    const proposals = await prisma.visitScheduleProposal.findMany({
      where: proposalWhere,
      include: {
        case_: {
          select: {
            display_id: true,
            patient: {
              select: {
                id: true,
                display_id: true,
                name: true,
                residences: {
                  where: { is_primary: true },
                  take: 1,
                  select: {
                    address: true,
                    building_id: true,
                    unit_name: true,
                    lat: true,
                    lng: true,
                  },
                },
              },
            },
          },
        },
        site: {
          select: {
            id: true,
            name: true,
            address: true,
            lat: true,
            lng: true,
          },
        },
        vehicle_resource: {
          select: {
            id: true,
            label: true,
            travel_mode: true,
            max_stops: true,
            max_route_duration_minutes: true,
          },
        },
        finalized_schedule: {
          select: {
            id: true,
            scheduled_date: true,
            pharmacist_id: true,
          },
        },
        reschedule_source_schedule: {
          select: {
            id: true,
            scheduled_date: true,
            pharmacist_id: true,
            override_request: {
              select: {
                status: true,
                impact_summary: true,
              },
            },
          },
        },
        contact_logs: {
          orderBy: { called_at: 'desc' },
          take: 10,
          select: {
            id: true,
            outcome: true,
            contact_method: true,
            callback_due_at: true,
            called_at: true,
            note: true,
          },
        },
      },
      orderBy: [{ proposed_date: 'asc' }, { time_window_start: 'asc' }],
      take: query.limit,
    });

    const pharmacistIds = Array.from(
      new Set(proposals.map((proposal) => proposal.proposed_pharmacist_id)),
    );
    const pharmacists =
      pharmacistIds.length === 0
        ? []
        : await prisma.user.findMany({
            where: {
              org_id: ctx.orgId,
              id: { in: pharmacistIds },
            },
            select: {
              id: true,
              name: true,
              name_kana: true,
            },
          });
    const pharmacistById = new Map(pharmacists.map((pharmacist) => [pharmacist.id, pharmacist]));

    return success({
      data: proposals.map((proposal) => ({
        ...redactProposalPatientFields(
          redactProposalContactLogs(omitProposalRejectReason(proposal)),
        ),
        proposed_pharmacist: pharmacistById.get(proposal.proposed_pharmacist_id) ?? null,
      })),
    });
  },
  {
    permission: 'canVisit',
    message: '訪問候補の閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};

const authenticatedPOST = withAuthContext(
  async (req: NextRequest, ctx: AuthContext) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = generateVisitScheduleProposalSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const caseAccessWhere = buildVisitScheduleProposalCaseAccessWhere(
      ctx,
      parsed.data.preferred_pharmacist_id,
    );
    const accessibleCase = await prisma.careCase.findFirst({
      where: {
        id: parsed.data.case_id,
        org_id: ctx.orgId,
        ...(caseAccessWhere ? { AND: [caseAccessWhere] } : {}),
      },
      select: { id: true, patient_id: true },
    });
    if (!accessibleCase) return notFound('ケースが見つかりません');

    const reproposalSourceProposal = parsed.data.reproposal_source_proposal_id
      ? await prisma.visitScheduleProposal.findFirst({
          where: {
            id: parsed.data.reproposal_source_proposal_id,
            org_id: ctx.orgId,
          },
          select: {
            id: true,
            case_id: true,
            proposal_status: true,
            patient_contact_status: true,
            reschedule_source_schedule_id: true,
          },
        })
      : null;
    if (parsed.data.reproposal_source_proposal_id && !reproposalSourceProposal) {
      return notFound('再提案元の訪問候補が見つかりません');
    }
    if (reproposalSourceProposal?.case_id !== undefined) {
      if (reproposalSourceProposal.case_id !== parsed.data.case_id) {
        return validationError('再提案元の訪問候補とケースが一致しません');
      }
      if (
        reproposalSourceProposal.proposal_status !== 'reschedule_pending' ||
        reproposalSourceProposal.patient_contact_status !== 'change_requested'
      ) {
        return validationError('変更希望として記録された訪問候補から再提案してください');
      }
      const sourceScheduleId = reproposalSourceProposal.reschedule_source_schedule_id ?? undefined;
      if (
        parsed.data.reschedule_source_schedule_id !== undefined &&
        parsed.data.reschedule_source_schedule_id !== sourceScheduleId
      ) {
        return validationError('再提案元の予定情報が一致しません');
      }
    }
    const resolvedRescheduleSourceScheduleId =
      parsed.data.reschedule_source_schedule_id ??
      reproposalSourceProposal?.reschedule_source_schedule_id ??
      undefined;
    const excludeSupersededProposalScope = {
      caseId: parsed.data.case_id,
      rescheduleSourceScheduleId: resolvedRescheduleSourceScheduleId ?? null,
    };

    const refResult = await validateOrgReferences(ctx.orgId, {
      case_id: parsed.data.case_id,
      ...(parsed.data.preferred_pharmacist_id
        ? { pharmacist_id: parsed.data.preferred_pharmacist_id }
        : {}),
      ...(resolvedRescheduleSourceScheduleId
        ? { schedule_id: resolvedRescheduleSourceScheduleId }
        : {}),
    });
    if (!refResult.ok) return refResult.response;

    const hasExplicitVisitType = Object.prototype.hasOwnProperty.call(payload, 'visit_type');
    // Auto-propagate visitType from active PrescriptionIntake when not provided
    let resolvedVisitType = parsed.data.visit_type;
    if (hasExplicitVisitType) {
      resolvedVisitType = parsed.data.visit_type;
    } else {
      const activeIntake = await findLatestPrescriptionIntakeClassification(prisma, {
        orgId: ctx.orgId,
        caseId: parsed.data.case_id,
      });
      resolvedVisitType =
        activeIntake?.prescription_category === 'emergency' ? 'emergency' : 'regular';
    }
    const hasExplicitPriority = Object.prototype.hasOwnProperty.call(payload, 'priority');
    const resolvedPriority =
      !hasExplicitPriority && resolvedVisitType === 'emergency'
        ? 'emergency'
        : parsed.data.priority;

    const vehicleResource = parsed.data.vehicle_resource_id
      ? await prisma.visitVehicleResource.findFirst({
          where: {
            org_id: ctx.orgId,
            id: parsed.data.vehicle_resource_id,
            available: true,
          },
          select: {
            id: true,
            site_id: true,
            label: true,
            travel_mode: true,
          },
        })
      : null;
    if (parsed.data.vehicle_resource_id && !vehicleResource) {
      return validationError('選択した車両リソースが見つからないか利用できません');
    }
    const effectiveTravelMode = vehicleResource?.travel_mode ?? parsed.data.travel_mode;
    const requestFingerprintInput: GenerateProposalFingerprintInput = {
      caseId: parsed.data.case_id,
      visitType: resolvedVisitType,
      priority: resolvedPriority,
      startDate: parsed.data.start_date,
      lockedDate: parsed.data.locked_date,
      candidateCount: parsed.data.candidate_count,
      travelMode: effectiveTravelMode,
      preferredTimeFrom: parsed.data.preferred_time_from,
      preferredTimeTo: parsed.data.preferred_time_to,
      preferredPharmacistId: parsed.data.preferred_pharmacist_id,
      vehicleResourceId: parsed.data.vehicle_resource_id,
      operatingDayOverrideReason: parsed.data.operating_day_override_reason,
      rescheduleSourceScheduleId: resolvedRescheduleSourceScheduleId,
      reproposalSourceProposalId: parsed.data.reproposal_source_proposal_id,
      specialCapEligible: parsed.data.special_cap_eligible,
    };
    const requestFingerprints = parsed.data.idempotency_key
      ? buildProposalRequestFingerprints(requestFingerprintInput)
      : null;
    if (parsed.data.idempotency_key && requestFingerprints) {
      const existingBatch = await prisma.visitScheduleProposalBatch.findUnique({
        where: {
          org_id_idempotency_key: {
            org_id: ctx.orgId,
            idempotency_key: parsed.data.idempotency_key,
          },
        },
        include: {
          proposals: {
            orderBy: { created_at: 'asc' },
          },
        },
      });
      if (existingBatch) {
        if (
          !matchesProposalRequestFingerprint(existingBatch.request_fingerprint, requestFingerprints)
        ) {
          return conflict('idempotency_key が別の訪問候補生成リクエストで使用されています');
        }
        return success(
          {
            data: omitProposalRejectReasons(existingBatch.proposals),
            alerts: [],
            diagnostics: {
              accepted: [],
              rejected: [],
            },
            replayed: true,
          },
          200,
        );
      }
    }

    const { blockingMessages, alerts: billingAlerts } = await validateProposalBillingExclusions({
      orgId: ctx.orgId,
      caseId: parsed.data.case_id,
      visitType: resolvedVisitType,
      targetDate: parsed.data.start_date ? new Date(parsed.data.start_date) : new Date(),
      prescriptionCategory: resolvedVisitType === 'emergency' ? 'emergency' : 'regular',
      specialCapEligible: parsed.data.special_cap_eligible,
    });
    if (blockingMessages.length > 0) {
      return validationError(blockingMessages.join(' / '));
    }

    let drafts;
    let plannerDiagnostics:
      | {
          accepted: Array<{
            pharmacist_id: string;
            pharmacist_name: string;
            site_id: string | null;
            site_name: string | null;
            proposed_date: string;
            travel_mode: string;
            route_order: number;
            route_distance_score: number;
            travel_summary: string;
            vehicle_resource_id: string | null;
            vehicle_resource_label: string | null;
            vehicle_load: number | null;
            assignment_mode: string;
            care_relationship: string;
            score: number;
            score_breakdown: Record<string, number>;
            specialty_coverage?: {
              required_labels: string[];
              missing_labels: string[];
              unknown_procedure_count: number;
              match_status: 'not_required' | 'matched' | 'unmatched' | 'unknown';
              source: 'user_visit_specialties_free_text';
            };
            time_window_start: Date;
            time_window_end: Date;
          }>;
          rejected: ProposalCandidateDiagnostic[];
        }
      | undefined;
    try {
      const plannerResult = await generateVisitScheduleProposalDrafts({
        orgId: ctx.orgId,
        caseId: parsed.data.case_id,
        visitType: resolvedVisitType,
        priority: resolvedPriority,
        candidateCount: parsed.data.candidate_count,
        travelMode: effectiveTravelMode,
        startDate: parsed.data.start_date ? new Date(parsed.data.start_date) : undefined,
        lockedDate: parsed.data.locked_date ? new Date(parsed.data.locked_date) : undefined,
        preferredTimeFrom: parsed.data.preferred_time_from,
        preferredTimeTo: parsed.data.preferred_time_to,
        preferredPharmacistId: parsed.data.preferred_pharmacist_id,
        vehicleResourceId: parsed.data.vehicle_resource_id,
        operatingDayOverrideReason: parsed.data.operating_day_override_reason,
        rescheduleSourceScheduleId: resolvedRescheduleSourceScheduleId,
      });
      drafts = plannerResult.drafts;
      plannerDiagnostics = plannerResult.diagnostics;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('VISIT_WORKFLOW_GATE:')) {
        const issues = error.message
          .replace('VISIT_WORKFLOW_GATE:', '')
          .split(',')
          .filter(Boolean) as VisitWorkflowGateIssue[];
        return validationError(formatVisitWorkflowGateIssues(issues));
      }
      throw error;
    }

    if (drafts.length === 0) {
      return validationError('シフト・休日・期限条件に合う候補を生成できませんでした', {
        rejections: plannerDiagnostics?.rejected ?? [],
      });
    }

    if (vehicleResource) {
      const mismatchedDraft = drafts.find((draft) => draft.site_id !== vehicleResource.site_id);
      if (mismatchedDraft) {
        return validationError('選択した車両リソースは訪問候補の拠点では利用できません');
      }
      drafts = drafts.map((draft) => ({
        ...draft,
        vehicle_resource_id: vehicleResource.id,
      }));
    }

    const perDraftValidationKeys = new Set<string>();
    const draftValidationPairs = await Promise.all(
      drafts.map(async (draft) => {
        const validationKey = `${draft.proposed_pharmacist_id}:${draft.proposed_date.toISOString()}`;
        if (perDraftValidationKeys.has(validationKey)) {
          return { draft, validation: null };
        }
        perDraftValidationKeys.add(validationKey);

        const validation = await validateProposalBillingExclusions({
          orgId: ctx.orgId,
          caseId: parsed.data.case_id,
          visitType: resolvedVisitType,
          targetDate: draft.proposed_date,
          pharmacistId: draft.proposed_pharmacist_id,
          prescriptionCategory: resolvedVisitType === 'emergency' ? 'emergency' : 'regular',
          specialCapEligible: parsed.data.special_cap_eligible,
          excludeSupersededProposalScope,
        });

        return { draft, validation };
      }),
    );

    const validationByKey = new Map(
      draftValidationPairs
        .filter(
          (
            pair,
          ): pair is {
            draft: (typeof drafts)[number];
            validation: NonNullable<typeof pair.validation>;
          } => pair.validation != null,
        )
        .map((pair) => [
          `${pair.draft.proposed_pharmacist_id}:${pair.draft.proposed_date.toISOString()}`,
          pair.validation,
        ]),
    );
    const validDrafts = drafts.filter((draft) => {
      const validation = validationByKey.get(
        `${draft.proposed_pharmacist_id}:${draft.proposed_date.toISOString()}`,
      );
      return (validation?.blockingMessages.length ?? 0) === 0;
    });
    const rejectedByBilling = drafts
      .filter((draft) => !validDrafts.includes(draft))
      .map((draft) => ({
        pharmacist_id: draft.proposed_pharmacist_id,
        pharmacist_name:
          plannerDiagnostics?.accepted.find(
            (item) =>
              item.pharmacist_id === draft.proposed_pharmacist_id &&
              item.proposed_date === formatUtcDateKey(draft.proposed_date),
          )?.pharmacist_name ?? draft.proposed_pharmacist_id,
        site_id: draft.site_id ?? null,
        site_name: null,
        proposed_date: formatUtcDateKey(draft.proposed_date),
        travel_mode: effectiveTravelMode,
        reason_code: 'billing_constraint' as const,
        reason_label: '算定制約',
        detail:
          validationByKey
            .get(`${draft.proposed_pharmacist_id}:${draft.proposed_date.toISOString()}`)
            ?.blockingMessages.join(' / ') ?? '算定要件を満たしません',
      }));
    const allBlockingMessages = Array.from(
      new Set([
        ...blockingMessages,
        ...Array.from(validationByKey.values()).flatMap(
          (validation) => validation.blockingMessages,
        ),
      ]),
    );
    if (validDrafts.length === 0) {
      return validationError(
        allBlockingMessages.join(' / ') || '算定要件を満たす訪問候補を生成できませんでした',
        {
          rejections: [...(plannerDiagnostics?.rejected ?? []), ...rejectedByBilling],
        },
      );
    }
    const allAlerts = dedupeBillingAlerts([
      ...billingAlerts,
      ...Array.from(validationByKey.values()).flatMap((validation) => validation.alerts),
    ]);
    const acceptedDiagnostics =
      plannerDiagnostics?.accepted.filter((item) =>
        validDrafts.some(
          (draft) =>
            draft.proposed_pharmacist_id === item.pharmacist_id &&
            formatUtcDateKey(draft.proposed_date) === item.proposed_date,
        ),
      ) ?? [];
    const requestFingerprint = requestFingerprints?.current ?? null;

    let proposalResult;
    try {
      proposalResult = await withSerializableProposalCreateTransaction(ctx.orgId, async (tx) => {
        let proposalBatchId: string | null = null;
        const idempotencyFingerprints = requestFingerprints;
        if (parsed.data.idempotency_key && requestFingerprint && idempotencyFingerprints) {
          const existingBatch = await tx.visitScheduleProposalBatch.findUnique({
            where: {
              org_id_idempotency_key: {
                org_id: ctx.orgId,
                idempotency_key: parsed.data.idempotency_key,
              },
            },
            include: {
              proposals: {
                orderBy: { created_at: 'asc' },
              },
            },
          });
          if (existingBatch) {
            if (
              !matchesProposalRequestFingerprint(
                existingBatch.request_fingerprint,
                idempotencyFingerprints,
              )
            ) {
              return { error: 'idempotency_conflict' as const };
            }
            return { proposals: existingBatch.proposals, replayed: true };
          }
        }

        const activeScheduleConflict = await tx.visitSchedule.findFirst({
          where: {
            org_id: ctx.orgId,
            case_id: parsed.data.case_id,
            visit_type: resolvedVisitType,
            scheduled_date: {
              in: Array.from(
                new Map(
                  validDrafts.map((draft) => [
                    formatUtcDateKey(draft.proposed_date),
                    draft.proposed_date,
                  ]),
                ).values(),
              ),
            },
            schedule_status: { notIn: ['cancelled', 'rescheduled'] },
          },
          select: { id: true },
        });
        if (activeScheduleConflict) {
          return { error: 'duplicate_active_schedule' as const };
        }

        const routeCells = new Map<string, { pharmacistId: string; date: Date }>();
        for (const draft of validDrafts) {
          const key = buildProposalRouteCellKey({
            pharmacistId: draft.proposed_pharmacist_id,
            date: draft.proposed_date,
          });
          if (routeCells.has(key)) {
            return { error: 'duplicate_open_proposal' as const };
          }
          routeCells.set(key, {
            pharmacistId: draft.proposed_pharmacist_id,
            date: draft.proposed_date,
          });
        }
        const collidingOpenProposals = await tx.visitScheduleProposal.findMany({
          where: {
            org_id: ctx.orgId,
            case_id: parsed.data.case_id,
            finalized_schedule_id: null,
            proposal_status: { in: OPEN_VISIT_SCHEDULE_PROPOSAL_STATUSES },
            OR: Array.from(routeCells.values()).map((cell) => ({
              proposed_pharmacist_id: cell.pharmacistId,
              proposed_date: cell.date,
            })),
          },
          select: {
            id: true,
            case_id: true,
            proposed_date: true,
            proposed_pharmacist_id: true,
            reschedule_source_schedule_id: true,
          },
        });
        const duplicateOpenProposal = collidingOpenProposals.find(
          (proposal) => !isProposalInSupersededScope(proposal, excludeSupersededProposalScope),
        );
        if (duplicateOpenProposal) {
          return { error: 'duplicate_open_proposal' as const };
        }

        const billingGuardRowsByPharmacist = await Promise.all(
          Array.from(new Set(validDrafts.map((draft) => draft.proposed_pharmacist_id))).map(
            (pharmacistId) =>
              loadVisitScheduleBillingGuardRows({
                db: tx,
                orgId: ctx.orgId,
                patientId: accessibleCase.patient_id,
                pharmacistId,
                dates: validDrafts.map((draft) => draft.proposed_date),
              }),
          ),
        );
        const cadenceScheduleRows = dedupeBillingScheduleRows(
          billingGuardRowsByPharmacist.flatMap((rows) => rows.cadenceScheduleRows),
        );
        const baseCadenceProposalRows = dedupeBillingProposalRows(
          billingGuardRowsByPharmacist.flatMap((rows) => rows.cadenceProposalRows),
        ).filter((row) => !isProposalInSupersededScope(row, excludeSupersededProposalScope));
        const provisionalProposalRows: BillingCadenceProposalRow[] = [];
        const transactionBlockingMessages = new Set<string>();
        for (const [index, draft] of validDrafts.entries()) {
          const validation = await validateProposalBillingExclusions({
            db: tx,
            orgId: ctx.orgId,
            caseId: parsed.data.case_id,
            visitType: resolvedVisitType,
            targetDate: draft.proposed_date,
            pharmacistId: draft.proposed_pharmacist_id,
            prescriptionCategory: resolvedVisitType === 'emergency' ? 'emergency' : 'regular',
            specialCapEligible: parsed.data.special_cap_eligible,
            cadenceScheduleRows,
            cadenceProposalRows: [...baseCadenceProposalRows, ...provisionalProposalRows],
          });
          for (const message of validation.blockingMessages) {
            transactionBlockingMessages.add(message);
          }
          if (transactionBlockingMessages.size > 0) {
            return {
              error: 'billing_cap_exceeded' as const,
              message: Array.from(transactionBlockingMessages).join(' / '),
            };
          }
          provisionalProposalRows.push({
            id: `pending:${index}:${draft.proposed_pharmacist_id}:${formatUtcDateKey(draft.proposed_date)}`,
            case_id: parsed.data.case_id,
            patient_id: accessibleCase.patient_id,
            proposed_date: draft.proposed_date,
            proposed_pharmacist_id: draft.proposed_pharmacist_id,
            visit_type: resolvedVisitType,
            proposal_batch_id: null,
            finalized_schedule_id: null,
            reschedule_source_schedule_id:
              resolvedRescheduleSourceScheduleId ?? draft.reschedule_source_schedule_id ?? null,
          });
        }

        if (parsed.data.idempotency_key && requestFingerprint && idempotencyFingerprints) {
          const batch = await tx.visitScheduleProposalBatch.create({
            data: {
              org_id: ctx.orgId,
              case_id: parsed.data.case_id,
              idempotency_key: parsed.data.idempotency_key,
              request_fingerprint: requestFingerprint,
              created_by: ctx.userId,
            },
          });
          proposalBatchId = batch.id;
        }

        await tx.visitScheduleProposal.updateMany({
          where: {
            org_id: ctx.orgId,
            case_id: parsed.data.case_id,
            proposal_status: {
              in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
            },
            ...(resolvedRescheduleSourceScheduleId
              ? { reschedule_source_schedule_id: resolvedRescheduleSourceScheduleId }
              : { reschedule_source_schedule_id: null }),
          },
          data: {
            proposal_status: 'superseded',
          },
        });

        const allocatedDrafts = await allocateProposalRouteOrders(tx, {
          orgId: ctx.orgId,
          drafts: validDrafts,
        });

        const created = await Promise.all(
          allocatedDrafts.map((draft) =>
            tx.visitScheduleProposal.create({
              data: {
                ...draft,
                proposal_batch_id: proposalBatchId,
                reschedule_source_schedule_id:
                  resolvedRescheduleSourceScheduleId ?? draft.reschedule_source_schedule_id,
                reproposal_source_proposal_id: parsed.data.reproposal_source_proposal_id ?? null,
              },
            }),
          ),
        );

        await Promise.all(
          created.map((proposal) => {
            const acceptedDiagnostic =
              acceptedDiagnostics.find(
                (item) =>
                  item.pharmacist_id === proposal.proposed_pharmacist_id &&
                  item.proposed_date === formatUtcDateKey(proposal.proposed_date),
              ) ?? null;

            return createAuditLogEntry(tx, ctx, {
              action: 'visit_schedule_proposals_created',
              targetType: 'VisitScheduleProposal',
              targetId: proposal.id,
              changes: {
                proposal_batch_id: proposalBatchId,
                reproposal_source_proposal_id: parsed.data.reproposal_source_proposal_id ?? null,
                reschedule_source_schedule_id: resolvedRescheduleSourceScheduleId ?? null,
                diagnostics: {
                  accepted: acceptedDiagnostic ? [acceptedDiagnostic] : [],
                  rejected: [...(plannerDiagnostics?.rejected ?? []), ...rejectedByBilling],
                },
                operating_day_override_reason: parsed.data.operating_day_override_reason ?? null,
              },
            });
          }),
        );

        if (parsed.data.reproposal_source_proposal_id) {
          await resolveOperationalTasks(tx, {
            orgId: ctx.orgId,
            dedupeKey: buildVisitScheduleReproposalTaskKey(
              parsed.data.reproposal_source_proposal_id,
            ),
            status: 'completed',
          });
        }

        return { proposals: created, replayed: false };
      });
    } catch (cause: unknown) {
      if (cause instanceof VisitProposalCreateRetryLimitError) {
        proposalResult = null;
      } else if (
        isProposalBatchIdempotencyRace(cause) &&
        parsed.data.idempotency_key &&
        requestFingerprints
      ) {
        const racedBatch = await prisma.visitScheduleProposalBatch.findUnique({
          where: {
            org_id_idempotency_key: {
              org_id: ctx.orgId,
              idempotency_key: parsed.data.idempotency_key,
            },
          },
          include: {
            proposals: {
              orderBy: { created_at: 'asc' },
            },
          },
        });
        if (!racedBatch) {
          proposalResult = null;
        } else if (
          !matchesProposalRequestFingerprint(racedBatch.request_fingerprint, requestFingerprints)
        ) {
          proposalResult = { error: 'idempotency_conflict' as const };
        } else {
          proposalResult = { proposals: racedBatch.proposals, replayed: true };
        }
      } else {
        throw cause;
      }
    }

    if (!proposalResult) {
      return conflict('訪問候補の生成が同時に更新されました。再読み込みしてください');
    }
    if ('error' in proposalResult) {
      if (proposalResult.error === 'billing_cap_exceeded') {
        return validationError(proposalResult.message);
      }
      if (proposalResult.error === 'duplicate_active_schedule') {
        return conflict(
          '同一ケース・同一日付の訪問予定が既に存在します。既存予定を確認してください',
        );
      }
      if (proposalResult.error === 'duplicate_open_proposal') {
        return conflict(
          '同一ケース・同一日付・同一担当薬剤師の未確定候補が既に存在します。既存候補を編集してください',
        );
      }
      return conflict('idempotency_key が別の訪問候補生成リクエストで使用されています');
    }

    if (!proposalResult.replayed) {
      await notifyWorkflowMutation({
        orgId: ctx.orgId,
        payload: { source: 'visit_schedule_proposals_create', case_id: parsed.data.case_id },
      });
    }

    return success(
      {
        data: omitProposalRejectReasons(proposalResult.proposals),
        alerts: allAlerts,
        diagnostics: {
          accepted: acceptedDiagnostics,
          rejected: [...(plannerDiagnostics?.rejected ?? []), ...rejectedByBilling],
        },
        replayed: proposalResult.replayed,
      },
      proposalResult.replayed ? 200 : 201,
    );
  },
  {
    permission: 'canVisit',
    message: '訪問候補の生成権限がありません',
  },
);

export const POST: typeof authenticatedPOST = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};

// ── 単一レコードの「予定を作成・編集」ドロワー用 (p0_18) ──
// 既存の VisitProposalStatus を使い、下書き = proposed / 確認待ち = patient_contact_pending を表現する。
// スキーマフィールドは追加しない。
const draftProposalTimeSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, '時刻形式が不正です（HH:mm）');

const upsertDraftProposalSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    case_id: z.string().min(1, 'ケースは必須です'),
    visit_type: z.enum(visitTypeValues).default('regular'),
    priority: z.enum(visitPriorityValues).default('normal'),
    proposed_date: visitScheduleDateKeySchema('日付形式が不正です（YYYY-MM-DD）'),
    time_window_start: draftProposalTimeSchema.optional(),
    time_window_end: draftProposalTimeSchema.optional(),
    proposed_pharmacist_id: z.string().min(1, '担当薬剤師は必須です'),
    vehicle_resource_id: z.string().trim().min(1).optional(),
    travel_mode: z.enum(['DRIVE', 'BICYCLE', 'WALK', 'TWO_WHEELER']).default('DRIVE'),
    proposal_reason: z.string().trim().max(500).optional(),
    patient_contact_status: z.enum(patientContactStatusValues).optional(),
    // true: 確認待ち (patient_contact_pending) へ遷移 / false: 下書き (proposed) のまま
    submit_for_contact: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.time_window_start && !data.time_window_end) {
      ctx.addIssue({
        code: 'custom',
        path: ['time_window_end'],
        message: '終了時刻も入力してください',
      });
    }
    if (!data.time_window_start && data.time_window_end) {
      ctx.addIssue({
        code: 'custom',
        path: ['time_window_start'],
        message: '開始時刻も入力してください',
      });
    }
    if (data.submit_for_contact && (!data.time_window_start || !data.time_window_end)) {
      ctx.addIssue({
        code: 'custom',
        path: ['time_window_start'],
        message: '確認待ちにするには開始時刻と終了時刻を入力してください',
      });
    }
    if (
      data.time_window_start &&
      data.time_window_end &&
      data.time_window_end <= data.time_window_start
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['time_window_end'],
        message: '終了時刻は開始時刻より後にしてください',
      });
    }
    if (data.patient_contact_status && data.patient_contact_status !== 'pending') {
      ctx.addIssue({
        code: 'custom',
        path: ['patient_contact_status'],
        message: '患者連絡状態は患者連絡ワークフローで連絡結果として記録してください',
      });
    }
  });

function toProposalTimeDate(value: string | undefined): Date | null {
  if (!value) return null;
  return hhmmToTimeDate(value);
}

function proposalDraftAuditChanges(input: {
  from?: {
    case_id: string;
    site_id: string | null;
    visit_type: string;
    priority: string;
    proposal_status: string;
    proposed_date: Date;
    time_window_start: Date | null;
    time_window_end: Date | null;
    proposed_pharmacist_id: string;
    vehicle_resource_id: string | null;
  };
  to: {
    case_id: string;
    site_id: string | null;
    visit_type: string;
    priority: string;
    proposal_status: string;
    proposed_date: Date;
    time_window_start: Date | null;
    time_window_end: Date | null;
    proposed_pharmacist_id: string;
    vehicle_resource_id: string | null;
  };
  submittedForContact: boolean;
}) {
  const toValues = {
    caseId: input.to.case_id,
    siteId: input.to.site_id,
    visitType: input.to.visit_type,
    priority: input.to.priority,
    proposalStatus: input.to.proposal_status,
    proposedDate: formatUtcDateKey(input.to.proposed_date),
    timeWindowStart: timeDateToString(input.to.time_window_start) ?? null,
    timeWindowEnd: timeDateToString(input.to.time_window_end) ?? null,
    pharmacistId: input.to.proposed_pharmacist_id,
    vehicleResourceId: input.to.vehicle_resource_id,
  };
  if (!input.from) {
    return {
      caseIdTo: toValues.caseId,
      siteIdTo: toValues.siteId,
      visitTypeTo: toValues.visitType,
      priorityTo: toValues.priority,
      proposalStatusTo: toValues.proposalStatus,
      proposedDateTo: toValues.proposedDate,
      timeWindowStartTo: toValues.timeWindowStart,
      timeWindowEndTo: toValues.timeWindowEnd,
      pharmacistIdTo: toValues.pharmacistId,
      vehicleResourceIdTo: toValues.vehicleResourceId,
      submittedForContact: input.submittedForContact,
    };
  }

  const changes: Record<string, string | null | boolean> = {
    submittedForContact: input.submittedForContact,
  };
  const add = (key: string, fromValue: string | null, toValue: string | null) => {
    if (fromValue === toValue) return;
    changes[`${key}From`] = fromValue;
    changes[`${key}To`] = toValue;
  };

  add('caseId', input.from.case_id, toValues.caseId);
  add('siteId', input.from.site_id, toValues.siteId);
  add('visitType', input.from.visit_type, toValues.visitType);
  add('priority', input.from.priority, toValues.priority);
  add('proposalStatus', input.from.proposal_status, toValues.proposalStatus);
  add('proposedDate', formatUtcDateKey(input.from.proposed_date), toValues.proposedDate);
  add(
    'timeWindowStart',
    timeDateToString(input.from.time_window_start) ?? null,
    toValues.timeWindowStart,
  );
  add(
    'timeWindowEnd',
    timeDateToString(input.from.time_window_end) ?? null,
    toValues.timeWindowEnd,
  );
  add('pharmacistId', input.from.proposed_pharmacist_id, toValues.pharmacistId);
  add('vehicleResourceId', input.from.vehicle_resource_id, toValues.vehicleResourceId);

  return {
    ...changes,
  };
}

/**
 * 単一の訪問予定を下書き保存 / 確認待ちにする。
 *
 * - id 未指定: 新規作成（下書き or 確認待ち）
 * - id 指定: 既存の下書き / 確認待ち提案を更新（confirmed 以降は不可）
 *
 * 下書き = proposal_status 'proposed' / 確認待ち = 'patient_contact_pending' を
 * 既存の enum で表現し、スキーマフィールドは追加しない。
 */
const authenticatedPUT = withAuthContext(
  async (req: NextRequest, ctx: AuthContext) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = upsertDraftProposalSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const input = parsed.data;

    const caseAccessWhere = buildVisitScheduleProposalCaseAccessWhere(
      ctx,
      input.proposed_pharmacist_id,
    );
    const accessibleCase = await prisma.careCase.findFirst({
      where: {
        id: input.case_id,
        org_id: ctx.orgId,
        ...(caseAccessWhere ? { AND: [caseAccessWhere] } : {}),
      },
      select: { id: true },
    });
    if (!accessibleCase) return notFound('ケースが見つかりません');

    const refResult = await validateOrgReferences(ctx.orgId, {
      case_id: input.case_id,
      pharmacist_id: input.proposed_pharmacist_id,
    });
    if (!refResult.ok) return refResult.response;

    // 担当薬剤師の所属拠点を訪問先拠点として継承（任意項目）
    const pharmacistMembership = await prisma.membership.findFirst({
      where: {
        user_id: input.proposed_pharmacist_id,
        org_id: ctx.orgId,
        is_active: true,
      },
      select: { site_id: true },
    });

    let vehicleResource: { id: string; site_id: string | null } | null = null;
    if (input.vehicle_resource_id) {
      vehicleResource = await prisma.visitVehicleResource.findFirst({
        where: {
          org_id: ctx.orgId,
          id: input.vehicle_resource_id,
          available: true,
        },
        select: { id: true, site_id: true },
      });
      if (!vehicleResource) {
        return validationError('選択した車両リソースが見つからないか利用できません');
      }
    }

    const targetStatus = input.submit_for_contact ? 'patient_contact_pending' : 'proposed';
    const resolvedSiteId = vehicleResource?.site_id ?? pharmacistMembership?.site_id ?? null;
    const proposedDate = new Date(input.proposed_date);

    const existing = input.id
      ? await prisma.visitScheduleProposal.findFirst({
          where: { id: input.id, org_id: ctx.orgId },
          select: {
            id: true,
            proposal_status: true,
            patient_contact_status: true,
            finalized_schedule_id: true,
            proposed_pharmacist_id: true,
            proposed_date: true,
            case_id: true,
            site_id: true,
            visit_type: true,
            priority: true,
            time_window_start: true,
            time_window_end: true,
            vehicle_resource_id: true,
          },
        })
      : null;
    if (input.id && !existing) {
      return notFound('訪問予定が見つかりません');
    }
    if (existing && !['proposed', 'patient_contact_pending'].includes(existing.proposal_status)) {
      return validationError('下書き / 確認待ちの予定のみ編集できます');
    }
    if (
      existing &&
      (existing.finalized_schedule_id || existing.patient_contact_status !== 'pending')
    ) {
      return conflict(
        'この候補はすでに患者連絡が始まっています。候補詳細の患者連絡フローで更新してください',
      );
    }

    const proposal = await withSerializableProposalCreateTransaction(ctx.orgId, async (tx) => {
      const [duplicateOpenProposal] = await tx.visitScheduleProposal.findMany({
        where: {
          org_id: ctx.orgId,
          ...(existing ? { id: { not: existing.id } } : {}),
          case_id: input.case_id,
          proposed_date: proposedDate,
          proposed_pharmacist_id: input.proposed_pharmacist_id,
          finalized_schedule_id: null,
          proposal_status: { in: OPEN_VISIT_SCHEDULE_PROPOSAL_STATUSES },
        },
        select: { id: true },
        take: 1,
      });
      if (duplicateOpenProposal) {
        return { error: 'duplicate_open_proposal' as const };
      }

      const duplicateActiveSchedule = await tx.visitSchedule.findFirst({
        where: {
          org_id: ctx.orgId,
          case_id: input.case_id,
          visit_type: input.visit_type,
          scheduled_date: proposedDate,
          schedule_status: { notIn: ['cancelled', 'rescheduled'] },
        },
        select: { id: true },
      });
      if (duplicateActiveSchedule) {
        return { error: 'duplicate_active_schedule' as const };
      }

      if (existing) {
        const claim = await tx.visitScheduleProposal.updateMany({
          where: {
            id: existing.id,
            org_id: ctx.orgId,
            proposal_status: { in: ['proposed', 'patient_contact_pending'] },
            patient_contact_status: 'pending',
            finalized_schedule_id: null,
          },
          data: {
            case_id: input.case_id,
            site_id: resolvedSiteId,
            visit_type: input.visit_type,
            priority: input.priority,
            proposal_status: targetStatus,
            proposed_date: proposedDate,
            time_window_start: toProposalTimeDate(input.time_window_start),
            time_window_end: toProposalTimeDate(input.time_window_end),
            proposed_pharmacist_id: input.proposed_pharmacist_id,
            vehicle_resource_id: vehicleResource?.id ?? null,
            ...(input.proposal_reason !== undefined
              ? { proposal_reason: input.proposal_reason }
              : {}),
          },
        });
        if (claim.count !== 1) {
          return { error: 'state_changed' as const };
        }

        const updated = await tx.visitScheduleProposal.findFirst({
          where: { id: existing.id, org_id: ctx.orgId },
        });
        if (!updated) {
          return { error: 'state_changed' as const };
        }

        await createAuditLogEntry(tx, ctx, {
          action: 'visit_schedule_proposal_draft_updated',
          targetType: 'VisitScheduleProposal',
          targetId: updated.id,
          changes: {
            ...proposalDraftAuditChanges({
              from: existing,
              to: updated,
              submittedForContact: input.submit_for_contact,
            }),
          },
        });

        return updated;
      }

      const created = await tx.visitScheduleProposal.create({
        data: {
          org_id: ctx.orgId,
          case_id: input.case_id,
          site_id: resolvedSiteId,
          visit_type: input.visit_type,
          priority: input.priority,
          proposal_status: targetStatus,
          patient_contact_status: 'pending',
          proposed_date: proposedDate,
          time_window_start: toProposalTimeDate(input.time_window_start),
          time_window_end: toProposalTimeDate(input.time_window_end),
          proposed_pharmacist_id: input.proposed_pharmacist_id,
          vehicle_resource_id: vehicleResource?.id ?? null,
          proposal_reason: input.proposal_reason ?? '手動作成（予定を作成・編集）',
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'visit_schedule_proposal_draft_created',
        targetType: 'VisitScheduleProposal',
        targetId: created.id,
        changes: {
          ...proposalDraftAuditChanges({
            to: created,
            submittedForContact: input.submit_for_contact,
          }),
        },
      });

      return created;
    }).catch((cause: unknown) => {
      if (cause instanceof VisitProposalCreateRetryLimitError) {
        return null;
      }
      throw cause;
    });

    if (!proposal) {
      return conflict('訪問候補の保存が同時に更新されました。再読み込みしてください');
    }
    if ('error' in proposal) {
      if (proposal.error === 'duplicate_open_proposal') {
        return conflict(
          '同一ケース・同一日付・同一担当薬剤師の未確定候補が既に存在します。既存候補を編集してください',
        );
      }
      if (proposal.error === 'duplicate_active_schedule') {
        return conflict(
          '同一ケース・同一日付の訪問予定が既に存在します。既存予定を確認してください',
        );
      }
      return conflict('この候補はすでに確定または変更されています。再読み込みしてください');
    }

    await notifyWorkflowMutation({
      orgId: ctx.orgId,
      payload: { source: 'visit_schedule_proposals_create', case_id: input.case_id },
    });

    return success({ data: omitProposalRejectReason(proposal) }, input.id ? 200 : 201);
  },
  {
    permission: 'canVisit',
    message: '訪問予定の作成・編集権限がありません',
  },
);

export const PUT: typeof authenticatedPUT = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPUT(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
