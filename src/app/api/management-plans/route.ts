import { NextRequest } from 'next/server';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { parseJsonObjectRequestBodyOrError } from '@/lib/api/request-body';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { tryAcquireAdvisoryTxLock } from '@/lib/db/advisory-lock';
import { toPrismaJsonInput } from '@/lib/db/json';
import { isPrismaUniqueConstraintError } from '@/lib/db/prisma-errors';
import { withOrgContext } from '@/lib/db/rls';
import {
  managementPlanListResponseSchema,
  managementPlanStatusSchema,
  presentManagementPlanDetail,
  presentManagementPlanListItem,
} from '@/lib/management-plans/response-schema';
import { utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { createManagementPlanSchema } from '@/lib/validations/management-plan';

const MANAGEMENT_PLAN_CASE_LOCK_NAMESPACE = 'management-plan-case';
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;
const MAX_VERSION = 2_147_483_647;
const MAX_IDENTIFIER_LENGTH = 200;
const WRITE_BODY_MAX_BYTES = 64 * 1024;
const WRITE_BODY_DEADLINE_MS = 5_000;
const LIST_QUERY_KEYS = new Set(['case_id', 'limit', 'cursor', 'status']);

const managementPlanListSelect = {
  id: true,
  case_id: true,
  title: true,
  status: true,
  version: true,
  effective_from: true,
  next_review_date: true,
  approved_at: true,
  updated_at: true,
} as const;

const managementPlanDetailSelect = {
  ...managementPlanListSelect,
  summary: true,
  content: true,
} as const;

type ListQuery = {
  caseId: string;
  limit: number;
  cursor?: number;
  status?: 'draft' | 'approved' | 'superseded' | 'archived';
};

function singleQueryValue(searchParams: URLSearchParams, name: string, required = false) {
  const values = searchParams.getAll(name);
  if (values.length > 1) return { error: `${name} は1つだけ指定してください` } as const;
  if (values.length === 0) {
    return required ? ({ error: `${name} は必須です` } as const) : ({ value: undefined } as const);
  }
  const value = values[0]?.trim() ?? '';
  if (!value) return { error: `${name} は空にできません` } as const;
  return { value } as const;
}

function parseBoundedInteger(value: string | undefined, min: number, max: number) {
  if (value === undefined) return { value: undefined } as const;
  if (!/^\d+$/.test(value)) return { error: '整数を指定してください' } as const;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    return { error: `${min}以上${max}以下の整数を指定してください` } as const;
  }
  return { value: parsed } as const;
}

function parseListQuery(searchParams: URLSearchParams): { data: ListQuery } | { errors: object } {
  const unknown = Array.from(new Set(searchParams.keys())).filter(
    (key) => !LIST_QUERY_KEYS.has(key),
  );
  if (unknown.length > 0) {
    return { errors: { query: [`未対応のクエリパラメータです: ${unknown.join(', ')}`] } };
  }

  const caseId = singleQueryValue(searchParams, 'case_id', true);
  const limit = singleQueryValue(searchParams, 'limit');
  const cursor = singleQueryValue(searchParams, 'cursor');
  const status = singleQueryValue(searchParams, 'status');
  const singleErrors = { case_id: caseId, limit, cursor, status };
  for (const [name, result] of Object.entries(singleErrors)) {
    if ('error' in result) return { errors: { [name]: [result.error] } };
  }

  const parsedLimit = parseBoundedInteger(limit.value, 1, MAX_LIST_LIMIT);
  if ('error' in parsedLimit) return { errors: { limit: [parsedLimit.error] } };
  const parsedCursor = parseBoundedInteger(cursor.value, 1, MAX_VERSION);
  if ('error' in parsedCursor) return { errors: { cursor: [parsedCursor.error] } };
  const parsedStatus =
    status.value === undefined ? undefined : managementPlanStatusSchema.safeParse(status.value);
  if (caseId.value!.length > MAX_IDENTIFIER_LENGTH) {
    return {
      errors: { case_id: [`case_id は${MAX_IDENTIFIER_LENGTH}文字以下で指定してください`] },
    };
  }
  if (parsedStatus && !parsedStatus.success) {
    return { errors: { status: ['status が不正です'] } };
  }

  return {
    data: {
      caseId: caseId.value!,
      limit: parsedLimit.value ?? DEFAULT_LIST_LIMIT,
      ...(parsedCursor.value === undefined ? {} : { cursor: parsedCursor.value }),
      ...(parsedStatus?.success ? { status: parsedStatus.data } : {}),
    },
  };
}

async function managementPlanGET(req: NextRequest, ctx: AuthContext) {
  const parsedQuery = parseListQuery(new URL(req.url).searchParams);
  if ('errors' in parsedQuery) {
    return validationError('クエリパラメータが不正です', parsedQuery.errors);
  }

  const { caseId, limit, cursor, status } = parsedQuery.data;
  const assignmentWhere = buildCareCaseAssignmentWhere(ctx);
  const result = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const careCase = await tx.careCase.findFirst({
        where: { id: caseId, org_id: ctx.orgId, ...(assignmentWhere ?? {}) },
        select: { id: true, patient_id: true },
      });
      if (!careCase) return { kind: 'not_found' as const };

      const rows = await tx.managementPlan.findMany({
        where: {
          org_id: ctx.orgId,
          case_id: caseId,
          ...(status ? { status } : {}),
          ...(cursor ? { version: { lt: cursor } } : {}),
        },
        orderBy: [{ version: 'desc' }],
        take: limit + 1,
        select: managementPlanListSelect,
      });
      const hasMore = rows.length > limit;
      const data = rows.slice(0, limit).map(presentManagementPlanListItem);
      const envelope = managementPlanListResponseSchema.parse({
        data,
        meta: {
          has_more: hasMore,
          next_cursor: hasMore ? (data.at(-1)?.version ?? null) : null,
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'phi_read',
        targetType: 'management_plan_list',
        targetId: caseId,
        patientId: careCase.patient_id,
        changes: { view: 'management_plan_list', result_count: data.length, has_more: hasMore },
      });
      return { kind: 'success' as const, envelope };
    },
    { requestContext: ctx },
  );

  if (result.kind === 'not_found') return notFound('ケースが見つかりません');
  return success(result.envelope);
}

async function managementPlanPOST(req: NextRequest, ctx: AuthContext) {
  const parsed = await parseJsonObjectRequestBodyOrError(
    req,
    createManagementPlanSchema,
    { invalidBody: 'リクエストボディが不正です', invalidInput: '入力値が不正です' },
    { maxBytes: WRITE_BODY_MAX_BYTES, deadlineMs: WRITE_BODY_DEADLINE_MS },
  );
  if (!parsed.ok) return parsed.response;

  const data = parsed.data;
  const assignmentWhere = buildCareCaseAssignmentWhere(ctx);
  const result = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const lockAcquired = await tryAcquireAdvisoryTxLock(
        tx,
        MANAGEMENT_PLAN_CASE_LOCK_NAMESPACE,
        `${ctx.orgId}:${data.case_id}`,
      );
      if (!lockAcquired) return { kind: 'conflict' as const };
      const careCase = await tx.careCase.findFirst({
        where: { id: data.case_id, org_id: ctx.orgId, ...(assignmentWhere ?? {}) },
        select: { id: true },
      });
      if (!careCase) return { kind: 'invalid_case' as const };

      if (data.source_plan_id) {
        const source = await tx.managementPlan.findFirst({
          where: {
            id: data.source_plan_id,
            org_id: ctx.orgId,
            case_id: data.case_id,
          },
          select: { id: true },
        });
        if (!source) return { kind: 'invalid_source' as const };
      }

      const latest = await tx.managementPlan.findFirst({
        where: { org_id: ctx.orgId, case_id: data.case_id },
        orderBy: [{ version: 'desc' }],
        select: { version: true },
      });
      const latestVersion = latest?.version ?? 0;
      if (latestVersion !== data.expected_latest_version || latestVersion === MAX_VERSION) {
        return { kind: 'conflict' as const };
      }

      try {
        const plan = await tx.managementPlan.create({
          data: {
            org_id: ctx.orgId,
            case_id: data.case_id,
            title: data.title,
            summary: data.summary ?? null,
            content: toPrismaJsonInput(data.content),
            created_by: ctx.userId,
            version: latestVersion + 1,
            effective_from: data.effective_from ? utcDateFromLocalKey(data.effective_from) : null,
            next_review_date: data.next_review_date
              ? utcDateFromLocalKey(data.next_review_date)
              : null,
            source_plan_id: data.source_plan_id ?? null,
          },
          select: managementPlanDetailSelect,
        });
        return { kind: 'success' as const, plan: presentManagementPlanDetail(plan) };
      } catch (error) {
        if (isPrismaUniqueConstraintError(error)) return { kind: 'conflict' as const };
        throw error;
      }
    },
    { requestContext: ctx },
  );

  if (result.kind === 'invalid_case') {
    return validationError('入力値が不正です', {
      case_id: ['指定されたケースを確認できません'],
    });
  }
  if (result.kind === 'invalid_source') {
    return validationError('入力値が不正です', {
      source_plan_id: ['指定された複製元を確認できません'],
    });
  }
  if (result.kind === 'conflict') {
    return conflict(
      '管理計画書の最新バージョンが変更されています。最新のデータを取得してください。',
    );
  }
  return success({ data: result.plan }, 201);
}

export const GET = withAuthContext(managementPlanGET, {
  permission: 'canViewDashboard',
  message: '管理計画書の閲覧権限がありません',
});

export const POST = withAuthContext(managementPlanPOST, {
  permission: 'canVisit',
  message: '管理計画書の作成権限がありません',
});
