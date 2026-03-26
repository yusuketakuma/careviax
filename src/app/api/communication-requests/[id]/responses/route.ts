import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

const createResponseSchema = z.object({
  responder_name: z.string().min(1, '回答者名は必須です'),
  content: z.string().min(1, '回答内容は必須です'),
  responded_at: z.string().regex(/^\d{4}-\d{2}-\d{2}/, '日付形式が不正です'),
});

export const GET = withAuthContext(
  async (
    _req: NextRequest,
    ctx,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    const { id } = await params;

    const request = await prisma.communicationRequest.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true },
    });
    if (!request) return notFound('依頼が見つかりません');

    const responses = await prisma.communicationResponse.findMany({
      where: { request_id: id, org_id: ctx.orgId },
      orderBy: { responded_at: 'desc' },
    });

    return success({ data: responses });
  },
  {
    permission: 'canReport',
    message: '連携依頼の閲覧権限がありません',
  }
);

export const POST = withAuthContext(
  async (
    req: NextRequest,
    ctx,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    const { id } = await params;

    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = createResponseSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const existingRequest = await prisma.communicationRequest.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true, status: true },
    });
    if (!existingRequest) return notFound('依頼が見つかりません');

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
  }
);
