import { randomUUID } from 'crypto';
import { unstable_rethrow } from 'next/navigation';
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
import { createScopedTxRunner } from '@/lib/db/rls';
import { getPatientMovementTimelineEventDetail } from '@/server/services/patient-detail';

const ROUTE = '/api/patients/[id]/timeline/[eventId]';
const PURPOSES = [
  'care',
  'medication_review',
  'safety_review',
  'care_coordination',
  'billing',
] as const;
const READ_REASONS = [
  'review_movement_detail',
  'verify_event_context',
  'medication_history_review',
  'patient_safety_review',
  'care_coordination_followup',
  'billing_context_review',
] as const;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

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
  async (req, ctx, { params }) => {
    const { id: rawPatientId, eventId: rawEventId } = await params;
    const patientId = normalizeRequiredRouteParam(rawPatientId);
    const eventId = normalizeRequiredRouteParam(rawEventId);
    if (!patientId) return validationError('患者IDが不正です');
    if (!eventId) return validationError('イベントIDが不正です');

    const purposeResult = parseRequiredEnum(
      req.nextUrl.searchParams,
      'purpose',
      PURPOSES,
      '閲覧目的',
    );
    if (!purposeResult.ok) return purposeResult.response;

    const reasonResult = parseRequiredEnum(
      req.nextUrl.searchParams,
      'read_reason',
      READ_REASONS,
      '閲覧理由',
    );
    if (!reasonResult.ok) return reasonResult.response;

    const requestIdResult = parseRequestId(req.nextUrl.searchParams);
    if (!requestIdResult.ok) return requestIdResult.response;

    const runScoped = createScopedTxRunner(ctx.orgId);
    const detail = await getPatientMovementTimelineEventDetail(runScoped, {
      orgId: ctx.orgId,
      patientId,
      eventId,
      role: ctx.role,
      userId: ctx.userId,
    });
    if (!detail) return notFound('患者の動きイベントが見つかりません');

    recordPhiReadAuditForRequest(ctx, {
      patientId,
      targetType: 'patient_movement_timeline_event',
      targetId: eventId,
      view: 'patient_timeline_event',
      purpose: purposeResult.value,
      metadata: {
        route: ROUTE,
        request_id: requestIdResult.value,
        read_reason_code: reasonResult.value,
        event_id: eventId,
        category: detail.event.category,
        raw_available: detail.raw_text.available,
      },
    });

    const response = successWithMeasuredJsonPayload({
      data: detail,
      meta: {
        generated_at: new Date().toISOString(),
        request_id: requestIdResult.value,
        purpose: purposeResult.value,
        read_reason: reasonResult.value,
        raw_text_included: false,
      },
    });
    response.headers.set('X-Request-Id', requestIdResult.value);
    return response;
  },
  {
    permission: 'canVisit',
    message: '患者情報の閲覧権限がありません',
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
