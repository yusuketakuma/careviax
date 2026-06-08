import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { parsePaginationParams } from '@/lib/api/pagination';
import { prisma } from '@/lib/db/client';
import { readJsonObject, readJsonObjectString } from '@/lib/db/json';
import {
  getBillingCandidateWorkbenchSummary,
  generateBillingCandidatesForMonth,
  japanMonthRangeForBillingMonth,
  upsertBillingEvidenceForVisit,
} from '@/server/services/billing-evidence';
import { generatePcaRentalBillingCandidatesForMonth } from '@/server/services/pca-rental-billing';
import { BILLING_MONTH_FORMAT_MESSAGE, parseStrictBillingMonth } from './billing-month';

function readWorkflowState(sourceSnapshot: unknown) {
  return readJsonObject(readJsonObject(sourceSnapshot)?.billing_close);
}

function readBillingTargetName(candidate: {
  billing_target_name?: string | null;
  source_snapshot: unknown;
}) {
  if (candidate.billing_target_name) return candidate.billing_target_name;
  const target = readJsonObject(readJsonObject(candidate.source_snapshot)?.billing_target);
  return typeof target?.name === 'string' ? target.name : null;
}

function parseBillingDomain(value: string | null) {
  if (value === null || value === '') return undefined;
  return value === 'home_care' || value === 'pca_rental' ? value : null;
}

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);

    const billingMonth = searchParams.get('billing_month');
    const patientId = searchParams.get('patient_id') ?? undefined;
    const status = searchParams.get('status') ?? undefined;
    const billingDomain = parseBillingDomain(searchParams.get('billing_domain'));
    const parsedBillingMonth = billingMonth === null ? null : parseStrictBillingMonth(billingMonth);
    if (billingMonth !== null && !parsedBillingMonth) {
      return validationError(BILLING_MONTH_FORMAT_MESSAGE);
    }
    if (billingDomain === null) {
      return validationError('billing_domain は home_care または pca_rental を指定してください');
    }

    const result = await withOrgContext(req.orgId, async (tx) => {
      const candidates = await tx.billingCandidate.findMany({
        where: {
          org_id: req.orgId,
          ...(parsedBillingMonth ? { billing_month: parsedBillingMonth.start } : {}),
          ...(patientId ? { patient_id: patientId } : {}),
          ...(billingDomain ? { billing_domain: billingDomain } : {}),
          ...(status ? { status } : {}),
        },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: [{ billing_month: 'desc' }, { created_at: 'desc' }],
      });
      const summary = parsedBillingMonth
        ? await getBillingCandidateWorkbenchSummary(tx, {
            orgId: req.orgId,
            billingMonth: parsedBillingMonth.start,
            patientId,
            billingDomain,
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
              where: { org_id: req.orgId, id: { in: patientIds } },
              select: { id: true, name: true },
            });
      const patientNameMap = new Map(patients.map((p) => [p.id, p.name]));

      return { candidates, summary, patientNameMap };
    });

    const candidates = result.candidates.map((candidate) => ({
      ...candidate,
      patient_name: candidate.patient_id
        ? (result.patientNameMap.get(candidate.patient_id) ?? null)
        : null,
      billing_target_label:
        candidate.billing_target_type === 'institution'
          ? readBillingTargetName(candidate)
          : candidate.patient_id
            ? (result.patientNameMap.get(candidate.patient_id) ?? candidate.patient_id)
            : readBillingTargetName(candidate),
      workflow_state: readWorkflowState(candidate.source_snapshot),
      effective_revision_code: readJsonObjectString(candidate.source_snapshot, 'revision_code'),
      site_config_revision_code: readJsonObjectString(
        candidate.source_snapshot,
        'site_config_revision_code',
      ),
      site_config_status: readJsonObjectString(candidate.source_snapshot, 'site_config_status'),
    }));

    const hasMore = candidates.length > limit;
    const data = hasMore ? candidates.slice(0, limit) : candidates;
    const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

    return success({ data, hasMore, nextCursor, summary: result.summary });
  },
  {
    permission: 'canManageBilling',
    message: '請求候補の閲覧権限がありません',
  },
);

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const { billing_month } = payload;
    if (!billing_month) return validationError('billing_month は必須です');

    const billingMonth = parseStrictBillingMonth(billing_month);
    if (!billingMonth) {
      return validationError(BILLING_MONTH_FORMAT_MESSAGE);
    }

    const billingMonthRange = japanMonthRangeForBillingMonth(billingMonth.start);
    const visitRecords = await prisma.visitRecord.findMany({
      where: {
        org_id: req.orgId,
        visit_date: {
          gte: billingMonthRange.start,
          lt: billingMonthRange.nextStart,
        },
      },
      select: {
        id: true,
      },
    });

    const created = await withOrgContext(req.orgId, async (tx) => {
      for (const visitRecord of visitRecords) {
        await upsertBillingEvidenceForVisit(tx, {
          orgId: req.orgId,
          visitRecordId: visitRecord.id,
        });
      }

      const candidates = await generateBillingCandidatesForMonth(tx, {
        orgId: req.orgId,
        billingMonth: billingMonth.start,
      });
      const pcaRentalCandidates = await generatePcaRentalBillingCandidatesForMonth(tx, {
        orgId: req.orgId,
        billingMonth: billingMonth.start,
      });
      const allCandidates = [...candidates, ...pcaRentalCandidates];

      return {
        generated: allCandidates.length,
        home_care_generated: candidates.length,
        pca_rental_generated: pcaRentalCandidates.length,
        confirmed: allCandidates.filter((candidate) => candidate.status === 'confirmed').length,
        review_required: allCandidates.filter((candidate) => candidate.status === 'candidate')
          .length,
        excluded: allCandidates.filter((candidate) => candidate.status === 'excluded').length,
      };
    });

    return success({
      message: `${billingMonth.canonical} の請求候補を生成しました`,
      ...created,
    });
  },
  {
    permission: 'canManageBilling',
    message: '請求候補の作成権限がありません',
  },
);
