import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import {
  canRequestSupervisedVisitHandoffConfirmation,
  selectVisitHandoffSupervisionAssignee,
} from '@/lib/auth/visit-schedule-access';
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
  requestHandoffConfirmationSupervision,
  VisitHandoffAlreadyConfirmedError,
  VisitHandoffInvalidDataError,
  VisitHandoffMissingDataError,
  VisitHandoffStaleRecordError,
} from '@/server/services/visit-handoff';

const SUPERVISION_REQUEST_NOTE_MAX_LENGTH = 500;

const supervisionRequestSchema = z.object({
  expected_visit_record_version: z
    .number()
    .int('訪問記録の版情報が不正です')
    .positive('訪問記録の版情報が不正です'),
  request_note: z
    .string()
    .trim()
    .min(8, '依頼メモは8文字以上で入力してください')
    .max(SUPERVISION_REQUEST_NOTE_MAX_LENGTH, '依頼メモが長すぎます')
    .optional(),
});

const visitRecordSupervisionSelect = {
  id: true,
  version: true,
  schedule: {
    select: {
      pharmacist_id: true,
      case_: {
        select: {
          primary_pharmacist_id: true,
          backup_pharmacist_id: true,
        },
      },
    },
  },
} as const;

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

  const parsed = supervisionRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return withSensitiveNoStore(
      validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
    );
  }

  const record = await prisma.visitRecord.findFirst({
    where: { id, org_id: ctx.orgId },
    select: visitRecordSupervisionSelect,
  });
  if (!record) return withSensitiveNoStore(notFound('訪問記録が見つかりません'));

  if (!canRequestSupervisedVisitHandoffConfirmation(ctx, record.schedule)) {
    return withSensitiveNoStore(await forbiddenResponse('この申し送りの上長確認を依頼できません'));
  }

  const supervisorUserId = selectVisitHandoffSupervisionAssignee(record.schedule, ctx.userId);
  if (!supervisorUserId) {
    return withSensitiveNoStore(await forbiddenResponse('上長確認の依頼先が見つかりません'));
  }

  const supervisorMembership = await prisma.membership.findFirst({
    where: {
      org_id: ctx.orgId,
      user_id: supervisorUserId,
      is_active: true,
      role: { in: ['owner', 'admin', 'pharmacist'] },
    },
    select: { user_id: true },
  });
  if (!supervisorMembership || supervisorMembership.user_id === ctx.userId) {
    return withSensitiveNoStore(await forbiddenResponse('上長確認の依頼先が見つかりません'));
  }

  if (record.version !== parsed.data.expected_visit_record_version) {
    return withSensitiveNoStore(conflict('訪問記録が同時に更新されました。再読み込みしてください'));
  }

  try {
    const request = await requestHandoffConfirmationSupervision(prisma, {
      orgId: ctx.orgId,
      visitRecordId: id,
      traineeUserId: ctx.userId,
      supervisorUserId,
      expectedVersion: parsed.data.expected_visit_record_version,
      requestNote: parsed.data.request_note,
      requestContext: ctx,
    });
    return withSensitiveNoStore(success(request));
  } catch (cause) {
    if (cause instanceof VisitHandoffMissingDataError) {
      return withSensitiveNoStore(
        notFound('引継ぎデータが見つかりません。AI抽出が完了していない可能性があります'),
      );
    }
    if (cause instanceof VisitHandoffInvalidDataError) {
      return withSensitiveNoStore(
        conflict('引継ぎデータの形式が不正です。AI抽出を再実行してから依頼してください'),
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
    return withSensitiveNoStore(error('internal_error', '上長確認の依頼に失敗しました', 500));
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
