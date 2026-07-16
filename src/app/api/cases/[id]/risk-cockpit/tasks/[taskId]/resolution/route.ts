import { NextRequest } from 'next/server';
import { z } from 'zod';
import { parseJsonObjectRequestBodyOrError } from '@/lib/api/request-body';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withAuthContext, type AuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { buildPersonalCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { withOrgContext } from '@/lib/db/rls';
import { requireWritablePatient } from '@/server/services/patient-write-guard';
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

async function riskTaskResolutionPOST(
  req: NextRequest,
  ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string; taskId: string }>,
) {
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

  const result = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const careCase = await tx.careCase.findFirst({
        where: {
          id: caseId,
          org_id: ctx.orgId,
          AND: [buildPersonalCareCaseAssignmentWhere(ctx)],
        },
        select: {
          patient_id: true,
        },
      });
      if (!careCase) return { status: 'not_found' as const };

      const writable = await requireWritablePatient(tx, ctx, careCase.patient_id);
      if ('response' in writable) {
        return { status: 'write_rejected' as const, response: writable.response };
      }

      return waiveRiskOperationalTaskById(tx, {
        orgId: ctx.orgId,
        caseId,
        taskId,
        ctx,
        waiverReason: body.data.waiver_reason,
        reasonCode: body.data.reason_code,
      });
    },
    { requestContext: ctx },
  );

  if (result.status === 'not_found') return notFound('ケースまたはタスクが見つかりません');
  if (result.status === 'write_rejected') return result.response;
  if (result.status === 'invalid_risk_task') {
    return conflict('このタスクはリスク解決専用フローの対象外です');
  }
  if (result.status === 'conflict') {
    return conflict('タスクはすでに完了または取り消されています。再読み込みしてください');
  }

  return success({
    data: {
      task_id: result.task_id,
      display_id: result.display_id,
      case_id: result.case_id,
      resolution_state: 'waived',
      task_status: 'cancelled',
      updated_count: result.updated_task_count,
      audit_logged: true,
    },
  });
}

export const POST = withAuthContext(riskTaskResolutionPOST, {
  permission: 'canAuditDispense',
  message: 'リスクタスクを免除する権限がありません',
});
