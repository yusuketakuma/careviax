import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { acquireAdvisoryTxLock } from '@/lib/db/advisory-lock';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeJsonInput } from '@/lib/db/json';
import { isPrismaErrorCode } from '@/lib/db/prisma-errors';
import {
  success,
  validationError,
  notFound,
  forbidden,
  conflict,
  internalError,
} from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { buildCursorPage, parsePaginationParams } from '@/lib/api/pagination';
import { prisma } from '@/lib/db/client';
import { RequestStatus, type Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  communicationRequestStatusSchema,
  optionalCommunicationRequestStatusSchema,
  optionalTrimmedSearchParam,
  optionalTrimmedStringSchema,
  requiredTrimmedStringSchema,
  trimStringOrUndefined,
} from '@/lib/validations/communication-request';
import { pickCommunicationRecipientCandidate } from '@/lib/contact-profiles';
import { findLatestPrescriberInstitutionSuggestion } from '@/lib/prescriptions/prescriber-institutions';
import {
  buildCommunicationRequestAssignmentWhere,
  canAccessCareReportCommunication,
  canAccessCommunicationRequestRecord,
  isCareReportCommunicationRequest,
  resolveCareReportCommunicationScope,
  resolveTracingReportCommunicationScope,
} from '@/server/services/communication-request-access';
import { canAccessCareReportSource } from '@/server/services/care-report-access';
import { requireWritablePatient } from '@/server/services/patient-write-guard';

function isInputJsonObject(
  value: Prisma.InputJsonValue | null | undefined,
): value is Prisma.InputJsonObject {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !('toJSON' in value)
  );
}

function normalizeInputJsonObject(value: unknown): Prisma.InputJsonObject {
  const normalized = normalizeJsonInput(value);
  return isInputJsonObject(normalized) ? normalized : {};
}

const DUPLICATE_GUARDED_REPLY_REQUEST_TYPES = new Set([
  'care_report_reply_request',
  'patient_share_reply_request',
]);

const ACTIVE_REPLY_REQUEST_STATUSES = [
  RequestStatus.draft,
  RequestStatus.sent,
  RequestStatus.received,
  RequestStatus.in_progress,
  RequestStatus.responded,
  RequestStatus.escalated,
];
const COMMUNICATION_QUEUE_SOURCE = 'communication_queue';

const reusableCommunicationRequestSelect = {
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
  created_at: true,
  updated_at: true,
} satisfies Prisma.CommunicationRequestSelect;

const communicationRequestQuerySchema = z.object({
  status: communicationRequestStatusSchema.optional(),
  request_type: optionalTrimmedStringSchema,
  patient_id: optionalTrimmedStringSchema,
  related_entity_type: optionalTrimmedStringSchema,
  related_entity_id: optionalTrimmedStringSchema,
});

const optionalDateSchema = z.preprocess(
  trimStringOrUndefined,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）')
    .optional(),
);

const optionalReportVersionSchema = z.preprocess(
  trimStringOrUndefined,
  z.string().datetime('報告書の版情報が不正です').optional(),
);

const createCommunicationRequestSchema = z.object({
  patient_id: optionalTrimmedStringSchema,
  case_id: optionalTrimmedStringSchema,
  request_type: requiredTrimmedStringSchema('依頼タイプは必須です'),
  template_key: optionalTrimmedStringSchema,
  recipient_name: optionalTrimmedStringSchema,
  recipient_role: optionalTrimmedStringSchema,
  related_entity_type: optionalTrimmedStringSchema,
  related_entity_id: optionalTrimmedStringSchema,
  context_snapshot: z.record(z.string(), z.unknown()).optional(),
  status: optionalCommunicationRequestStatusSchema,
  subject: requiredTrimmedStringSchema('件名は必須です'),
  content: requiredTrimmedStringSchema('内容は必須です'),
  due_date: optionalDateSchema,
  expected_report_updated_at: optionalReportVersionSchema,
});

function isInterprofessionalShareRequest(args: {
  templateKey?: string;
  contextSnapshot?: Record<string, unknown>;
}): boolean {
  return (
    args.templateKey === 'interprofessional_share_reply_request' ||
    args.contextSnapshot?.source === 'interprofessional_share'
  );
}

function readContextSnapshotString(
  contextSnapshot: Prisma.InputJsonObject,
  key: string,
): string | null {
  const value = contextSnapshot[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isCommunicationQueueDraftRequest(args: {
  contextSnapshot: Prisma.InputJsonObject;
  relatedEntityType?: string;
  relatedEntityId?: string;
  status?: RequestStatus;
}): boolean {
  return (
    (args.status ?? RequestStatus.draft) === RequestStatus.draft &&
    args.relatedEntityType === 'patient' &&
    Boolean(args.relatedEntityId) &&
    readContextSnapshotString(args.contextSnapshot, 'source') === COMMUNICATION_QUEUE_SOURCE
  );
}

function readPresentOptionalSearchParam(
  searchParams: URLSearchParams,
  name: string,
  message: string,
) {
  const value = optionalTrimmedSearchParam(searchParams.get(name));
  if (searchParams.has(name) && !value) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', { [name]: [message] }),
    };
  }
  return { ok: true as const, value };
}

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);
    const statusResult = readPresentOptionalSearchParam(
      searchParams,
      'status',
      'ステータスを指定してください',
    );
    if (!statusResult.ok) return statusResult.response;
    const requestTypeResult = readPresentOptionalSearchParam(
      searchParams,
      'request_type',
      '依頼種別を指定してください',
    );
    if (!requestTypeResult.ok) return requestTypeResult.response;
    const patientIdResult = readPresentOptionalSearchParam(
      searchParams,
      'patient_id',
      '患者IDを指定してください',
    );
    if (!patientIdResult.ok) return patientIdResult.response;
    const relatedEntityTypeResult = readPresentOptionalSearchParam(
      searchParams,
      'related_entity_type',
      '関連種別を指定してください',
    );
    if (!relatedEntityTypeResult.ok) return relatedEntityTypeResult.response;
    const relatedEntityIdResult = readPresentOptionalSearchParam(
      searchParams,
      'related_entity_id',
      '関連IDを指定してください',
    );
    if (!relatedEntityIdResult.ok) return relatedEntityIdResult.response;

    const parsedQuery = communicationRequestQuerySchema.safeParse({
      status: statusResult.value,
      request_type: requestTypeResult.value,
      patient_id: patientIdResult.value,
      related_entity_type: relatedEntityTypeResult.value,
      related_entity_id: relatedEntityIdResult.value,
    });
    if (!parsedQuery.success) {
      return validationError('検索条件が不正です', parsedQuery.error.flatten().fieldErrors);
    }

    const {
      status,
      request_type: requestType,
      patient_id: patientId,
      related_entity_type: relatedEntityType,
      related_entity_id: relatedEntityId,
    } = parsedQuery.data;
    const canReadCareReportOutput = canAccessCareReportCommunication(ctx.role);
    if (isCareReportCommunicationRequest(relatedEntityType) && !canReadCareReportOutput) {
      return forbidden('報告書共有の閲覧権限がありません');
    }

    const assignmentWhere = await buildCommunicationRequestAssignmentWhere({
      db: prisma,
      orgId: ctx.orgId,
      accessContext: ctx,
    });

    const where: Prisma.CommunicationRequestWhereInput = {
      org_id: ctx.orgId,
      ...(status ? { status } : {}),
      ...(requestType ? { request_type: requestType } : {}),
      ...(patientId ? { patient_id: patientId } : {}),
      ...(relatedEntityType ? { related_entity_type: relatedEntityType } : {}),
      ...(relatedEntityId ? { related_entity_id: relatedEntityId } : {}),
      ...(!relatedEntityType && !canReadCareReportOutput
        ? { NOT: { related_entity_type: 'care_report' } }
        : {}),
      ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
    };

    const requests = await prisma.communicationRequest
      .findMany({
        where,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: [{ requested_at: 'desc' }, { id: 'desc' }],
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
          created_at: true,
          updated_at: true,
          responses: {
            orderBy: { responded_at: 'desc' },
            take: 1,
            select: {
              id: true,
              responder_name: true,
              responded_at: true,
            },
          },
        },
      })
      .catch((cause) => {
        if (isPrismaErrorCode(cause, 'P2025')) {
          return null;
        }
        throw cause;
      });

    if (!requests) {
      return validationError('ページカーソルが不正です', {
        cursor: ['指定されたカーソルの連携依頼が見つかりません'],
      });
    }

    const page = buildCursorPage(requests, limit, (request) => request.id);

    return success({
      data: page.data,
      meta: {
        limit,
        has_more: page.hasMore,
        next_cursor: page.nextCursor ?? null,
      },
    });
  },
  {
    permission: 'canReport',
    message: '連携依頼の閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};

const authenticatedPOST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createCommunicationRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const {
      patient_id,
      case_id,
      request_type,
      subject,
      content,
      due_date,
      expected_report_updated_at,
    } = parsed.data;
    const {
      template_key,
      recipient_name,
      recipient_role,
      related_entity_type,
      related_entity_id,
      context_snapshot,
      status,
    } = parsed.data;
    const expectsInterprofessionalShareVersion = isInterprofessionalShareRequest({
      templateKey: template_key,
      contextSnapshot: context_snapshot,
    });
    if (
      isCareReportCommunicationRequest(related_entity_type) &&
      !canAccessCareReportCommunication(ctx.role)
    ) {
      return forbidden('報告書共有の作成権限がありません');
    }

    let effectivePatientId = patient_id ?? null;
    let effectiveCaseId = case_id ?? null;

    if (isCareReportCommunicationRequest(related_entity_type)) {
      if (!related_entity_id) {
        return validationError('関連報告書IDは必須です', {
          related_entity_id: ['関連報告書IDは必須です'],
        });
      }

      const careReport = await prisma.careReport.findFirst({
        where: {
          id: related_entity_id,
          org_id: ctx.orgId,
        },
        select: {
          id: true,
          patient_id: true,
          case_id: true,
          visit_record_id: true,
          updated_at: true,
        },
      });

      if (!careReport) return notFound('報告書が見つかりません');

      const resolvedScope = resolveCareReportCommunicationScope({
        requestedPatientId: patient_id,
        requestedCaseId: case_id,
        careReport,
      });

      if (!resolvedScope) {
        return validationError('関連報告書と患者またはケースが一致しません', {
          related_entity_id: ['関連報告書と患者またはケースが一致しません'],
        });
      }

      if (
        !(await canAccessCareReportSource(prisma, ctx.orgId, ctx, {
          patientId: resolvedScope.patientId,
          caseId: resolvedScope.caseId,
          visitRecordId: careReport.visit_record_id,
        }))
      ) {
        return notFound('報告書が見つかりません');
      }

      if (expectsInterprofessionalShareVersion && !expected_report_updated_at) {
        return validationError('報告書の版情報は必須です', {
          expected_report_updated_at: ['報告書の版情報は必須です'],
        });
      }

      if (
        expected_report_updated_at &&
        careReport.updated_at.getTime() !== new Date(expected_report_updated_at).getTime()
      ) {
        return conflict('報告書が更新されています。再読み込みしてから返信依頼を起票してください', {
          report_id: careReport.id,
          current_report_updated_at: careReport.updated_at.toISOString(),
        });
      }

      effectivePatientId = resolvedScope.patientId;
      effectiveCaseId = resolvedScope.caseId;
    }

    if (related_entity_type === 'tracing_report') {
      if (!related_entity_id) {
        return validationError('関連トレーシングレポートIDは必須です', {
          related_entity_id: ['関連トレーシングレポートIDは必須です'],
        });
      }

      const tracingReport = await prisma.tracingReport.findFirst({
        where: {
          id: related_entity_id,
          org_id: ctx.orgId,
        },
        select: {
          id: true,
          patient_id: true,
          case_id: true,
        },
      });

      if (!tracingReport) return notFound('トレーシングレポートが見つかりません');

      const resolvedScope = resolveTracingReportCommunicationScope({
        requestedPatientId: patient_id,
        requestedCaseId: case_id,
        tracingReport,
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

      effectivePatientId = resolvedScope.patientId;
      effectiveCaseId = resolvedScope.caseId;
    }

    if (
      !(await canAccessCommunicationRequestRecord({
        db: prisma,
        orgId: ctx.orgId,
        patientId: effectivePatientId,
        caseId: effectiveCaseId,
        accessContext: ctx,
      }))
    ) {
      return validationError('患者またはケースの割当権限がありません');
    }

    if (effectivePatientId) {
      const writable = await requireWritablePatient(prisma, ctx, effectivePatientId);
      if ('response' in writable) return writable.response;
    }

    const suggestedInstitution =
      !recipient_name && (effectivePatientId || effectiveCaseId)
        ? await findLatestPrescriberInstitutionSuggestion(prisma, ctx.orgId, {
            caseId: effectiveCaseId ?? undefined,
            patientId: effectivePatientId ?? undefined,
          })
        : null;
    const suggestedProfessional =
      !recipient_name && !suggestedInstitution && (effectivePatientId || effectiveCaseId)
        ? await pickCommunicationRecipientCandidate(prisma, ctx.orgId, {
            caseId: effectiveCaseId ?? undefined,
            patientId: effectivePatientId ?? undefined,
            requestType: request_type,
          })
        : null;
    const effectiveRecipientName =
      recipient_name ??
      suggestedInstitution?.prescriber_name ??
      suggestedInstitution?.name ??
      suggestedProfessional?.name ??
      null;
    const effectiveRecipientRole =
      recipient_role ??
      (suggestedInstitution
        ? '処方元医療機関'
        : (suggestedProfessional?.organization_name ??
          suggestedProfessional?.profession_type ??
          null));
    const effectiveContextSnapshot = normalizeInputJsonObject({
      ...(context_snapshot ?? {}),
      ...(suggestedInstitution
        ? {
            prescriber_institution_id: suggestedInstitution.id,
            prescriber_institution_name: suggestedInstitution.name,
          }
        : {}),
      ...(suggestedProfessional
        ? {
            external_professional_id: suggestedProfessional.id,
            external_professional_name: suggestedProfessional.name,
            external_professional_profession_type: suggestedProfessional.profession_type,
            preferred_contact_method: suggestedProfessional.preferred_contact_method,
            preferred_contact_time: suggestedProfessional.preferred_contact_time,
            recommended_channels: suggestedProfessional.recommended_channels,
          }
        : {}),
    });

    const wantsReplyDedup = Boolean(
      related_entity_type &&
      related_entity_id &&
      DUPLICATE_GUARDED_REPLY_REQUEST_TYPES.has(request_type),
    );
    const wantsQueueDedup = isCommunicationQueueDraftRequest({
      contextSnapshot: effectiveContextSnapshot,
      relatedEntityType: related_entity_type,
      relatedEntityId: related_entity_id,
      status,
    });

    // reply/queue の dedup は tx 外 read→create の TOCTOU だった。DB partial-unique が
    // 未整備なため、dedup キー単位で advisory lock を取得 → tx 内で再 read → create の順に
    // 直列化し、同時起票でも重複依頼 / 重複 draft が生まれない形にする
    // （本質解決は W1-7 の DB 制約: active reply 一意 / queue draft 一意の partial-unique index）。
    const result = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        if (wantsReplyDedup) {
          await acquireAdvisoryTxLock(
            tx,
            'communication_request_reply_dedup',
            [
              ctx.orgId,
              request_type,
              effectivePatientId ?? '',
              effectiveCaseId ?? '',
              effectiveRecipientRole ?? '',
              related_entity_type ?? '',
              related_entity_id ?? '',
            ].join(' '),
          );

          const existingOpenRequest = await tx.communicationRequest.findFirst({
            where: {
              org_id: ctx.orgId,
              request_type,
              patient_id: effectivePatientId,
              case_id: effectiveCaseId,
              recipient_role: effectiveRecipientRole,
              related_entity_type,
              related_entity_id,
              status: { in: ACTIVE_REPLY_REQUEST_STATUSES },
            },
            select: {
              id: true,
              status: true,
            },
          });

          if (existingOpenRequest) {
            return { conflict: existingOpenRequest };
          }
        }

        if (wantsQueueDedup) {
          await acquireAdvisoryTxLock(
            tx,
            'communication_request_queue_dedup',
            [
              ctx.orgId,
              request_type,
              effectivePatientId ?? '',
              effectiveCaseId ?? '',
              template_key ?? '',
              effectiveRecipientRole ?? '',
              related_entity_type ?? '',
              related_entity_id ?? '',
            ].join(' '),
          );

          const existingDraft = await tx.communicationRequest.findFirst({
            where: {
              org_id: ctx.orgId,
              request_type,
              patient_id: effectivePatientId,
              case_id: effectiveCaseId,
              template_key: template_key ?? null,
              recipient_role: effectiveRecipientRole,
              related_entity_type: related_entity_type ?? null,
              related_entity_id: related_entity_id ?? null,
              status: { in: ACTIVE_REPLY_REQUEST_STATUSES },
              context_snapshot: { path: ['source'], equals: COMMUNICATION_QUEUE_SOURCE },
            },
            select: reusableCommunicationRequestSelect,
            orderBy: [{ requested_at: 'desc' }, { id: 'desc' }],
          });

          if (existingDraft) {
            return { reusedDraft: existingDraft };
          }
        }

        const created = await tx.communicationRequest.create({
          data: {
            org_id: ctx.orgId,
            patient_id: effectivePatientId,
            case_id: effectiveCaseId,
            request_type,
            template_key: template_key ?? null,
            recipient_name: effectiveRecipientName,
            recipient_role: effectiveRecipientRole,
            related_entity_type: related_entity_type ?? null,
            related_entity_id: related_entity_id ?? null,
            context_snapshot: effectiveContextSnapshot,
            status: status ?? 'draft',
            subject,
            content,
            requested_by: ctx.userId,
            due_date: due_date ? new Date(due_date) : null,
          },
        });
        return { created };
      },
      { requestContext: ctx },
    );

    if ('conflict' in result && result.conflict) {
      return conflict('この相手への返信依頼は既に起票されています', {
        request_id: result.conflict.id,
        status: result.conflict.status,
      });
    }
    if ('reusedDraft' in result) {
      return success({
        data: result.reusedDraft,
        reused_existing_draft: true,
      });
    }

    return success({ data: result.created }, 201);
  },
  {
    permission: 'canReport',
    message: '連携依頼の作成権限がありません',
  },
);

export const POST: typeof authenticatedPOST = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
