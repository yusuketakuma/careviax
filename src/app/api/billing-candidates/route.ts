import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { buildCursorPage, parsePaginationParams } from '@/lib/api/pagination';
import { readStrictOptionalSearchParam } from '@/lib/api/search-params';
import { prisma } from '@/lib/db/client';
import { readJsonObject, readJsonObjectString } from '@/lib/db/json';
import { readBillingValidationLayers } from '@/lib/billing/validation-layers';
import {
  getBillingCandidateWorkbenchSummary,
  generateBillingCandidatesForMonth,
  japanMonthRangeForBillingMonth,
  upsertBillingEvidenceForVisit,
} from '@/server/services/billing-evidence';
import { generatePcaRentalBillingCandidatesForMonth } from '@/server/services/pca-rental-billing';
import { BILLING_DOMAIN_ERROR_MESSAGE, parseOptionalBillingDomain } from './billing-domain';
import { BILLING_MONTH_FORMAT_MESSAGE, parseStrictBillingMonth } from './billing-month';

const BILLING_CANDIDATE_STATUSES = ['candidate', 'confirmed', 'excluded', 'exported'] as const;
type BillingCandidateStatus = (typeof BILLING_CANDIDATE_STATUSES)[number];

function readWorkflowState(sourceSnapshot: unknown) {
  const state = readJsonObject(readJsonObject(sourceSnapshot)?.billing_close);
  if (!state) return null;
  return {
    review_state: readJsonObjectString(state, 'review_state'),
    resolution_state: readJsonObjectString(state, 'resolution_state'),
  };
}

function readBillingTargetName(candidate: {
  billing_target_name?: string | null;
  source_snapshot: unknown;
}) {
  if (candidate.billing_target_name) return candidate.billing_target_name;
  const target = readJsonObject(readJsonObject(candidate.source_snapshot)?.billing_target);
  return typeof target?.name === 'string' ? target.name : null;
}

function readStringField(source: Record<string, unknown>, key: string) {
  return typeof source[key] === 'string' ? source[key] : undefined;
}

function sanitizeBillingAssignmentSnapshot(value: unknown) {
  const assignment = readJsonObject(value);
  if (!assignment) return null;

  return {
    building_id: readStringField(assignment, 'building_id') ?? null,
    unit_name: readStringField(assignment, 'unit_name') ?? null,
    assignment_scope: readStringField(assignment, 'assignment_scope'),
    building_patient_count:
      typeof assignment.building_patient_count === 'number'
        ? assignment.building_patient_count
        : null,
    unit_patient_count:
      typeof assignment.unit_patient_count === 'number' ? assignment.unit_patient_count : null,
  };
}

function sanitizeBillingCandidateSourceSnapshot(sourceSnapshot: unknown) {
  const source = readJsonObject(sourceSnapshot);
  if (!source) return null;

  return {
    billing_scope: readStringField(source, 'billing_scope'),
    selection_mode: readStringField(source, 'selection_mode'),
    source_note: readStringField(source, 'source_note'),
    ruleset_version: readStringField(source, 'ruleset_version'),
    revision_code: readStringField(source, 'revision_code'),
    site_config_revision_code: readStringField(source, 'site_config_revision_code'),
    site_config_status: readStringField(source, 'site_config_status'),
    source_type: readStringField(source, 'source_type'),
    billing_fee_type: readStringField(source, 'billing_fee_type'),
    duplicate_interaction_fee_type: readStringField(source, 'duplicate_interaction_fee_type'),
    billing_assignment: sanitizeBillingAssignmentSnapshot(source.billing_assignment),
    validation_layers: readBillingValidationLayers({
      validation_layers: source.validation_layers,
    }),
  };
}

function parseBillingCandidateListFilters(searchParams: URLSearchParams) {
  const billingMonthResult = readStrictOptionalSearchParam(searchParams, 'billing_month', {
    blank: BILLING_MONTH_FORMAT_MESSAGE,
    invalid: BILLING_MONTH_FORMAT_MESSAGE,
  });
  if (!billingMonthResult.ok) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', billingMonthResult.fieldErrors),
    };
  }

  const parsedBillingMonth = billingMonthResult.value
    ? parseStrictBillingMonth(billingMonthResult.value)
    : null;
  if (billingMonthResult.value && !parsedBillingMonth) {
    return {
      ok: false as const,
      response: validationError(BILLING_MONTH_FORMAT_MESSAGE),
    };
  }

  const patientResult = readStrictOptionalSearchParam(searchParams, 'patient_id', {
    blank: '患者IDを指定してください',
    invalid: '患者IDの形式が不正です',
  });
  if (!patientResult.ok) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', patientResult.fieldErrors),
    };
  }

  const statusResult = readStrictOptionalSearchParam(searchParams, 'status', {
    blank: 'ステータスを指定してください',
    invalid: '対応していないステータスです',
  });
  if (!statusResult.ok) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', statusResult.fieldErrors),
    };
  }
  if (
    statusResult.value &&
    !BILLING_CANDIDATE_STATUSES.includes(statusResult.value as BillingCandidateStatus)
  ) {
    return {
      ok: false as const,
      response: validationError('請求候補ステータスが不正です', {
        status: ['対応していないステータスです'],
      }),
    };
  }

  const billingDomainResult = readStrictOptionalSearchParam(searchParams, 'billing_domain', {
    blank: 'billing_domain を指定してください',
    invalid: BILLING_DOMAIN_ERROR_MESSAGE,
  });
  if (!billingDomainResult.ok) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', billingDomainResult.fieldErrors),
    };
  }

  const requestedBillingDomain = parseOptionalBillingDomain(billingDomainResult.value);
  if (requestedBillingDomain === null) {
    return {
      ok: false as const,
      response: validationError(BILLING_DOMAIN_ERROR_MESSAGE),
    };
  }

  return {
    ok: true as const,
    billingMonth: parsedBillingMonth,
    patientId: patientResult.value,
    status: statusResult.value as BillingCandidateStatus | undefined,
    billingDomain: requestedBillingDomain ?? 'home_care',
  };
}

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);

    const filters = parseBillingCandidateListFilters(searchParams);
    if (!filters.ok) return filters.response;

    const result = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const candidates = await tx.billingCandidate.findMany({
          where: {
            org_id: ctx.orgId,
            ...(filters.billingMonth ? { billing_month: filters.billingMonth.start } : {}),
            ...(filters.patientId ? { patient_id: filters.patientId } : {}),
            billing_domain: filters.billingDomain,
            ...(filters.status ? { status: filters.status } : {}),
          },
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          orderBy: [{ billing_month: 'desc' }, { created_at: 'desc' }],
          select: {
            id: true,
            patient_id: true,
            billing_domain: true,
            billing_target_type: true,
            billing_target_id: true,
            billing_target_name: true,
            billing_month: true,
            billing_code: true,
            billing_name: true,
            points: true,
            quantity: true,
            calculation_breakdown: true,
            status: true,
            exclusion_reason: true,
            source_snapshot: true,
            updated_at: true,
          },
        });
        const summary = filters.billingMonth
          ? await getBillingCandidateWorkbenchSummary(tx, {
              orgId: ctx.orgId,
              billingMonth: filters.billingMonth.start,
              patientId: filters.patientId,
              billingDomain: filters.billingDomain,
            })
          : null;

        const patientIds = [
          ...new Set(
            candidates
              .map((c) => c.patient_id)
              .filter((value): value is string => typeof value === 'string' && value.length > 0),
          ),
        ];
        const patients =
          patientIds.length === 0
            ? []
            : await tx.patient.findMany({
                where: { org_id: ctx.orgId, id: { in: patientIds } },
                select: { id: true, name: true },
              });
        const patientNameMap = new Map(patients.map((p) => [p.id, p.name]));

        return { candidates, summary, patientNameMap };
      },
      { requestContext: ctx, maxWaitMs: 10_000, timeoutMs: 20_000 },
    );

    const candidates = result.candidates.map((candidate) => {
      const patientName = candidate.patient_id
        ? (result.patientNameMap.get(candidate.patient_id) ?? null)
        : null;
      return {
        id: candidate.id,
        patient_id: candidate.patient_id,
        patient_name: patientName,
        billing_domain: candidate.billing_domain,
        billing_target_type: candidate.billing_target_type,
        billing_target_id: candidate.billing_target_id,
        billing_target_name: candidate.billing_target_name,
        billing_target_label:
          candidate.billing_target_type === 'institution'
            ? readBillingTargetName(candidate)
            : candidate.patient_id
              ? (patientName ?? candidate.patient_id)
              : readBillingTargetName(candidate),
        billing_month: candidate.billing_month,
        billing_code: candidate.billing_code,
        billing_name: candidate.billing_name,
        points: candidate.points,
        quantity: candidate.quantity,
        calculation_breakdown: candidate.calculation_breakdown,
        status: candidate.status,
        exclusion_reason: candidate.exclusion_reason,
        updated_at: candidate.updated_at,
        source_snapshot: sanitizeBillingCandidateSourceSnapshot(candidate.source_snapshot),
        workflow_state: readWorkflowState(candidate.source_snapshot),
        effective_revision_code: readJsonObjectString(candidate.source_snapshot, 'revision_code'),
        site_config_revision_code: readJsonObjectString(
          candidate.source_snapshot,
          'site_config_revision_code',
        ),
        site_config_status: readJsonObjectString(candidate.source_snapshot, 'site_config_status'),
      };
    });

    const page = buildCursorPage(candidates, limit, (candidate) => candidate.id);

    return success({
      data: page.data,
      meta: {
        limit,
        has_more: page.hasMore,
        next_cursor: page.nextCursor ?? null,
        summary: result.summary,
      },
    });
  },
  {
    permission: 'canManageBilling',
    message: '請求候補の閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = Object.assign(
  async (...args: Parameters<typeof authenticatedGET>) =>
    withSensitiveNoStore(await authenticatedGET(...args)),
  authenticatedGET,
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const { billing_month } = payload;
    if (!billing_month) return validationError('billing_month は必須です');
    const billingDomain = parseOptionalBillingDomain(payload.billing_domain);
    if (billingDomain === null) {
      return validationError(BILLING_DOMAIN_ERROR_MESSAGE);
    }

    const billingMonth = parseStrictBillingMonth(billing_month);
    if (!billingMonth) {
      return validationError(BILLING_MONTH_FORMAT_MESSAGE);
    }

    const generateHomeCare = billingDomain === undefined || billingDomain === 'home_care';
    const generatePcaRental = billingDomain === undefined || billingDomain === 'pca_rental';

    const billingMonthRange = generateHomeCare
      ? japanMonthRangeForBillingMonth(billingMonth.start)
      : null;
    const visitRecords = billingMonthRange
      ? await prisma.visitRecord.findMany({
          where: {
            org_id: ctx.orgId,
            visit_date: {
              gte: billingMonthRange.start,
              lt: billingMonthRange.nextStart,
            },
          },
          select: {
            id: true,
          },
        })
      : [];

    const created = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        if (generateHomeCare) {
          for (const visitRecord of visitRecords) {
            await upsertBillingEvidenceForVisit(tx, {
              orgId: ctx.orgId,
              visitRecordId: visitRecord.id,
            });
          }
        }

        const candidates = generateHomeCare
          ? await generateBillingCandidatesForMonth(tx, {
              orgId: ctx.orgId,
              billingMonth: billingMonth.start,
            })
          : [];
        const pcaRentalCandidates = generatePcaRental
          ? await generatePcaRentalBillingCandidatesForMonth(tx, {
              orgId: ctx.orgId,
              billingMonth: billingMonth.start,
            })
          : [];
        const allCandidates = [...candidates, ...pcaRentalCandidates];

        return {
          billing_domain: billingDomain ?? 'all',
          generated: allCandidates.length,
          home_care_generated: candidates.length,
          pca_rental_generated: pcaRentalCandidates.length,
          confirmed: allCandidates.filter((candidate) => candidate.status === 'confirmed').length,
          review_required: allCandidates.filter((candidate) => candidate.status === 'candidate')
            .length,
          excluded: allCandidates.filter((candidate) => candidate.status === 'excluded').length,
        };
      },
      { requestContext: ctx, maxWaitMs: 10_000, timeoutMs: 20_000 },
    );

    return success({
      data: {
        message: `${billingMonth.canonical} の請求候補を生成しました`,
        ...created,
      },
    });
  },
  {
    permission: 'canManageBilling',
    message: '請求候補の作成権限がありません',
  },
);
