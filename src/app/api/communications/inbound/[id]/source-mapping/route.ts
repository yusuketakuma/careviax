import { unstable_rethrow } from 'next/navigation';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { conflict, internalError, notFound, success, validationError } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import { logger } from '@/lib/utils/logger';
import { buildInboundCommunicationEventAssignmentWhere } from '@/server/services/communication-request-access';
import { canAccessCaseScopedPatientResource } from '@/server/services/patient-access';

const ROUTE = '/api/communications/inbound/[id]/source-mapping';
const SOURCE_MAPPING_CONFIDENCES = ['exact', 'probable', 'manual', 'unknown'] as const;
const SOURCE_MAPPING_STATUSES = ['active', 'needs_review', 'inactive'] as const;

type InboundSourceMappingRouteContext = {
  params: Promise<{ id: string }>;
};

const optionalTrimmedString = (maxLength: number) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, z.string().max(maxLength).optional());

const createSourceMappingSchema = z
  .object({
    patient_id: optionalTrimmedString(100).pipe(z.string().min(1, '患者IDは必須です')),
    case_id: optionalTrimmedString(100),
    external_patient_label: optionalTrimmedString(160),
    external_thread_id: optionalTrimmedString(500),
    external_room_id: optionalTrimmedString(160),
    external_contact_name: optionalTrimmedString(120),
    external_contact_role: optionalTrimmedString(120),
    external_organization_name: optionalTrimmedString(160),
    confidence: z.enum(SOURCE_MAPPING_CONFIDENCES),
    mapping_status: z.enum(SOURCE_MAPPING_STATUSES),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mapping_status !== 'active') return;

    if (value.confidence !== 'exact' && value.confidence !== 'manual') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confidence'],
        message: 'active mapping は exact または manual のみ指定できます',
      });
    }

    if (value.external_room_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['external_room_id'],
        message: 'external_room_id は review 中の mapping だけで扱います',
      });
    }
  });

type CreateSourceMappingInput = z.infer<typeof createSourceMappingSchema>;

function normalizeContactKey(sourceChannel: string, senderContact?: string | null) {
  const trimmed = senderContact?.trim();
  if (!trimmed) return null;

  if (sourceChannel === 'phone' || sourceChannel === 'fax') {
    const normalizedNumber = trimmed.replace(/[^\d+]/g, '');
    return normalizedNumber ? `${sourceChannel}:${normalizedNumber}` : null;
  }

  if (sourceChannel === 'email') return `email:${trimmed.toLowerCase()}`;
  return null;
}

function deriveServerThreadId(event: {
  source_channel: string;
  external_thread_id: string | null;
  external_url: string | null;
  sender_contact: string | null;
}) {
  if (event.external_thread_id) return event.external_thread_id;
  if (event.source_channel === 'mcs' && event.external_url) return `mcs:${event.external_url}`;
  return normalizeContactKey(event.source_channel, event.sender_contact);
}

function mappingTargetMatches(
  mapping: { patient_id: string; case_id: string | null },
  input: Pick<CreateSourceMappingInput, 'patient_id' | 'case_id'>,
) {
  return mapping.patient_id === input.patient_id && mapping.case_id === (input.case_id ?? null);
}

function validateEventTargetConsistency(
  event: { patient_id: string | null; case_id: string | null },
  input: Pick<CreateSourceMappingInput, 'patient_id' | 'case_id'>,
) {
  if (event.patient_id && event.patient_id !== input.patient_id) {
    return validationError('受信イベントの患者とmapping対象が一致しません', {
      patient_id: ['受信イベントに紐づく患者IDと一致させてください'],
    });
  }

  if (event.case_id && event.case_id !== (input.case_id ?? null)) {
    return validationError('受信イベントのケースとmapping対象が一致しません', {
      case_id: ['受信イベントに紐づくケースIDと一致させてください'],
    });
  }

  return null;
}

const authenticatedPOST = withAuthContext(
  async (req, ctx, routeContext: InboundSourceMappingRouteContext) => {
    const eventId = normalizeRequiredRouteParam((await routeContext.params).id ?? '');
    if (!eventId) return withSensitiveNoStore(validationError('受信イベントIDが不正です'));

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) {
      return withSensitiveNoStore(validationError('リクエストボディが不正です'));
    }

    const parsed = createSourceMappingSchema.safeParse(payload);
    if (!parsed.success) {
      return withSensitiveNoStore(
        validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
      );
    }

    const input = parsed.data;
    const result = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const assignmentWhere = await buildInboundCommunicationEventAssignmentWhere({
          db: tx,
          orgId: ctx.orgId,
          accessContext: ctx,
        });
        const eventWhere: Prisma.InboundCommunicationEventWhereInput = {
          id: eventId,
          org_id: ctx.orgId,
          ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
        };
        const event = await tx.inboundCommunicationEvent.findFirst({
          where: eventWhere,
          select: {
            id: true,
            patient_id: true,
            case_id: true,
            source_channel: true,
            external_thread_id: true,
            external_url: true,
            sender_contact: true,
          },
        });

        if (!event) {
          return { ok: false as const, response: notFound('受信イベントが見つかりません') };
        }

        const targetConsistencyError = validateEventTargetConsistency(event, input);
        if (targetConsistencyError) {
          return { ok: false as const, response: targetConsistencyError };
        }

        const canAccessTarget = await canAccessCaseScopedPatientResource({
          db: tx,
          orgId: ctx.orgId,
          patientId: input.patient_id,
          caseId: input.case_id,
          accessContext: ctx,
        });
        if (!canAccessTarget) {
          return {
            ok: false as const,
            response: validationError('患者またはケースの割当権限がありません'),
          };
        }

        const serverThreadId = deriveServerThreadId(event);
        if (
          input.external_thread_id &&
          serverThreadId &&
          input.external_thread_id !== serverThreadId
        ) {
          return {
            ok: false as const,
            response: validationError('受信イベントのsource keyと一致しません', {
              external_thread_id: ['受信イベント由来のsource keyと一致させてください'],
            }),
          };
        }

        const externalThreadId = serverThreadId ?? input.external_thread_id ?? null;
        if (input.mapping_status === 'active' && !serverThreadId) {
          return {
            ok: false as const,
            response: validationError('active mapping には受信イベント由来のsource keyが必要です', {
              external_thread_id: ['受信イベントから確認できるsource keyが必要です'],
            }),
          };
        }

        const sourceConditions: Prisma.InboundSourceMappingWhereInput[] = [];
        if (externalThreadId) {
          sourceConditions.push({ external_thread_id: externalThreadId });
        }
        if (input.external_room_id) {
          sourceConditions.push({ external_room_id: input.external_room_id });
        }

        if (sourceConditions.length > 0) {
          const existing = await tx.inboundSourceMapping.findFirst({
            where: {
              org_id: ctx.orgId,
              source_system: event.source_channel,
              mapping_status: { in: ['active', 'needs_review'] },
              OR: sourceConditions,
            },
            select: {
              id: true,
              patient_id: true,
              case_id: true,
              mapping_status: true,
            },
          });

          if (existing) {
            return {
              ok: false as const,
              response: conflict(
                mappingTargetMatches(existing, input) && existing.mapping_status === 'needs_review'
                  ? '同じsource mappingが既にreview中です'
                  : '別の患者またはケースに紐づくsource mappingが既に存在します',
              ),
            };
          }
        }

        const reviewedAt = input.mapping_status === 'active' ? new Date() : null;
        const created = await tx.inboundSourceMapping.create({
          data: {
            org_id: ctx.orgId,
            patient_id: input.patient_id,
            case_id: input.case_id ?? null,
            source_system: event.source_channel,
            external_patient_label: input.external_patient_label ?? null,
            external_thread_id: externalThreadId,
            external_room_id: input.external_room_id ?? null,
            external_contact_name: input.external_contact_name ?? null,
            external_contact_role: input.external_contact_role ?? null,
            external_organization_name: input.external_organization_name ?? null,
            mapping_status: input.mapping_status,
            confidence: input.confidence,
            created_by: ctx.userId,
            reviewed_by: input.mapping_status === 'active' ? ctx.userId : null,
            reviewed_at: reviewedAt,
          },
          select: {
            id: true,
            patient_id: true,
            case_id: true,
            source_system: true,
            mapping_status: true,
            confidence: true,
            created_at: true,
            reviewed_at: true,
          },
        });

        return {
          ok: true as const,
          mapping: created,
        };
      },
      { requestContext: ctx },
    );

    if (!result.ok) return withSensitiveNoStore(result.response);

    return withSensitiveNoStore(
      success(
        {
          data: {
            mapping_id: result.mapping.id,
            inbound_event_id: eventId,
            patient_id: result.mapping.patient_id,
            case_id: result.mapping.case_id,
            source_system: result.mapping.source_system,
            mapping_status: result.mapping.mapping_status,
            confidence: result.mapping.confidence,
            created_at: result.mapping.created_at.toISOString(),
            reviewed_at: result.mapping.reviewed_at?.toISOString() ?? null,
          },
          meta: {
            generated_at: new Date().toISOString(),
          },
        },
        201,
      ),
    );
  },
  {
    permission: 'canReport',
    message: '他職種受信のsource mapping権限がありません',
  },
);

export const POST: typeof authenticatedPOST = async (req, routeContext) => {
  try {
    return await authenticatedPOST(req, routeContext);
  } catch (err) {
    unstable_rethrow(err);
    logger.error(
      {
        event: 'inbound_source_mapping_post_unhandled_error',
        route: ROUTE,
        method: req.method,
        status: 500,
      },
      err,
    );
    return withSensitiveNoStore(internalError());
  }
};
