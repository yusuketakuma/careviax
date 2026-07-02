import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
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
import { buildTracingReportPdfPath } from '@/lib/reports/tracing-report-pdf-path';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';
import { z } from 'zod';
import {
  communicationChannelSchema,
  DEFAULT_COMMUNICATION_CHANNEL,
} from '@/lib/validations/communication-channel';
import {
  optionalTracingReportStatusSchema,
  type TracingReportStatusValue,
} from '@/lib/validations/tracing-report';
import { canAccessCaseScopedPatientResource } from '@/server/services/patient-access';

const ROUTE = '/api/tracing-reports/[id]';

function logUnhandledRouteError(method: string, err: unknown) {
  logger.error(
    {
      event: 'tracing_report_lifecycle_unhandled_error',
      route: ROUTE,
      method,
      status: 500,
    },
    err,
  );
}

async function authenticatedDELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authResult = await requireAuthContext(req, {
      permission: 'canAuthorReport',
      message: 'トレーシングレポートの削除権限がありません',
    });
    if ('response' in authResult) return withSensitiveNoStore(authResult.response);
    const { ctx } = authResult;

    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return withSensitiveNoStore(validationError('トレーシングレポートIDが不正です'));

    const existing = await prisma.tracingReport.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true, patient_id: true, case_id: true, status: true },
    });

    if (!existing) return withSensitiveNoStore(notFound('トレーシングレポートが見つかりません'));
    if (
      !(await canAccessCaseScopedPatientResource({
        db: prisma,
        orgId: ctx.orgId,
        patientId: existing.patient_id,
        caseId: existing.case_id,
        accessContext: { userId: ctx.userId, role: ctx.role },
      }))
    ) {
      return withSensitiveNoStore(notFound('トレーシングレポートが見つかりません'));
    }
    if (existing.status !== 'draft') {
      return withSensitiveNoStore(forbidden('下書き以外のトレーシングレポートは削除できません'));
    }

    const deleteResult = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        return tx.tracingReport.deleteMany({
          where: {
            id,
            org_id: ctx.orgId,
            patient_id: existing.patient_id,
            case_id: existing.case_id,
            status: 'draft',
          },
        });
      },
      { requestContext: ctx },
    );

    if (deleteResult.count !== 1) {
      return withSensitiveNoStore(
        conflict('トレーシングレポートが更新されています。最新の内容を確認してください'),
      );
    }

    return withSensitiveNoStore(success({ data: { id } }));
  } catch (err) {
    unstable_rethrow(err);
    logUnhandledRouteError('DELETE', err);
    return withSensitiveNoStore(internalError());
  }
}

export async function DELETE(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  return withRoutePerformance(req, async () => authenticatedDELETE(req, routeContext));
}

const ALLOWED_TRACING_STATUS_TRANSITIONS: Record<
  TracingReportStatusValue,
  TracingReportStatusValue[]
> = {
  draft: ['sent'],
  sent: ['received', 'acknowledged'],
  received: ['acknowledged'],
  acknowledged: [],
};

const patchTracingReportVersionSchema = z.object({
  expected_updated_at: z.string().datetime('版情報が不正です'),
});

class TracingReportPatchRollback extends Error {
  constructor() {
    super('tracing report patch transaction rolled back');
    this.name = 'TracingReportPatchRollback';
  }
}

// チャネル未指定時は自動送信可能な既定チャネル（ph_os_share）にフォールバックする。
// かつて存在した暗黙の 'fax' 既定（FAX ゲートウェイ未実装のため実際には送信されない
// 幻のチャネル）は廃止した。FAX を選ぶ場合は手動送付の記録として明示指定が必要。
function parseCommunicationChannel(value: unknown) {
  if (value === undefined || value === null) return DEFAULT_COMMUNICATION_CHANNEL;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed.length === 0) return DEFAULT_COMMUNICATION_CHANNEL;

  const parsed = communicationChannelSchema.safeParse(trimmed);
  return parsed.success ? parsed.data : null;
}

function parseStatusChangeReason(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function authenticatedPATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authResult = await requireAuthContext(req, {
      permission: 'canAuthorReport',
      message: 'トレーシングレポートの更新権限がありません',
    });
    if ('response' in authResult) return withSensitiveNoStore(authResult.response);
    const { ctx } = authResult;

    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return withSensitiveNoStore(validationError('トレーシングレポートIDが不正です'));

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) {
      return withSensitiveNoStore(validationError('リクエストボディが不正です'));
    }

    const parsedVersion = patchTracingReportVersionSchema.safeParse(payload);
    if (!parsedVersion.success) {
      return withSensitiveNoStore(
        validationError('入力値が不正です', parsedVersion.error.flatten().fieldErrors),
      );
    }
    const expectedUpdatedAtRaw = parsedVersion.data.expected_updated_at;
    const expectedUpdatedAt = new Date(expectedUpdatedAtRaw);

    const parsedStatus = optionalTracingReportStatusSchema.safeParse(payload.status);
    const status = parsedStatus.success ? parsedStatus.data : undefined;
    const sentToPhysician =
      typeof payload.sent_to_physician === 'string' ? payload.sent_to_physician.trim() : undefined;
    const channel = parseCommunicationChannel(payload.channel);
    const statusChangeReason = parseStatusChangeReason(payload.status_change_reason);

    if (!status) {
      return withSensitiveNoStore(validationError('status が不正です'));
    }
    if (!channel) {
      return withSensitiveNoStore(
        validationError('channel が不正です', {
          channel: ['channel が不正です'],
        }),
      );
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
        updated_at: true,
      },
    });

    if (!existing) return withSensitiveNoStore(notFound('トレーシングレポートが見つかりません'));
    if (
      !(await canAccessCaseScopedPatientResource({
        db: prisma,
        orgId: ctx.orgId,
        patientId: existing.patient_id,
        caseId: existing.case_id,
        accessContext: { userId: ctx.userId, role: ctx.role },
      }))
    ) {
      return withSensitiveNoStore(notFound('トレーシングレポートが見つかりません'));
    }

    if (existing.status === 'acknowledged') {
      return withSensitiveNoStore(forbidden('受領確認済みのトレーシングレポートは更新できません'));
    }

    if (existing.updated_at.getTime() !== expectedUpdatedAt.getTime()) {
      return withSensitiveNoStore(
        conflict('トレーシングレポートが更新されています。最新の内容を確認してください', {
          expected_updated_at: expectedUpdatedAtRaw,
          current_updated_at: existing.updated_at.toISOString(),
        }),
      );
    }

    if (status !== existing.status) {
      if (!statusChangeReason) {
        return withSensitiveNoStore(
          validationError('ステータス変更理由は必須です', {
            status_change_reason: ['ステータス変更理由は必須です'],
          }),
        );
      }
      const allowed = ALLOWED_TRACING_STATUS_TRANSITIONS[existing.status];
      if (!allowed.includes(status)) {
        return withSensitiveNoStore(
          validationError(`${existing.status} から ${status} へは遷移できません`),
        );
      }
    }

    const physicianName = sentToPhysician || existing.sent_to_physician || null;
    if (status === 'sent' && !physicianName) {
      return withSensitiveNoStore(validationError('送付先医師名は必須です'));
    }

    const result = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const tracingClaim = await tx.tracingReport.updateMany({
          where: {
            id,
            org_id: ctx.orgId,
            patient_id: existing.patient_id,
            case_id: existing.case_id,
            status: existing.status,
            sent_at: existing.sent_at,
            acknowledged_at: existing.acknowledged_at,
            updated_at: expectedUpdatedAt,
          },
          data: {
            status,
            ...(physicianName ? { sent_to_physician: physicianName } : {}),
            ...(status === 'sent' && !existing.sent_at ? { sent_at: new Date() } : {}),
            ...(status === 'acknowledged' && !existing.acknowledged_at
              ? { acknowledged_at: new Date() }
              : {}),
            pdf_url: buildTracingReportPdfPath(id),
          },
        });

        if (tracingClaim.count !== 1) {
          throw new TracingReportPatchRollback();
        }

        const updated = await tx.tracingReport.findFirst({
          where: { id, org_id: ctx.orgId },
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
        if (!updated) {
          throw new TracingReportPatchRollback();
        }

        const linkedRequests = await tx.communicationRequest.findMany({
          where: {
            org_id: ctx.orgId,
            related_entity_type: 'tracing_report',
            related_entity_id: id,
            patient_id: updated.patient_id,
            case_id: updated.case_id ?? null,
          },
          select: {
            id: true,
            patient_id: true,
            case_id: true,
            related_entity_type: true,
            related_entity_id: true,
            status: true,
            updated_at: true,
          },
        });

        const linkedRequestStatus =
          status === 'sent' ? 'sent' : status === 'received' ? 'received' : 'closed';
        const linkedRequestIds: string[] = [];

        if (status !== 'draft') {
          if (linkedRequests.length > 0) {
            for (const linkedRequest of linkedRequests) {
              const linkedRequestClaim = await tx.communicationRequest.updateMany({
                where: {
                  id: linkedRequest.id,
                  org_id: ctx.orgId,
                  patient_id: linkedRequest.patient_id,
                  case_id: linkedRequest.case_id,
                  related_entity_type: linkedRequest.related_entity_type,
                  related_entity_id: linkedRequest.related_entity_id,
                  status: linkedRequest.status,
                  updated_at: linkedRequest.updated_at,
                },
                data: {
                  status: linkedRequestStatus,
                  recipient_name: physicianName,
                },
              });
              if (linkedRequestClaim.count !== 1) {
                throw new TracingReportPatchRollback();
              }
              linkedRequestIds.push(linkedRequest.id);

              if (status !== existing.status && linkedRequest.status !== linkedRequestStatus) {
                await createAuditLogEntry(tx, ctx, {
                  action: 'communication_request_status_changed',
                  targetType: 'communication_request',
                  targetId: linkedRequest.id,
                  changes: {
                    from_status: linkedRequest.status,
                    to_status: linkedRequestStatus,
                    reason: statusChangeReason,
                    status_change_reason: statusChangeReason,
                    linked_tracing_report_id: id,
                    actor_id: ctx.userId,
                  },
                });
              }
            }
          } else {
            const createdRequest = await tx.communicationRequest.create({
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
            linkedRequestIds.push(createdRequest.id);

            if (status !== existing.status) {
              await createAuditLogEntry(tx, ctx, {
                action: 'communication_request_status_changed',
                targetType: 'communication_request',
                targetId: createdRequest.id,
                changes: {
                  from_status: null,
                  to_status: linkedRequestStatus,
                  reason: statusChangeReason,
                  status_change_reason: statusChangeReason,
                  linked_tracing_report_id: id,
                  actor_id: ctx.userId,
                },
              });
            }
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

        if (status !== existing.status) {
          await createAuditLogEntry(tx, ctx, {
            action: 'tracing_report_status_changed',
            targetType: 'tracing_report',
            targetId: id,
            changes: {
              from_status: existing.status,
              to_status: status,
              reason: statusChangeReason,
              status_change_reason: statusChangeReason,
              sent_to_physician: physicianName,
              linked_request_id: linkedRequestIds[0] ?? null,
              linked_communication_request_ids: linkedRequestIds,
              actor_id: ctx.userId,
            },
          });
        }

        return updated;
      },
      { requestContext: ctx },
    );

    return withSensitiveNoStore(success({ data: result }));
  } catch (err) {
    if (err instanceof TracingReportPatchRollback) {
      return withSensitiveNoStore(
        conflict('トレーシングレポートが更新されています。最新の内容を確認してください'),
      );
    }
    unstable_rethrow(err);
    logUnhandledRouteError('PATCH', err);
    return withSensitiveNoStore(internalError());
  }
}

export async function PATCH(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  return withRoutePerformance(req, async () => authenticatedPATCH(req, routeContext));
}
