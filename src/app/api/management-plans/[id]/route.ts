import { NextRequest } from 'next/server';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { parseJsonObjectRequestBodyOrError } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { withAuthContext, type AuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { tryAcquireAdvisoryTxLock } from '@/lib/db/advisory-lock';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { formatUtcDateKey } from '@/lib/date-key';
import { presentManagementPlanDetail } from '@/lib/management-plans/response-schema';
import { utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import {
  isManagementPlanDateRangeValid,
  updateManagementPlanSchema,
} from '@/lib/validations/management-plan';
import { resolveManagementPlanReviewAlert } from '@/server/services/management-plans';

const MANAGEMENT_PLAN_CASE_LOCK_NAMESPACE = 'management-plan-case';
const MANAGEMENT_PLAN_CONFLICT_MESSAGE =
  '管理計画書が他のユーザーによって更新されています。最新のデータを取得してください。';
const WRITE_BODY_MAX_BYTES = 64 * 1024;
const WRITE_BODY_DEADLINE_MS = 5_000;
const MAX_IDENTIFIER_LENGTH = 200;

const managementPlanDetailSelect = {
  id: true,
  case_id: true,
  title: true,
  summary: true,
  content: true,
  status: true,
  version: true,
  effective_from: true,
  next_review_date: true,
  approved_at: true,
  updated_at: true,
} as const;

function dateOnlyString(value: Date | string | null | undefined) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return formatUtcDateKey(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameTimestamp(left: Date | string, right: string) {
  return new Date(left).getTime() === new Date(right).getTime();
}

function nextMutationTimestamp(previous: Date | string) {
  return new Date(Math.max(Date.now(), new Date(previous).getTime() + 1));
}

async function managementPlanGET(
  _req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id || id.length > MAX_IDENTIFIER_LENGTH) {
    return validationError('管理計画書IDが不正です');
  }

  const assignmentWhere = buildCareCaseAssignmentWhere(ctx);
  const result = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const plan = await tx.managementPlan.findFirst({
        where: {
          id,
          org_id: ctx.orgId,
          ...(assignmentWhere ? { case_: assignmentWhere } : {}),
        },
        select: {
          ...managementPlanDetailSelect,
          case_: { select: { patient_id: true } },
        },
      });
      if (!plan) return { kind: 'not_found' as const };

      const { case_: careCase, ...planRecord } = plan;
      const data = presentManagementPlanDetail(planRecord);
      await createAuditLogEntry(tx, ctx, {
        action: 'phi_read',
        targetType: 'management_plan',
        targetId: plan.id,
        patientId: careCase.patient_id,
        changes: { view: 'management_plan_detail' },
      });
      return { kind: 'success' as const, data };
    },
    { requestContext: ctx },
  );

  if (result.kind === 'not_found') return notFound('管理計画書が見つかりません');
  return success({ data: result.data });
}

async function managementPlanPATCH(
  req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id || id.length > MAX_IDENTIFIER_LENGTH) {
    return validationError('管理計画書IDが不正です');
  }

  const parsed = await parseJsonObjectRequestBodyOrError(
    req,
    updateManagementPlanSchema,
    { invalidBody: 'リクエストボディが不正です', invalidInput: '入力値が不正です' },
    { maxBytes: WRITE_BODY_MAX_BYTES, deadlineMs: WRITE_BODY_DEADLINE_MS },
  );
  if (!parsed.ok) return parsed.response;

  const data = parsed.data;
  const assignmentWhere = buildCareCaseAssignmentWhere(ctx);
  const result = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const scope = await tx.managementPlan.findFirst({
        where: {
          id,
          org_id: ctx.orgId,
          ...(assignmentWhere ? { case_: assignmentWhere } : {}),
        },
        select: { case_id: true },
      });
      if (!scope) return { kind: 'not_found' as const };

      const lockAcquired = await tryAcquireAdvisoryTxLock(
        tx,
        MANAGEMENT_PLAN_CASE_LOCK_NAMESPACE,
        `${ctx.orgId}:${scope.case_id}`,
      );
      if (!lockAcquired) return { kind: 'conflict' as const };
      const current = await tx.managementPlan.findFirst({
        where: {
          id,
          org_id: ctx.orgId,
          ...(assignmentWhere ? { case_: assignmentWhere } : {}),
        },
        select: managementPlanDetailSelect,
      });
      if (
        !current ||
        current.case_id !== scope.case_id ||
        !sameTimestamp(current.updated_at, data.expected_updated_at)
      ) {
        return { kind: 'conflict' as const };
      }

      const updatedAt = nextMutationTimestamp(current.updated_at);
      if (data.action === 'archive') {
        if (current.status !== 'draft' && current.status !== 'approved') {
          return { kind: 'conflict' as const };
        }
        const updateResult = await tx.managementPlan.updateMany({
          where: {
            id,
            org_id: ctx.orgId,
            case_id: scope.case_id,
            status: current.status,
            updated_at: current.updated_at,
          },
          data: { status: 'archived', updated_at: updatedAt },
        });
        if (updateResult.count !== 1) return { kind: 'conflict' as const };
        await resolveManagementPlanReviewAlert(tx, { orgId: ctx.orgId, planId: id });
      } else {
        if (current.status !== 'draft') return { kind: 'conflict' as const };

        const effectiveFrom =
          data.effective_from !== undefined
            ? data.effective_from
            : dateOnlyString(current.effective_from);
        const nextReviewDate =
          data.next_review_date !== undefined
            ? data.next_review_date
            : dateOnlyString(current.next_review_date);
        if (!isManagementPlanDateRangeValid({ effectiveFrom, nextReviewDate })) {
          return { kind: 'invalid_dates' as const };
        }

        const isSemanticNoOp =
          (data.title === undefined || data.title === current.title) &&
          (data.summary === undefined || data.summary === current.summary) &&
          (data.content === undefined ||
            canonicalJson(data.content) === canonicalJson(current.content)) &&
          (data.effective_from === undefined ||
            data.effective_from === dateOnlyString(current.effective_from)) &&
          (data.next_review_date === undefined ||
            data.next_review_date === dateOnlyString(current.next_review_date));
        if (isSemanticNoOp) return { kind: 'no_op' as const };

        const updateResult = await tx.managementPlan.updateMany({
          where: {
            id,
            org_id: ctx.orgId,
            case_id: scope.case_id,
            status: 'draft',
            updated_at: current.updated_at,
          },
          data: {
            ...(data.title === undefined ? {} : { title: data.title }),
            ...(data.summary === undefined ? {} : { summary: data.summary }),
            ...(data.content === undefined ? {} : { content: toPrismaJsonInput(data.content) }),
            ...(data.effective_from === undefined
              ? {}
              : {
                  effective_from: data.effective_from
                    ? utcDateFromLocalKey(data.effective_from)
                    : null,
                }),
            ...(data.next_review_date === undefined
              ? {}
              : {
                  next_review_date: data.next_review_date
                    ? utcDateFromLocalKey(data.next_review_date)
                    : null,
                }),
            updated_at: updatedAt,
          },
        });
        if (updateResult.count !== 1) return { kind: 'conflict' as const };
      }

      const updated = await tx.managementPlan.findFirst({
        where: {
          id,
          org_id: ctx.orgId,
          case_id: scope.case_id,
          ...(assignmentWhere ? { case_: assignmentWhere } : {}),
        },
        select: managementPlanDetailSelect,
      });
      if (!updated) {
        throw new Error('Management plan disappeared after a successful guarded mutation');
      }
      return { kind: 'success' as const, data: presentManagementPlanDetail(updated) };
    },
    { requestContext: ctx },
  );

  if (result.kind === 'not_found') return notFound('管理計画書が見つかりません');
  if (result.kind === 'conflict') return conflict(MANAGEMENT_PLAN_CONFLICT_MESSAGE);
  if (result.kind === 'invalid_dates') {
    return validationError('入力値が不正です', {
      next_review_date: ['next_review_date は effective_from 以降の日付を指定してください'],
    });
  }
  if (result.kind === 'no_op') return validationError('変更内容がありません');
  return success({ data: result.data });
}

export const GET = withAuthContext(managementPlanGET, {
  permission: 'canViewDashboard',
  message: '管理計画書の閲覧権限がありません',
});

export const PATCH = withAuthContext(managementPlanPATCH, {
  permission: 'canVisit',
  message: '管理計画書の更新権限がありません',
});
