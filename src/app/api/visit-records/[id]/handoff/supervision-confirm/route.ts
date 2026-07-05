import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import {
  conflict,
  error,
  forbiddenResponse,
  internalError,
  notFound,
  success,
  validationError,
} from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import {
  confirmHandoff,
  VisitHandoffAlreadyConfirmedError,
  VisitHandoffInvalidDataError,
  VisitHandoffMissingDataError,
  VisitHandoffSupervisionTaskUnavailableError,
  VisitHandoffStaleRecordError,
} from '@/server/services/visit-handoff';

const supervisedConfirmSchema = z.object({
  confirmed: z.literal(true),
  task_id: z.string().trim().min(1, '上長確認タスクIDが必要です').max(128),
  expected_visit_record_version: z
    .number()
    .int('訪問記録の版情報が不正です')
    .positive('訪問記録の版情報が不正です'),
  edits: z
    .object({
      next_check_items: z.array(z.string()).optional(),
      ongoing_monitoring: z.array(z.string()).optional(),
      decision_rationale: z.string().optional(),
    })
    .optional(),
});

const OPEN_TASK_STATUSES = ['pending', 'in_progress'];

function readStringMetadata(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' && candidate.trim() ? candidate : null;
}

function readNumberMetadata(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'number' && Number.isInteger(candidate) ? candidate : null;
}

async function authenticatedPOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問記録の更新権限がありません',
  });
  if ('response' in authResult) return withSensitiveNoStore(authResult.response);
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return withSensitiveNoStore(validationError('訪問記録IDが不正です'));

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return withSensitiveNoStore(validationError('リクエストボディが不正です'));

  const parsed = supervisedConfirmSchema.safeParse(payload);
  if (!parsed.success) {
    return withSensitiveNoStore(
      validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
    );
  }

  const record = await prisma.visitRecord.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true, version: true },
  });
  if (!record) return withSensitiveNoStore(notFound('訪問記録が見つかりません'));

  const membership = await prisma.membership.findFirst({
    where: {
      org_id: ctx.orgId,
      user_id: ctx.userId,
      is_active: true,
      role: { in: ['owner', 'admin', 'pharmacist'] },
    },
    select: { user_id: true, role: true },
  });
  if (!membership) {
    return withSensitiveNoStore(await forbiddenResponse('この申し送りの上長確認を確定できません'));
  }

  const task = await prisma.task.findFirst({
    where: {
      id: parsed.data.task_id,
      org_id: ctx.orgId,
      task_type: 'handoff_supervision_review',
      related_entity_type: 'visit_record',
      related_entity_id: id,
    },
    select: {
      id: true,
      status: true,
      assigned_to: true,
      metadata: true,
    },
  });
  if (!task) return withSensitiveNoStore(notFound('上長確認タスクが見つかりません'));
  if (!OPEN_TASK_STATUSES.includes(task.status) || task.assigned_to !== ctx.userId) {
    return withSensitiveNoStore(await forbiddenResponse('この申し送りの上長確認を確定できません'));
  }

  const traineeUserId = readStringMetadata(task.metadata, 'trainee_user_id');
  const supervisorUserId = readStringMetadata(task.metadata, 'supervisor_user_id');
  const metadataVisitRecordId = readStringMetadata(task.metadata, 'visit_record_id');
  const requestedVisitRecordVersion = readNumberMetadata(task.metadata, 'visit_record_version');

  if (
    metadataVisitRecordId !== id ||
    supervisorUserId !== ctx.userId ||
    traineeUserId === ctx.userId ||
    requestedVisitRecordVersion !== parsed.data.expected_visit_record_version
  ) {
    return withSensitiveNoStore(await forbiddenResponse('この申し送りの上長確認を確定できません'));
  }

  if (record.version !== parsed.data.expected_visit_record_version) {
    return withSensitiveNoStore(conflict('訪問記録が同時に更新されました。再読み込みしてください'));
  }

  try {
    const handoff = await confirmHandoff(prisma, {
      orgId: ctx.orgId,
      visitRecordId: id,
      confirmedBy: ctx.userId,
      expectedVersion: parsed.data.expected_visit_record_version,
      edits: parsed.data.edits,
      requestContext: ctx,
      confirmationBasis: 'supervision_task_assignee',
      supervisionReview: {
        taskId: task.id,
        traineeUserId,
        supervisorUserId: ctx.userId,
        requestedVisitRecordVersion,
      },
    });
    return withSensitiveNoStore(success(handoff));
  } catch (cause) {
    if (cause instanceof VisitHandoffMissingDataError) {
      return withSensitiveNoStore(
        notFound('引継ぎデータが見つかりません。AI抽出が完了していない可能性があります'),
      );
    }
    if (cause instanceof VisitHandoffInvalidDataError) {
      return withSensitiveNoStore(
        conflict('引継ぎデータの形式が不正です。AI抽出を再実行してから確定してください'),
      );
    }
    if (cause instanceof VisitHandoffStaleRecordError) {
      return withSensitiveNoStore(
        conflict('訪問記録が同時に更新されました。再読み込みしてください'),
      );
    }
    if (cause instanceof VisitHandoffAlreadyConfirmedError) {
      return withSensitiveNoStore(conflict('申し送りはすでに確認済みです'));
    }
    if (cause instanceof VisitHandoffSupervisionTaskUnavailableError) {
      return withSensitiveNoStore(
        conflict('上長確認タスクが同時に更新されました。再読み込みしてください'),
      );
    }
    return withSensitiveNoStore(error('internal_error', '上長確認の確定に失敗しました', 500));
  }
}

export async function POST(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}
