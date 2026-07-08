import { randomUUID } from 'crypto';
import { unstable_rethrow } from 'next/navigation';
import type { Prisma } from '@prisma/client';
import { withAuthContext } from '@/lib/auth/context';
import {
  internalError,
  notFound,
  successWithMeasuredJsonPayload,
  validationError,
} from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { recordPhiReadAuditForRequest } from '@/lib/audit/phi-read-audit';
import { withOrgContext } from '@/lib/db/rls';
import { buildInboundCommunicationEventAssignmentWhere } from '@/server/services/communication-request-access';
import { logger } from '@/lib/utils/logger';

const ROUTE = '/api/communications/inbound/[id]/detail';
const PURPOSES = ['care', 'medication_review', 'safety_review', 'care_coordination'] as const;
const READ_REASONS = [
  'review_inbound_detail',
  'verify_sender_context',
  'medication_stock_review',
  'patient_safety_review',
  'care_coordination_followup',
] as const;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

type InboundCommunicationDetailRouteContext = {
  params: Promise<{ id: string }>;
};

type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: ReturnType<typeof validationError> };

function parseRequiredEnum<T extends string>(
  searchParams: URLSearchParams,
  key: string,
  allowed: readonly T[],
  label: string,
): ParseResult<T> {
  const raw = searchParams.get(key)?.trim();
  if (!raw) {
    return {
      ok: false,
      response: validationError(`${label}が必要です`, {
        [key]: ['必須です'],
        allowed_values: allowed,
      }),
    };
  }

  if (allowed.includes(raw as T)) return { ok: true, value: raw as T };

  return {
    ok: false,
    response: validationError(`${label}が不正です`, {
      [key]: ['指定できない値です'],
      allowed_values: allowed,
    }),
  };
}

function parseRequestId(searchParams: URLSearchParams): ParseResult<string> {
  const raw = searchParams.get('request_id')?.trim();
  if (!raw) return { ok: true, value: randomUUID() };
  if (REQUEST_ID_PATTERN.test(raw)) return { ok: true, value: raw };
  return {
    ok: false,
    response: validationError('request_id が不正です', {
      request_id: ['英数字、ドット、アンダースコア、コロン、ハイフンで128文字以内にしてください'],
    }),
  };
}

const authenticatedGET = withAuthContext(
  async (req, ctx, routeContext: InboundCommunicationDetailRouteContext) => {
    const eventId = normalizeRequiredRouteParam((await routeContext.params).id ?? '');
    if (!eventId) {
      return withSensitiveNoStore(validationError('受信イベントIDが不正です'));
    }

    const purposeResult = parseRequiredEnum(
      req.nextUrl.searchParams,
      'purpose',
      PURPOSES,
      '閲覧目的',
    );
    if (!purposeResult.ok) return withSensitiveNoStore(purposeResult.response);

    const reasonResult = parseRequiredEnum(
      req.nextUrl.searchParams,
      'read_reason',
      READ_REASONS,
      '閲覧理由',
    );
    if (!reasonResult.ok) return withSensitiveNoStore(reasonResult.response);

    const requestIdResult = parseRequestId(req.nextUrl.searchParams);
    if (!requestIdResult.ok) return withSensitiveNoStore(requestIdResult.response);

    const event = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const assignmentWhere = await buildInboundCommunicationEventAssignmentWhere({
          db: tx,
          orgId: ctx.orgId,
          accessContext: { role: ctx.role, userId: ctx.userId },
        });
        const where: Prisma.InboundCommunicationEventWhereInput = {
          id: eventId,
          org_id: ctx.orgId,
          ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
        };

        return tx.inboundCommunicationEvent.findFirst({
          where,
          select: {
            id: true,
            patient_id: true,
            case_id: true,
            source_channel: true,
            sender_role: true,
            sender_name: true,
            sender_contact: true,
            sender_organization_name: true,
            event_type: true,
            received_at: true,
            occurred_at: true,
            raw_text: true,
            normalized_summary: true,
            attachment_count: true,
            processing_status: true,
          },
        });
      },
      { requestContext: ctx },
    );

    if (!event) {
      return withSensitiveNoStore(notFound('受信イベントが見つかりません'));
    }

    recordPhiReadAuditForRequest(ctx, {
      patientId: event.patient_id,
      targetType: 'inbound_communication_event',
      targetId: event.id,
      view: 'inbound_communication_detail',
      purpose: purposeResult.value,
      metadata: {
        route: ROUTE,
        request_id: requestIdResult.value,
        read_reason_code: reasonResult.value,
        case_id: event.case_id,
        has_patient: event.patient_id !== null,
        source_channel: String(event.source_channel),
        attachment_count: event.attachment_count,
      },
    });

    const response = successWithMeasuredJsonPayload({
      data: {
        id: event.id,
        patient_id: event.patient_id,
        case_id: event.case_id,
        source_channel: String(event.source_channel),
        sender_role: String(event.sender_role),
        sender_name: event.sender_name,
        sender_contact: event.sender_contact,
        sender_organization_name: event.sender_organization_name,
        event_type: String(event.event_type),
        received_at: event.received_at.toISOString(),
        occurred_at: event.occurred_at?.toISOString() ?? null,
        raw_text: event.raw_text,
        normalized_summary: event.normalized_summary,
        attachment_count: event.attachment_count,
        processing_status: String(event.processing_status),
      },
      meta: {
        generated_at: new Date().toISOString(),
        request_id: requestIdResult.value,
        purpose: purposeResult.value,
        read_reason: reasonResult.value,
        raw_text_included: true,
      },
    });
    response.headers.set('X-Request-Id', requestIdResult.value);
    return withSensitiveNoStore(response);
  },
  {
    permission: 'canReport',
    message: '受信情報の詳細閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    logger.error(
      {
        event: 'inbound_communication_detail_get_unhandled_error',
        route: ROUTE,
        method: req.method,
        status: 500,
      },
      err,
    );
    return withSensitiveNoStore(internalError());
  }
};
