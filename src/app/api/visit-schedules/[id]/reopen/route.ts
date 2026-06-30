import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { canAccessVisitScheduleAssignment } from '@/lib/auth/visit-schedule-access';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withOrgContext } from '@/lib/db/rls';
import {
  success,
  validationError,
  notFound,
  forbiddenResponse,
  conflict,
  internalError,
} from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import {
  VISIT_SCHEDULE_CANCEL_REASON_CODES,
  visitScheduleCancelReasonLabel,
} from '@/lib/visits/schedule-reason';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';

/**
 * 取消済み訪問予定の再開(p0_37)。cancelled → planned に戻し(準備からやり直す)、
 * 理由コード+メモを AuditLog(visit_schedule_reopened)へ構造化記録する。
 * 出発済み・完了などの終了系からは再開できない(対象は cancelled のみ)。
 */

const reopenScheduleSchema = z.object({
  reason_code: z.enum(VISIT_SCHEDULE_CANCEL_REASON_CODES),
  reason_note: z.string().trim().max(500, 'メモは500文字以内で入力してください').optional(),
});

async function authenticatedPOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問予定の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('訪問予定IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');
  const parsed = reopenScheduleSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }
  const reasonNote = parsed.data.reason_note || null;

  const existing = await prisma.visitSchedule.findFirst({
    where: { id, org_id: ctx.orgId },
    select: {
      id: true,
      pharmacist_id: true,
      version: true,
      schedule_status: true,
      override_request: {
        select: {
          status: true,
          replacement_schedule_id: true,
        },
      },
      case_: {
        select: {
          primary_pharmacist_id: true,
          backup_pharmacist_id: true,
        },
      },
    },
  });
  if (!existing) return notFound('訪問予定が見つかりません');
  if (!canAccessVisitScheduleAssignment(ctx, existing)) {
    return forbiddenResponse('この訪問予定を更新する権限がありません');
  }
  if (existing.schedule_status !== 'cancelled') {
    return validationError('取消済みの訪問予定のみ再開できます');
  }
  if (
    existing.override_request?.status === 'completed' ||
    existing.override_request?.replacement_schedule_id
  ) {
    return validationError('確定済みリスケの元訪問予定は再開できません');
  }

  const result = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const updated = await tx.visitSchedule.updateMany({
        where: {
          id,
          org_id: ctx.orgId,
          version: existing.version,
          schedule_status: 'cancelled',
          OR: [
            { override_request: { is: null } },
            {
              override_request: {
                is: {
                  status: { not: 'completed' },
                  replacement_schedule_id: null,
                },
              },
            },
          ],
        },
        data: { schedule_status: 'planned', version: { increment: 1 } },
      });
      if (updated.count !== 1) {
        return {
          ok: false as const,
          response: conflict('訪問予定が同時に更新されました。再読み込みしてください'),
        };
      }
      const updatedSchedule = await tx.visitSchedule.findFirst({
        where: { id, org_id: ctx.orgId },
      });
      if (!updatedSchedule) {
        return {
          ok: false as const,
          response: conflict('更新後の訪問予定を取得できません。再読み込みしてください'),
        };
      }
      await createAuditLogEntry(tx, ctx, {
        action: 'visit_schedule_reopened',
        targetType: 'VisitSchedule',
        targetId: id,
        changes: {
          schedule_status: { from: 'cancelled', to: 'planned' },
          reason_code: parsed.data.reason_code,
          reason_label: visitScheduleCancelReasonLabel(parsed.data.reason_code),
          reason_note: reasonNote,
        },
      });
      return { ok: true as const, schedule: updatedSchedule };
    },
    { requestContext: ctx },
  );

  if (!result.ok) return result.response;

  await notifyWorkflowMutation({
    orgId: ctx.orgId,
    payload: { source: 'visit_schedules_reopen', schedule_id: id },
  });

  return success(result.schedule);
}

export async function POST(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}
