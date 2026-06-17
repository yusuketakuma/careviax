import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { requireAuthContext } from '@/lib/auth/context';
import { fetchEmergencyContacts } from '@/lib/patient/emergency-contacts';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, forbidden, conflict } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  optionalCommunicationRequestStatusSchema,
  requiredTrimmedStringSchema,
  trimStringOrUndefined,
} from '@/lib/validations/communication-request';
import {
  canAccessCommunicationRequestRecord,
  resolveTracingReportCommunicationScope,
} from '@/server/services/communication-request-access';
import { requireWritablePatient } from '@/server/services/patient-write-guard';
import {
  buildCommunicationResponseIntentKey,
  isUniqueConstraintError,
} from '@/lib/communication-response-idempotency';

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

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canReport',
    message: '連携依頼の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;
  const orgId = ctx.orgId;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('連携依頼IDが不正です');

  const requestScope = await prisma.communicationRequest.findFirst({
    where: { id, org_id: orgId },
    select: {
      id: true,
      patient_id: true,
      case_id: true,
    },
  });

  if (!requestScope) return notFound('依頼が見つかりません');
  if (
    !(await canAccessCommunicationRequestRecord({
      db: prisma,
      orgId,
      patientId: requestScope.patient_id,
      caseId: requestScope.case_id,
      accessContext: ctx,
    }))
  ) {
    return notFound('依頼が見つかりません');
  }

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
  status: optionalCommunicationRequestStatusSchema,
  status_change_reason: z
    .string()
    .trim()
    .min(1, 'ステータス変更理由は必須です')
    .max(500, 'ステータス変更理由は500文字以内で入力してください')
    .optional(),
  response: z
    .object({
      responder_name: requiredTrimmedStringSchema('返信者名は必須です'),
      content: requiredTrimmedStringSchema('返信内容は必須です'),
      responded_at: z.preprocess(trimStringOrUndefined, z.string().datetime().optional()),
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

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('連携依頼IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = patchCommunicationRequestSchema.safeParse(payload);
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

  const writable = await requireWritableCommunicationPatient(ctx, existing);
  if (writable && 'response' in writable) return writable.response;

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
      if (nextStatus) {
        const claim = await tx.communicationRequest.updateMany({
          where: {
            id,
            org_id: orgId,
            status: existing.status,
          },
          data: {
            status: nextStatus,
          },
        });
        if (claim.count !== 1) {
          return { error: 'state_changed' as const };
        }
      }

      let responseId: string | null = null;
      if (response) {
        const respondedAt = response.responded_at ? new Date(response.responded_at) : new Date();
        const responseIntentKey = buildCommunicationResponseIntentKey({
          requestId: id,
          responderName: response.responder_name,
          content: response.content,
          respondedAt: response.responded_at ? respondedAt : null,
        });
        const existingResponse = await tx.communicationResponse.findFirst({
          where: {
            org_id: orgId,
            request_id: id,
            OR: [
              { response_intent_key: responseIntentKey },
              {
                response_intent_key: null,
                responder_name: response.responder_name,
                content: response.content,
                responded_at: respondedAt,
              },
            ],
          },
        });
        if (existingResponse) {
          responseId = existingResponse.id;
        } else {
          let createdResponse;
          try {
            createdResponse = await tx.communicationResponse.create({
              data: {
                org_id: orgId,
                request_id: id,
                responder_name: response.responder_name,
                content: response.content,
                responded_at: respondedAt,
                response_intent_key: responseIntentKey,
              },
            });
          } catch (error) {
            if (!isUniqueConstraintError(error)) throw error;

            createdResponse = await tx.communicationResponse.findFirst({
              where: {
                org_id: orgId,
                request_id: id,
                response_intent_key: responseIntentKey,
              },
            });
            if (!createdResponse) throw error;
          }
          responseId = createdResponse.id;
        }
      }

      const updated = await tx.communicationRequest.findFirst({
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
      if (!updated) {
        return { error: 'state_changed' as const };
      }

      if (statusChanged) {
        await createAuditLogEntry(tx, ctx, {
          action: 'communication_request_status_changed',
          targetType: 'communication_request',
          targetId: id,
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
            await createAuditLogEntry(tx, ctx, {
              action: 'tracing_report_status_changed',
              targetType: 'tracing_report',
              targetId: linkedTracingReport.id,
              changes: {
                from_status: linkedTracingReport.status,
                to_status: tracingStatus,
                reason: statusChangeReason ?? 'communication_response_recorded',
                status_change_reason: statusChangeReason ?? null,
                linked_communication_request_id: updated.id,
                actor_id: ctx.userId,
              },
            });
          }
        }
      }

      return updated;
    },
    { requestContext: ctx },
  );

  if ('error' in result) {
    return conflict('連携依頼が同時に更新されました。再読み込みしてください');
  }

  return success({ data: result });
}
