import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, forbidden } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { NextRequest } from 'next/server';
import { z } from 'zod';

const ALLOWED_STATUS_TRANSITIONS: Record<
  string,
  Array<
    | 'draft'
    | 'sent'
    | 'received'
    | 'in_progress'
    | 'responded'
    | 'closed'
    | 'escalated'
    | 'cancelled'
    | 'expired'
  >
> = {
  draft: ['sent', 'cancelled', 'expired'],
  sent: ['received', 'in_progress', 'responded', 'closed', 'escalated', 'cancelled', 'expired'],
  received: ['in_progress', 'responded', 'closed', 'escalated', 'cancelled', 'expired'],
  in_progress: ['responded', 'closed', 'escalated', 'cancelled', 'expired'],
  responded: ['closed', 'escalated'],
  escalated: ['received', 'in_progress', 'responded', 'closed', 'cancelled', 'expired'],
  closed: [],
  cancelled: [],
  expired: [],
};

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
  const authResult = await requireAuthContext(req, {
    permission: 'canReport',
    message: '連携依頼の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;
  const orgId = ctx.orgId;

  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = patchCommunicationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { status, response } = parsed.data;
  const nextStatus = status ?? (response ? 'responded' : undefined);

  const existing = await prisma.communicationRequest.findFirst({
    where: { id, org_id: orgId },
    select: { id: true, status: true },
  });

  if (!existing) return notFound('依頼が見つかりません');

  if (existing.status === 'closed' || existing.status === 'cancelled') {
    return forbidden('完了または取消済みの依頼は変更できません');
  }

  if (nextStatus && nextStatus !== existing.status) {
    const allowed = ALLOWED_STATUS_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(nextStatus)) {
      return validationError(
        `${existing.status} から ${nextStatus} へは遷移できません`
      );
    }
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
        ...(nextStatus ? { status: nextStatus } : {}),
      },
      select: {
        id: true,
        org_id: true,
        patient_id: true,
        case_id: true,
        request_type: true,
        template_key: true,
        recipient_name: true,
        recipient_role: true,
        related_entity_type: true,
        related_entity_id: true,
        context_snapshot: true,
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

    if (
      updated.related_entity_type === 'tracing_report' &&
      updated.related_entity_id &&
      nextStatus
    ) {
      const tracingReport = await tx.tracingReport.findFirst({
        where: {
          id: updated.related_entity_id,
          org_id: orgId,
        },
        select: {
          id: true,
          sent_at: true,
          acknowledged_at: true,
        },
      });

      if (tracingReport) {
        const tracingStatus =
          nextStatus === 'draft'
            ? 'draft'
            : nextStatus === 'sent'
              ? 'sent'
              : ['received', 'in_progress', 'escalated'].includes(nextStatus)
                ? 'received'
                : ['responded', 'closed'].includes(nextStatus)
                  ? 'acknowledged'
                  : null;

        if (tracingStatus) {
          await tx.tracingReport.update({
            where: { id: tracingReport.id },
            data: {
              status: tracingStatus,
              sent_to_physician: updated.recipient_name,
              pdf_url: `/api/tracing-reports/${tracingReport.id}/pdf`,
              ...(tracingStatus === 'sent' && !tracingReport.sent_at ? { sent_at: new Date() } : {}),
              ...(tracingStatus === 'acknowledged' && !tracingReport.acknowledged_at
                ? { acknowledged_at: new Date() }
                : {}),
            },
          });
        }
      }
    }

    return updated;
  }, { requestContext: ctx });

  return success({ data: result });
}
