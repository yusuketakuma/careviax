import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, conflict } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { z } from 'zod';
import { canAccessCommunicationRequestRecord } from '@/server/services/communication-request-access';
import { requiredTrimmedStringSchema } from '@/lib/validations/communication-request';
import { requireWritablePatient } from '@/server/services/patient-write-guard';
import {
  buildCommunicationResponseIntentKey,
  isUniqueConstraintError,
} from '@/lib/communication-response-idempotency';

const createResponseSchema = z.object({
  responder_name: requiredTrimmedStringSchema('回答者名は必須です'),
  content: requiredTrimmedStringSchema('回答内容は必須です'),
  responded_at: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}/, '日付形式が不正です'),
});

async function requireWritableCommunicationPatient(
  ctx: Parameters<typeof requireWritablePatient>[1],
  scope: { patient_id: string | null; case_id: string | null },
) {
  if (scope.patient_id) {
    return requireWritablePatient(prisma, ctx, scope.patient_id);
  }

  if (!scope.case_id) return null;

  const careCase = await prisma.careCase.findFirst({
    where: { id: scope.case_id, org_id: ctx.orgId },
    select: { patient_id: true },
  });
  if (!careCase) return null;

  return requireWritablePatient(prisma, ctx, careCase.patient_id);
}

export const GET = withAuthContext(
  async (_req: NextRequest, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('連携依頼IDが不正です');

    const request = await prisma.communicationRequest.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true, patient_id: true, case_id: true },
    });
    if (!request) return notFound('依頼が見つかりません');
    if (
      !(await canAccessCommunicationRequestRecord({
        db: prisma,
        orgId: ctx.orgId,
        patientId: request.patient_id,
        caseId: request.case_id,
        accessContext: ctx,
      }))
    ) {
      return notFound('依頼が見つかりません');
    }

    const responses = await prisma.communicationResponse.findMany({
      where: { request_id: id, org_id: ctx.orgId },
      orderBy: { responded_at: 'desc' },
    });

    return success({ data: responses });
  },
  {
    permission: 'canReport',
    message: '連携依頼の閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req: NextRequest, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('連携依頼IDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createResponseSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const existingRequest = await prisma.communicationRequest.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true, patient_id: true, case_id: true, status: true },
    });
    if (!existingRequest) return notFound('依頼が見つかりません');
    if (
      !(await canAccessCommunicationRequestRecord({
        db: prisma,
        orgId: ctx.orgId,
        patientId: existingRequest.patient_id,
        caseId: existingRequest.case_id,
        accessContext: ctx,
      }))
    ) {
      return notFound('依頼が見つかりません');
    }
    if (['closed', 'cancelled', 'expired'].includes(existingRequest.status)) {
      return validationError('完了・取消・期限切れの依頼には返信を追加できません');
    }

    const writable = await requireWritableCommunicationPatient(ctx, existingRequest);
    if (writable && 'response' in writable) return writable.response;

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const respondedAt = new Date(parsed.data.responded_at);
      const responseIntentKey = buildCommunicationResponseIntentKey({
        requestId: id,
        responderName: parsed.data.responder_name,
        content: parsed.data.content,
        respondedAt,
      });

      const responseLookupWhere = {
        org_id: ctx.orgId,
        request_id: id,
        OR: [
          { response_intent_key: responseIntentKey },
          {
            response_intent_key: null,
            responder_name: parsed.data.responder_name,
            content: parsed.data.content,
            responded_at: respondedAt,
          },
        ],
      };

      const existingResponse = await tx.communicationResponse.findFirst({
        where: responseLookupWhere,
      });
      if (existingResponse) {
        return { response: existingResponse, created: false };
      }

      const claim = await tx.communicationRequest.updateMany({
        where: {
          id,
          org_id: ctx.orgId,
          status: existingRequest.status,
        },
        data: { status: 'responded' },
      });
      if (claim.count !== 1) {
        return { error: 'state_changed' as const };
      }

      let response;
      try {
        response = await tx.communicationResponse.create({
          data: {
            org_id: ctx.orgId,
            request_id: id,
            responder_name: parsed.data.responder_name,
            content: parsed.data.content,
            responded_at: respondedAt,
            response_intent_key: responseIntentKey,
          },
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;

        const responseCreatedByConcurrentRetry = await tx.communicationResponse.findFirst({
          where: {
            org_id: ctx.orgId,
            request_id: id,
            response_intent_key: responseIntentKey,
          },
        });
        if (!responseCreatedByConcurrentRetry) throw error;

        return { response: responseCreatedByConcurrentRetry, created: false };
      }

      return { response, created: true };
    });

    if ('error' in result) {
      return conflict('連携依頼が同時に更新されました。再読み込みしてください');
    }

    return success({ data: result.response }, result.created ? 201 : 200);
  },
  {
    permission: 'canReport',
    message: '連携依頼の更新権限がありません',
  },
);
