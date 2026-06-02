import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { z } from 'zod';
import { canAccessCommunicationRequestRecord } from '@/server/services/communication-request-access';
import { requiredTrimmedStringSchema } from '@/lib/validations/communication-request';

const createResponseSchema = z.object({
  responder_name: requiredTrimmedStringSchema('回答者名は必須です'),
  content: requiredTrimmedStringSchema('回答内容は必須です'),
  responded_at: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}/, '日付形式が不正です'),
});

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

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const response = await tx.communicationResponse.create({
        data: {
          org_id: ctx.orgId,
          request_id: id,
          responder_name: parsed.data.responder_name,
          content: parsed.data.content,
          responded_at: new Date(parsed.data.responded_at),
        },
      });

      await tx.communicationRequest.update({
        where: { id },
        data: { status: 'responded' },
      });

      return response;
    });

    return success({ data: result }, 201);
  },
  {
    permission: 'canReport',
    message: '連携依頼の更新権限がありません',
  },
);
