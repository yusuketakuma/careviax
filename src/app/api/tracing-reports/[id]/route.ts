import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, forbidden } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { canAccessCaseScopedPatientResource } from '@/server/services/patient-access';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canReport',
    message: 'トレーシングレポートの削除権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id } = await params;

  const existing = await prisma.tracingReport.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true, patient_id: true, case_id: true, status: true },
  });

  if (!existing) return notFound('トレーシングレポートが見つかりません');
  if (
    !(await canAccessCaseScopedPatientResource({
      db: prisma,
      orgId: ctx.orgId,
      patientId: existing.patient_id,
      caseId: existing.case_id,
      accessContext: { userId: ctx.userId, role: ctx.role },
    }))
  ) {
    return notFound('トレーシングレポートが見つかりません');
  }
  if (existing.status !== 'draft') {
    return forbidden('下書き以外のトレーシングレポートは削除できません');
  }

  await withOrgContext(
    ctx.orgId,
    async (tx) => {
      await tx.tracingReport.delete({ where: { id } });
    },
    { requestContext: ctx },
  );

  return success({ data: { id } });
}

const ALLOWED_TRACING_STATUS_TRANSITIONS: Record<
  'draft' | 'sent' | 'received' | 'acknowledged',
  Array<'draft' | 'sent' | 'received' | 'acknowledged'>
> = {
  draft: ['sent'],
  sent: ['received', 'acknowledged'],
  received: ['acknowledged'],
  acknowledged: [],
};

type TracingReportStatus = 'draft' | 'sent' | 'received' | 'acknowledged';

function isTracingReportStatus(value: string): value is TracingReportStatus {
  return ['draft', 'sent', 'received', 'acknowledged'].includes(value);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canReport',
    message: 'トレーシングレポートの更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return validationError('リクエストボディが不正です');
  }

  const status = typeof body.status === 'string' ? body.status : null;
  const sentToPhysician =
    typeof body.sent_to_physician === 'string' ? body.sent_to_physician.trim() : undefined;
  const channel =
    typeof body.channel === 'string' && body.channel.length > 0 ? body.channel : 'other';

  if (!status || !isTracingReportStatus(status)) {
    return validationError('status が不正です');
  }

  const existing = await prisma.tracingReport.findFirst({
    where: { id, org_id: ctx.orgId },
    select: {
      id: true,
      patient_id: true,
      case_id: true,
      status: true,
      sent_to_physician: true,
      sent_at: true,
      acknowledged_at: true,
    },
  });

  if (!existing) return notFound('トレーシングレポートが見つかりません');
  if (
    !(await canAccessCaseScopedPatientResource({
      db: prisma,
      orgId: ctx.orgId,
      patientId: existing.patient_id,
      caseId: existing.case_id,
      accessContext: { userId: ctx.userId, role: ctx.role },
    }))
  ) {
    return notFound('トレーシングレポートが見つかりません');
  }

  if (existing.status === 'acknowledged') {
    return forbidden('受領確認済みのトレーシングレポートは更新できません');
  }

  if (status !== existing.status) {
    const allowed = ALLOWED_TRACING_STATUS_TRANSITIONS[existing.status];
    if (!allowed.includes(status)) {
      return validationError(`${existing.status} から ${status} へは遷移できません`);
    }
  }

  const physicianName = sentToPhysician || existing.sent_to_physician || null;
  if (status === 'sent' && !physicianName) {
    return validationError('送付先医師名は必須です');
  }

  const result = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const updated = await tx.tracingReport.update({
        where: { id },
        data: {
          status,
          ...(physicianName ? { sent_to_physician: physicianName } : {}),
          ...(status === 'sent' && !existing.sent_at ? { sent_at: new Date() } : {}),
          ...(status === 'acknowledged' && !existing.acknowledged_at
            ? { acknowledged_at: new Date() }
            : {}),
          pdf_url: `/api/tracing-reports/${id}/pdf`,
        },
        select: {
          id: true,
          patient_id: true,
          case_id: true,
          issue_id: true,
          content: true,
          status: true,
          sent_to_physician: true,
          sent_at: true,
          acknowledged_at: true,
          pdf_url: true,
          created_at: true,
          updated_at: true,
        },
      });

      const linkedRequest = await tx.communicationRequest.findFirst({
        where: {
          org_id: ctx.orgId,
          related_entity_type: 'tracing_report',
          related_entity_id: id,
        },
        select: { id: true, status: true },
      });

      const linkedRequestStatus =
        status === 'sent' ? 'sent' : status === 'received' ? 'received' : 'closed';

      if (status !== 'draft') {
        if (linkedRequest) {
          await tx.communicationRequest.update({
            where: { id: linkedRequest.id },
            data: {
              status: linkedRequestStatus,
              recipient_name: physicianName,
            },
          });
        } else {
          await tx.communicationRequest.create({
            data: {
              org_id: ctx.orgId,
              patient_id: updated.patient_id,
              case_id: updated.case_id ?? null,
              request_type: 'tracing_report',
              template_key: 'tracing_report',
              recipient_name: physicianName,
              recipient_role: 'physician',
              related_entity_type: 'tracing_report',
              related_entity_id: id,
              status: linkedRequestStatus,
              subject: '服薬情報提供書',
              content: physicianName
                ? `${physicianName} 宛てのトレーシングレポート`
                : 'トレーシングレポート',
              requested_by: ctx.userId,
              due_date: null,
            },
          });
        }
      }

      if (status === 'sent' && existing.status !== 'sent') {
        await tx.communicationEvent.create({
          data: {
            org_id: ctx.orgId,
            patient_id: updated.patient_id,
            case_id: updated.case_id ?? null,
            event_type: 'tracing_report',
            channel: channel,
            direction: 'outbound',
            counterpart_name: physicianName,
            subject: '服薬情報提供書',
            content: physicianName
              ? `${physicianName} 宛てにトレーシングレポートを送付`
              : 'トレーシングレポートを送付',
            occurred_at: updated.sent_at ?? new Date(),
          },
        });
      }

      return updated;
    },
    { requestContext: ctx },
  );

  return success({ data: result });
}
