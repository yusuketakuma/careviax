import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { hasPermission } from '@/lib/auth/permissions';
import { requireAuthContext } from '@/lib/auth/context';
import { conflict, forbidden, notFound, success, validationError } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import {
  buildCommunicationResponseIntentKey,
  isUniqueConstraintError,
} from '@/lib/communication-response-idempotency';
import {
  requiredTrimmedStringSchema,
  trimStringOrUndefined,
} from '@/lib/validations/communication-request';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import {
  canAccessCommunicationRequestRecord,
  resolveTracingReportCommunicationScope,
} from '@/server/services/communication-request-access';
import { requireWritablePatient } from '@/server/services/patient-write-guard';
import { NextRequest } from 'next/server';
import { z } from 'zod';

const RESOLVABLE_REQUEST_STATUSES = new Set([
  'sent',
  'received',
  'in_progress',
  'responded',
  'escalated',
]);

const resolveFollowupSchema = z.object({
  expected_updated_at: z.string().datetime('版情報が不正です'),
  response: z
    .object({
      responder_name: requiredTrimmedStringSchema('返信者名は必須です'),
      content: requiredTrimmedStringSchema('返信内容は必須です'),
      responded_at: z.preprocess(trimStringOrUndefined, z.string().datetime().optional()),
    })
    .optional(),
  followup: z.preprocess(
    trimStringOrUndefined,
    z.string().max(4000, '次回カードへ残すことは4000文字以内で入力してください').optional(),
  ),
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

function readPersistedId(value: unknown) {
  if (typeof value !== 'object' || value === null || !('id' in value)) return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}

function buildFollowupTaskTitle(subject: string) {
  return `返信フォロー: ${subject}`.slice(0, 200);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canReport',
    message: '連携依頼の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('連携依頼IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = resolveFollowupSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { response, followup } = parsed.data;
  const expectedUpdatedAt = new Date(parsed.data.expected_updated_at);
  if (followup && !hasPermission(ctx.role, 'canVisit')) {
    return forbidden('運用タスクの作成権限がありません');
  }

  const existing = await prisma.communicationRequest.findFirst({
    where: { id, org_id: ctx.orgId },
    select: {
      id: true,
      patient_id: true,
      case_id: true,
      status: true,
      updated_at: true,
      subject: true,
      recipient_name: true,
      related_entity_type: true,
      related_entity_id: true,
    },
  });
  if (!existing) return notFound('依頼が見つかりません');

  if (
    !(await canAccessCommunicationRequestRecord({
      db: prisma,
      orgId: ctx.orgId,
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
  if (!RESOLVABLE_REQUEST_STATUSES.has(existing.status)) {
    return validationError(`${existing.status} から closed へは遷移できません`);
  }
  if (existing.updated_at.getTime() !== expectedUpdatedAt.getTime()) {
    return conflict('連携依頼が同時に更新されました。再読み込みしてください');
  }

  let linkedTracingReport: {
    id: string;
    patient_id: string;
    case_id: string | null;
    status: 'draft' | 'sent' | 'received' | 'acknowledged';
    sent_at: Date | null;
    acknowledged_at: Date | null;
  } | null = null;

  if (existing.related_entity_type === 'tracing_report' && existing.related_entity_id) {
    linkedTracingReport = await prisma.tracingReport.findFirst({
      where: { id: existing.related_entity_id, org_id: ctx.orgId },
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
        orgId: ctx.orgId,
        patientId: resolvedScope.patientId,
        caseId: resolvedScope.caseId,
        accessContext: ctx,
      }))
    ) {
      return notFound('トレーシングレポートが見つかりません');
    }
  }

  const result = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const claim = await tx.communicationRequest.updateMany({
        where: {
          id,
          org_id: ctx.orgId,
          status: existing.status,
          updated_at: expectedUpdatedAt,
        },
        data: { status: 'closed' },
      });
      if (claim.count !== 1) {
        return { error: 'state_changed' as const };
      }

      let responseRecord: unknown = null;
      if (response) {
        const respondedAt = response.responded_at ? new Date(response.responded_at) : new Date();
        const responseIntentKey = buildCommunicationResponseIntentKey({
          requestId: id,
          responderName: response.responder_name,
          content: response.content,
          respondedAt: response.responded_at ? respondedAt : null,
        });
        const responseLookupWhere = {
          org_id: ctx.orgId,
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
        };
        const existingResponse = await tx.communicationResponse.findFirst({
          where: responseLookupWhere,
        });
        if (existingResponse) {
          responseRecord = existingResponse;
        } else {
          try {
            responseRecord = await tx.communicationResponse.create({
              data: {
                org_id: ctx.orgId,
                request_id: id,
                responder_name: response.responder_name,
                content: response.content,
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
            responseRecord = responseCreatedByConcurrentRetry;
          }
        }
      }

      const taskRecord = followup
        ? await upsertOperationalTask(tx, {
            orgId: ctx.orgId,
            taskType: 'report_response_followup',
            title: buildFollowupTaskTitle(existing.subject),
            description: followup,
            priority: 'normal',
            dedupeKey: `communication-request-followup:${id}`,
            relatedEntityType: existing.patient_id ? 'patient' : null,
            relatedEntityId: existing.patient_id,
            metadata: {
              communication_request_id: id,
              source: 'communication_request_resolve_followup',
            },
          })
        : null;

      const updated = await tx.communicationRequest.findFirst({
        where: { id, org_id: ctx.orgId },
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

      await createAuditLogEntry(tx, ctx, {
        action: 'communication_request_status_changed',
        targetType: 'communication_request',
        targetId: id,
        changes: {
          from_status: existing.status,
          to_status: 'closed',
          reason: followup
            ? `フォロー対応済み（次回カードへ残す）: ${followup}`
            : 'フォロー対応済み',
          status_change_reason: followup
            ? `フォロー対応済み（次回カードへ残す）: ${followup}`
            : 'フォロー対応済み',
          response_id: readPersistedId(responseRecord),
          followup_task_id: readPersistedId(taskRecord),
          linked_tracing_report_id:
            updated.related_entity_type === 'tracing_report' ? updated.related_entity_id : null,
          actor_id: ctx.userId,
        },
      });

      if (linkedTracingReport) {
        await tx.tracingReport.update({
          where: { id: linkedTracingReport.id },
          data: {
            status: 'acknowledged',
            sent_to_physician: updated.recipient_name,
            pdf_url: `/api/tracing-reports/${linkedTracingReport.id}/pdf`,
            ...(!linkedTracingReport.acknowledged_at ? { acknowledged_at: new Date() } : {}),
          },
        });

        if (linkedTracingReport.status !== 'acknowledged') {
          await createAuditLogEntry(tx, ctx, {
            action: 'tracing_report_status_changed',
            targetType: 'tracing_report',
            targetId: linkedTracingReport.id,
            changes: {
              from_status: linkedTracingReport.status,
              to_status: 'acknowledged',
              reason: followup
                ? `フォロー対応済み（次回カードへ残す）: ${followup}`
                : 'フォロー対応済み',
              status_change_reason: followup
                ? `フォロー対応済み（次回カードへ残す）: ${followup}`
                : 'フォロー対応済み',
              linked_communication_request_id: updated.id,
              actor_id: ctx.userId,
            },
          });
        }
      }

      return { request: updated, response: responseRecord, task: taskRecord };
    },
    { requestContext: ctx },
  );

  if ('error' in result) {
    return conflict('連携依頼が同時に更新されました。再読み込みしてください');
  }

  return success({ data: result });
}
