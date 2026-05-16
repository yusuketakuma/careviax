import { requireAuthContext } from '@/lib/auth/context';
import { fetchEmergencyContacts } from '@/lib/patient/emergency-contacts';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, forbidden } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  canAccessCommunicationRequestRecord,
  resolveTracingReportCommunicationScope,
} from '@/server/services/communication-request-access';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canReport',
    message: '連携依頼の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;
  const orgId = ctx.orgId;

  const { id } = await params;

  const request = await prisma.communicationRequest.findFirst({
    where: { id, org_id: orgId },
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

  if (!request) return notFound('依頼が見つかりません');
  if (
    !(await canAccessCommunicationRequestRecord({
      db: prisma,
      orgId,
      patientId: request.patient_id,
      caseId: request.case_id,
      accessContext: ctx,
    }))
  ) {
    return notFound('依頼が見つかりません');
  }

  // FVD-01C: Include emergency contacts as SSOT for contact target suggestions
  // Avoids re-inferring contacts from care team on every communication request load
  const emergencyContacts = request.patient_id
    ? await fetchEmergencyContacts(prisma, orgId, request.patient_id)
    : [];

  return success({
    data: {
      ...request,
      suggested_contacts: emergencyContacts,
    },
  });
}

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
  status_change_reason: z
    .string()
    .trim()
    .min(1, 'ステータス変更理由は必須です')
    .max(500, 'ステータス変更理由は500文字以内で入力してください')
    .optional(),
  response: z
    .object({
      responder_name: z.string().min(1, '返信者名は必須です'),
      content: z.string().min(1, '返信内容は必須です'),
      responded_at: z.string().datetime().optional(),
    })
    .optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const { status, status_change_reason: statusChangeReason, response } = parsed.data;
  const nextStatus = status ?? (response ? 'responded' : undefined);

  const existing = await prisma.communicationRequest.findFirst({
    where: { id, org_id: orgId },
    select: {
      id: true,
      patient_id: true,
      case_id: true,
      status: true,
      related_entity_type: true,
      related_entity_id: true,
    },
  });

  if (!existing) return notFound('依頼が見つかりません');
  if (
    !(await canAccessCommunicationRequestRecord({
      db: prisma,
      orgId,
      patientId: existing.patient_id,
      caseId: existing.case_id,
      accessContext: ctx,
    }))
  ) {
    return notFound('依頼が見つかりません');
  }

  if (existing.status === 'closed' || existing.status === 'cancelled') {
    return forbidden('完了または取消済みの依頼は変更できません');
  }

  if (nextStatus && nextStatus !== existing.status) {
    if (!statusChangeReason && !response) {
      return validationError('ステータス変更理由は必須です', {
        status_change_reason: ['ステータス変更理由は必須です'],
      });
    }
    const allowed = ALLOWED_STATUS_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(nextStatus)) {
      return validationError(`${existing.status} から ${nextStatus} へは遷移できません`);
    }
  }

  const statusChanged = !!nextStatus && nextStatus !== existing.status;
  let linkedTracingReport: {
    id: string;
    patient_id: string;
    case_id: string | null;
    status: 'draft' | 'sent' | 'received' | 'acknowledged';
    sent_at: Date | null;
    acknowledged_at: Date | null;
  } | null = null;

  if (
    statusChanged &&
    existing.related_entity_type === 'tracing_report' &&
    existing.related_entity_id
  ) {
    linkedTracingReport = await prisma.tracingReport.findFirst({
      where: {
        id: existing.related_entity_id,
        org_id: orgId,
      },
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        status: true,
        sent_at: true,
        acknowledged_at: true,
      },
    });

    if (!linkedTracingReport) return notFound('トレーシングレポートが見つかりません');

    const resolvedScope = resolveTracingReportCommunicationScope({
      requestedPatientId: existing.patient_id,
      requestedCaseId: existing.case_id,
      tracingReport: linkedTracingReport,
    });

    if (!resolvedScope) {
      return validationError('関連トレーシングレポートと患者またはケースが一致しません', {
        related_entity_id: ['関連トレーシングレポートと患者またはケースが一致しません'],
      });
    }

    if (
      !(await canAccessCommunicationRequestRecord({
        db: prisma,
        orgId,
        patientId: resolvedScope.patientId,
        caseId: resolvedScope.caseId,
        accessContext: ctx,
      }))
    ) {
      return notFound('トレーシングレポートが見つかりません');
    }
  }

  const result = await withOrgContext(
    orgId,
    async (tx) => {
      let responseId: string | null = null;
      if (response) {
        const createdResponse = await tx.communicationResponse.create({
          data: {
            org_id: orgId,
            request_id: id,
            responder_name: response.responder_name,
            content: response.content,
            responded_at: response.responded_at ? new Date(response.responded_at) : new Date(),
          },
        });
        responseId = createdResponse.id;
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

      if (statusChanged) {
        await tx.auditLog.create({
          data: {
            org_id: orgId,
            actor_id: ctx.userId,
            action: 'communication_request_status_changed',
            target_type: 'communication_request',
            target_id: id,
            changes: {
              from_status: existing.status,
              to_status: nextStatus,
              reason: statusChangeReason ?? 'communication_response_recorded',
              status_change_reason: statusChangeReason ?? null,
              response_id: responseId,
              linked_tracing_report_id:
                updated.related_entity_type === 'tracing_report' ? updated.related_entity_id : null,
              actor_id: ctx.userId,
            },
          },
        });
      }

      if (linkedTracingReport && nextStatus) {
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
            where: { id: linkedTracingReport.id },
            data: {
              status: tracingStatus,
              sent_to_physician: updated.recipient_name,
              pdf_url: `/api/tracing-reports/${linkedTracingReport.id}/pdf`,
              ...(tracingStatus === 'sent' && !linkedTracingReport.sent_at
                ? { sent_at: new Date() }
                : {}),
              ...(tracingStatus === 'acknowledged' && !linkedTracingReport.acknowledged_at
                ? { acknowledged_at: new Date() }
                : {}),
            },
          });

          if (tracingStatus !== linkedTracingReport.status) {
            await tx.auditLog.create({
              data: {
                org_id: orgId,
                actor_id: ctx.userId,
                action: 'tracing_report_status_changed',
                target_type: 'tracing_report',
                target_id: linkedTracingReport.id,
                changes: {
                  from_status: linkedTracingReport.status,
                  to_status: tracingStatus,
                  reason: statusChangeReason ?? 'communication_response_recorded',
                  status_change_reason: statusChangeReason ?? null,
                  linked_communication_request_id: updated.id,
                  actor_id: ctx.userId,
                },
              },
            });
          }
        }
      }

      return updated;
    },
    { requestContext: ctx },
  );

  return success({ data: result });
}
