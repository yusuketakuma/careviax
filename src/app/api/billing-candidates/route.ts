import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { prisma } from '@/lib/db/client';
import {
  getBillingCandidateWorkbenchSummary,
  generateBillingCandidatesForMonth,
  upsertBillingEvidenceForVisit,
} from '@/server/services/billing-evidence';
import { BILLING_MONTH_FORMAT_MESSAGE, parseStrictBillingMonth } from './billing-month';

function readWorkflowState(sourceSnapshot: unknown) {
  if (
    typeof sourceSnapshot !== 'object' ||
    sourceSnapshot === null ||
    Array.isArray(sourceSnapshot) ||
    !('billing_close' in sourceSnapshot)
  ) {
    return null;
  }
  const workflow = (sourceSnapshot as Record<string, unknown>).billing_close;
  if (typeof workflow !== 'object' || workflow === null || Array.isArray(workflow)) {
    return null;
  }
  return workflow;
}

function readSourceSnapshotString(sourceSnapshot: unknown, key: string) {
  if (
    typeof sourceSnapshot !== 'object' ||
    sourceSnapshot === null ||
    Array.isArray(sourceSnapshot)
  ) {
    return null;
  }
  const value = (sourceSnapshot as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);

    const billingMonth = searchParams.get('billing_month');
    const patientId = searchParams.get('patient_id') ?? undefined;
    const status = searchParams.get('status') ?? undefined;
    const parsedBillingMonth = billingMonth === null ? null : parseStrictBillingMonth(billingMonth);
    if (billingMonth !== null && !parsedBillingMonth) {
      return validationError(BILLING_MONTH_FORMAT_MESSAGE);
    }

    const result = await withOrgContext(req.orgId, async (tx) => {
      const candidates = await tx.billingCandidate.findMany({
        where: {
          org_id: req.orgId,
          ...(parsedBillingMonth ? { billing_month: parsedBillingMonth.start } : {}),
          ...(patientId ? { patient_id: patientId } : {}),
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
          })
        : null;

      const patientIds = [...new Set(candidates.map((c) => c.patient_id))];
      const patients = await tx.patient.findMany({
        where: { org_id: req.orgId, id: { in: patientIds } },
        select: { id: true, name: true },
      });
      const patientNameMap = new Map(patients.map((p) => [p.id, p.name]));

      return { candidates, summary, patientNameMap };
    });

    const candidates = result.candidates.map((candidate) => ({
      ...candidate,
      patient_name: result.patientNameMap.get(candidate.patient_id) ?? null,
      workflow_state: readWorkflowState(candidate.source_snapshot),
      effective_revision_code: readSourceSnapshotString(candidate.source_snapshot, 'revision_code'),
      site_config_revision_code: readSourceSnapshotString(
        candidate.source_snapshot,
        'site_config_revision_code',
      ),
      site_config_status: readSourceSnapshotString(candidate.source_snapshot, 'site_config_status'),
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
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const { billing_month } = body as { billing_month?: unknown };
    if (!billing_month) return validationError('billing_month は必須です');

    const billingMonth = parseStrictBillingMonth(billing_month);
    if (!billingMonth) {
      return validationError(BILLING_MONTH_FORMAT_MESSAGE);
    }

    const visitRecords = await prisma.visitRecord.findMany({
      where: {
        org_id: req.orgId,
        visit_date: {
          gte: billingMonth.start,
          lt: billingMonth.nextStart,
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

      return {
        generated: candidates.length,
        confirmed: candidates.filter((candidate) => candidate.status === 'confirmed').length,
        review_required: candidates.filter((candidate) => candidate.status === 'candidate').length,
        excluded: candidates.filter((candidate) => candidate.status === 'excluded').length,
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
