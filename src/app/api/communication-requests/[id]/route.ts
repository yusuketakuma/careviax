import { auth } from '@/lib/auth/config';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, forbidden } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { NextRequest } from 'next/server';
import { z } from 'zod';

const patchCommunicationRequestSchema = z.object({
  status: z
    .enum([
      'draft',
      'sent',
      'received',
      'in_progress',
      'responded',
      'closed',
      'escalated',
      'cancelled',
      'expired',
    ])
    .optional(),
  response: z
    .object({
      responder_name: z.string().min(1, '返信者名は必須です'),
      content: z.string().min(1, '返信内容は必須です'),
      responded_at: z.string().datetime().optional(),
    })
    .optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json(
      { code: 'AUTH_UNAUTHENTICATED', message: '認証が必要です' },
      { status: 401 }
    );
  }

  const orgId = req.headers.get('x-org-id');
  if (!orgId) {
    return Response.json(
      { code: 'AUTH_NO_ORG', message: '組織IDが必要です' },
      { status: 400 }
    );
  }

  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = patchCommunicationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { status, response } = parsed.data;

  const existing = await prisma.communicationRequest.findFirst({
    where: { id, org_id: orgId },
    select: { id: true, status: true },
  });

  if (!existing) return notFound('依頼が見つかりません');

  if (existing.status === 'closed' || existing.status === 'cancelled') {
    return forbidden('完了または取消済みの依頼は変更できません');
  }

  const result = await withOrgContext(orgId, async (tx) => {
    if (response) {
      await tx.communicationResponse.create({
        data: {
          org_id: orgId,
          request_id: id,
          responder_name: response.responder_name,
          content: response.content,
          responded_at: response.responded_at
            ? new Date(response.responded_at)
            : new Date(),
        },
      });
    }

    const updated = await tx.communicationRequest.update({
      where: { id },
      data: {
        ...(status ? { status } : {}),
        // Auto-advance status when response is added
        ...(response && !status ? { status: 'responded' } : {}),
      },
      select: {
        id: true,
        org_id: true,
        patient_id: true,
        case_id: true,
        request_type: true,
        status: true,
        subject: true,
        content: true,
        requested_by: true,
        requested_at: true,
        due_date: true,
        updated_at: true,
        responses: {
          orderBy: { responded_at: 'desc' },
          select: {
            id: true,
            responder_name: true,
            content: true,
            responded_at: true,
          },
        },
      },
    });

    return updated;
  });

  return success({ data: result });
}
