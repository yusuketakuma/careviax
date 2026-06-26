import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { requireAuthContext } from '@/lib/auth/context';
import { fetchEmergencyContacts } from '@/lib/patient/emergency-contacts';
import { withOrgContext } from '@/lib/db/rls';
import {
  success,
  validationError,
  notFound,
  forbidden,
  conflict,
  internalError,
} from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { buildTracingReportPdfPath } from '@/lib/reports/tracing-report-pdf-path';
import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  communicationResponseContentSchema,
  optionalCommunicationRequestStatusSchema,
  requiredTrimmedStringSchema,
  trimStringOrUndefined,
} from '@/lib/validations/communication-request';
import {
  canAccessCareReportCommunication,
  canAccessCommunicationRequestRecord,
  isCareReportCommunicationRequest,
  requireWritableCommunicationRequestPatient,
  resolveTracingReportCommunicationScope,
} from '@/server/services/communication-request-access';
import { buildCommunicationResponseContentDigest } from '@/lib/communication-response-idempotency';
import {
  findCommunicationResponseByIntent,
  upsertCommunicationResponseByIntent,
} from '@/server/services/communication-response-upsert';

async function authenticatedGET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
      related_entity_type: true,
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
  if (
    isCareReportCommunicationRequest(requestScope.related_entity_type) &&
    !canAccessCareReportCommunication(ctx.role)
  ) {
    return forbidden('報告書共有の閲覧権限がありません');
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
        orderBy: [{ responded_at: 'desc' }, { id: 'desc' }],
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

export async function GET(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
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
  expected_updated_at: z.string().datetime('版情報が不正です'),
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
      content: communicationResponseContentSchema,
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

  const {
    expected_updated_at: expectedUpdatedAtRaw,
    status,
    status_change_reason: statusChangeReason,
    response,
  } = parsed.data;
  const expectedUpdatedAt = new Date(expectedUpdatedAtRaw);
  const nextStatus = status ?? (response ? 'responded' : undefined);

  const existing = await prisma.communicationRequest.findFirst({
    where: { id, org_id: orgId },
    select: {
      id: true,
      patient_id: true,
      case_id: true,
      status: true,
      updated_at: true,
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
  if (
    isCareReportCommunicationRequest(existing.related_entity_type) &&
    !canAccessCareReportCommunication(ctx.role)
  ) {
    return forbidden('報告書共有の更新権限がありません');
  }

  const writable = await requireWritableCommunicationRequestPatient({
    db: prisma,
    ctx,
    scope: existing,
  });
  if (writable && 'response' in writable) return writable.response;

  if (existing.status === 'closed' || existing.status === 'cancelled') {
    return forbidden('完了または取消済みの依頼は変更できません');
  }

  if (existing.updated_at.getTime() !== expectedUpdatedAt.getTime()) {
    if (response && existing.status === 'responded' && (!status || status === existing.status)) {
      const respondedAt = response.responded_at ? new Date(response.responded_at) : new Date();
      const existingResponse = await findCommunicationResponseByIntent({
        db: prisma,
        orgId,
        requestId: id,
        responderName: response.responder_name,
        content: response.content,
        respondedAt,
        intentRespondedAt: response.responded_at ? respondedAt : null,
      });
      if (existingResponse.response) {
        const current = await prisma.communicationRequest.findFirst({
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
              orderBy: [{ responded_at: 'desc' }, { id: 'desc' }],
              select: {
                id: true,
                responder_name: true,
                content: true,
                responded_at: true,
              },
            },
          },
        });
        if (current) return success({ data: current });
      }
    }
    return conflict('連携依頼が同時に更新されました。再読み込みしてください');
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
      if (statusChanged) {
        const claim = await tx.communicationRequest.updateMany({
          where: {
            id,
            org_id: orgId,
            status: existing.status,
            updated_at: expectedUpdatedAt,
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
      let responseRespondedAt: Date | null = null;
      let responseRecord: Awaited<ReturnType<typeof upsertCommunicationResponseByIntent>> | null =
        null;
      if (response) {
        const respondedAt = response.responded_at ? new Date(response.responded_at) : new Date();
        responseRespondedAt = respondedAt;
        const responseArgs = {
          db: tx,
          orgId,
          requestId: id,
          responderName: response.responder_name,
          content: response.content,
          respondedAt,
          intentRespondedAt: response.responded_at ? respondedAt : null,
        };
        if (!statusChanged) {
          const existingResponse = await findCommunicationResponseByIntent(responseArgs);
          if (existingResponse.response) {
            responseRecord = {
              response: existingResponse.response,
              created: false,
              responseIntentKey: existingResponse.responseIntentKey,
            };
          } else {
            const claim = await tx.communicationRequest.updateMany({
              where: {
                id,
                org_id: orgId,
                status: existing.status,
                updated_at: expectedUpdatedAt,
              },
              data: { updated_at: new Date() },
            });
            if (claim.count !== 1) {
              return { error: 'state_changed' as const };
            }
          }
        }
        responseRecord ??= await upsertCommunicationResponseByIntent(responseArgs);
        responseId = responseRecord.response.id;
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
            orderBy: [{ responded_at: 'desc' }, { id: 'desc' }],
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

      if (response && responseRecord?.created && !statusChanged) {
        const respondedAt = responseRespondedAt ?? new Date();
        await createAuditLogEntry(tx, ctx, {
          action: 'communication_response_recorded',
          targetType: 'communication_request',
          targetId: id,
          changes: {
            from_status: existing.status,
            to_status: updated.status,
            response_id: responseRecord.response.id,
            response_created: true,
            response_intent_key: responseRecord.responseIntentKey,
            responder_name: response.responder_name,
            response_content_digest: buildCommunicationResponseContentDigest({
              requestId: id,
              responseId: responseRecord.response.id,
              content: response.content,
            }),
            response_content_length: response.content.length,
            responded_at: respondedAt.toISOString(),
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
              pdf_url: buildTracingReportPdfPath(linkedTracingReport.id),
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
