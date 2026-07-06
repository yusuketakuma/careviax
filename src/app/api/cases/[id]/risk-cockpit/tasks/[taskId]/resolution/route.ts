import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { parseJsonObjectRequestBodyOrError } from '@/lib/api/request-body';
import { conflict, internalError, notFound, success, validationError } from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { logger } from '@/lib/utils/logger';
import { requireWritableTaskPatient } from '@/server/services/task-write-guard';
import { waiveRiskOperationalTaskById } from '@/server/services/risk-task-resolution';

const riskTaskResolutionSchema = z.object({
  resolution_state: z.literal('waived'),
  waiver_reason: z.string().trim().min(1, '免除理由は必須です').max(1000),
  reason_code: z
    .string()
    .trim()
    .regex(/^[a-z0-9_:-]{1,100}$/i, '理由コードの形式が不正です')
    .optional()
    .nullable(),
});

async function authenticatedPOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> },
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAuditDispense',
    message: 'リスクタスクを免除する権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawCaseId, taskId: rawTaskId } = await params;
  const caseId = normalizeRequiredRouteParam(rawCaseId);
  const taskId = normalizeRequiredRouteParam(rawTaskId);
  if (!caseId) return validationError('ケースIDが不正です');
  if (!taskId) return validationError('タスクIDが不正です');

  const body = await parseJsonObjectRequestBodyOrError(req, riskTaskResolutionSchema, {
    invalidBody: 'リクエストボディが不正です',
    invalidInput: '入力値が不正です',
  });
  if (!body.ok) return body.response;

  const careCase = await prisma.careCase.findFirst({
    where: {
      id: caseId,
      org_id: ctx.orgId,
    },
    select: {
      id: true,
    },
  });
  if (!careCase) return notFound('ケースまたはタスクが見つかりません');

  const existing = await prisma.task.findFirst({
    where: {
      id: taskId,
      org_id: ctx.orgId,
    },
  });
  if (!existing) return notFound('ケースまたはタスクが見つかりません');

  const writable = await requireWritableTaskPatient(prisma, ctx, existing);
  if (writable && 'response' in writable) return writable.response;

  const result = await withOrgContext(
    ctx.orgId,
    (tx) =>
      waiveRiskOperationalTaskById(tx, {
        orgId: ctx.orgId,
        caseId,
        taskId,
        ctx,
        waiverReason: body.data.waiver_reason,
        reasonCode: body.data.reason_code,
      }),
    { requestContext: ctx },
  );

  if (result.status === 'not_found') return notFound('ケースまたはタスクが見つかりません');
  if (result.status === 'invalid_risk_task') {
    return conflict('このタスクはリスク解決専用フローの対象外です');
  }
  if (result.status === 'conflict') {
    return conflict('タスクはすでに完了または取り消されています。再読み込みしてください');
  }

  return success({
    task_id: result.task_id,
    display_id: result.display_id,
    case_id: result.case_id,
    resolution_state: 'waived',
    task_status: 'cancelled',
    updated_count: result.updated_task_count,
    audit_logged: true,
  });
}

export async function POST(
  req: NextRequest,
  routeContext: { params: Promise<{ id: string; taskId: string }> },
) {
  try {
    return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    logger.error({
      event: 'route_handler_unhandled_error',
      route: req.nextUrl?.pathname,
      method: req.method,
      code: err instanceof Error ? err.name : typeof err,
    });
    return withSensitiveNoStore(internalError());
  }
}
