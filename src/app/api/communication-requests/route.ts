import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeJsonInput } from '@/lib/db/json';
import { success, validationError, notFound } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { prisma } from '@/lib/db/client';
import type { Prisma } from '@prisma/client';
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
  canAccessCommunicationRequestRecord,
  resolveTracingReportCommunicationScope,
} from '@/server/services/communication-request-access';

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

const communicationRequestQuerySchema = z.object({
  status: communicationRequestStatusSchema.optional(),
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
});

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);

    const parsedQuery = communicationRequestQuerySchema.safeParse({
      status: optionalTrimmedSearchParam(searchParams.get('status')),
      patient_id: optionalTrimmedSearchParam(searchParams.get('patient_id')),
      related_entity_type: optionalTrimmedSearchParam(searchParams.get('related_entity_type')),
      related_entity_id: optionalTrimmedSearchParam(searchParams.get('related_entity_id')),
    });
    if (!parsedQuery.success) {
      return validationError('検索条件が不正です', parsedQuery.error.flatten().fieldErrors);
    }

    const {
      status,
      patient_id: patientId,
      related_entity_type: relatedEntityType,
      related_entity_id: relatedEntityId,
    } = parsedQuery.data;

    const assignmentWhere = await buildCommunicationRequestAssignmentWhere({
      db: prisma,
      orgId: req.orgId,
      accessContext: req,
    });

    const where: Prisma.CommunicationRequestWhereInput = {
      org_id: req.orgId,
      ...(status ? { status } : {}),
      ...(patientId ? { patient_id: patientId } : {}),
      ...(relatedEntityType ? { related_entity_type: relatedEntityType } : {}),
      ...(relatedEntityId ? { related_entity_id: relatedEntityId } : {}),
      ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
    };

    const requests = await prisma.communicationRequest.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { requested_at: 'desc' },
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
    });

    const hasMore = requests.length > limit;
    const data = hasMore ? requests.slice(0, limit) : requests;
    const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

    return success({ data, hasMore, nextCursor });
  },
  {
    permission: 'canReport',
    message: '連携依頼の閲覧権限がありません',
  },
);

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createCommunicationRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { patient_id, case_id, request_type, subject, content, due_date } = parsed.data;
    const {
      template_key,
      recipient_name,
      recipient_role,
      related_entity_type,
      related_entity_id,
      context_snapshot,
      status,
    } = parsed.data;

    let effectivePatientId = patient_id ?? null;
    let effectiveCaseId = case_id ?? null;

    if (related_entity_type === 'tracing_report') {
      if (!related_entity_id) {
        return validationError('関連トレーシングレポートIDは必須です', {
          related_entity_id: ['関連トレーシングレポートIDは必須です'],
        });
      }

      const tracingReport = await prisma.tracingReport.findFirst({
        where: {
          id: related_entity_id,
          org_id: req.orgId,
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
          orgId: req.orgId,
          patientId: resolvedScope.patientId,
          caseId: resolvedScope.caseId,
          accessContext: req,
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
        orgId: req.orgId,
        patientId: effectivePatientId,
        caseId: effectiveCaseId,
        accessContext: req,
      }))
    ) {
      return validationError('患者またはケースの割当権限がありません');
    }

    const suggestedInstitution =
      !recipient_name && (effectivePatientId || effectiveCaseId)
        ? await findLatestPrescriberInstitutionSuggestion(prisma, req.orgId, {
            caseId: effectiveCaseId ?? undefined,
            patientId: effectivePatientId ?? undefined,
          })
        : null;
    const suggestedProfessional =
      !recipient_name && !suggestedInstitution && (effectivePatientId || effectiveCaseId)
        ? await pickCommunicationRecipientCandidate(prisma, req.orgId, {
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

    const result = await withOrgContext(req.orgId, async (tx) => {
      return tx.communicationRequest.create({
        data: {
          org_id: req.orgId,
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
          requested_by: req.userId,
          due_date: due_date ? new Date(due_date) : null,
        },
      });
    });

    return success({ data: result }, 201);
  },
  {
    permission: 'canReport',
    message: '連携依頼の作成権限がありません',
  },
);
