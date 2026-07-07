import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { success, validationError, internalError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { withOrgContext } from '@/lib/db/rls';
import { canAccessCommunicationRequestRecord } from '@/server/services/communication-request-access';
import { logger } from '@/lib/utils/logger';

const ROUTE = '/api/communications/inbound/phone';

const PHONE_EVENT_TYPES = [
  'general_note',
  'medication_stock_report',
  'medication_safety_report',
  'schedule_request',
] as const;

const PHONE_EVENT_SUBJECTS: Record<(typeof PHONE_EVENT_TYPES)[number], string> = {
  general_note: '電話メモ',
  medication_stock_report: '電話メモ: 残数報告',
  medication_safety_report: '電話メモ: 薬剤安全確認',
  schedule_request: '電話メモ: スケジュール相談',
};

const PHONE_EVENT_TYPE_TO_INBOUND_EVENT_TYPE: Record<
  (typeof PHONE_EVENT_TYPES)[number],
  'general_note' | 'medication_stock_report' | 'side_effect_report' | 'schedule_request'
> = {
  general_note: 'general_note',
  medication_stock_report: 'medication_stock_report',
  medication_safety_report: 'side_effect_report',
  schedule_request: 'schedule_request',
};

const optionalTrimmedString = (maxLength: number) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, z.string().max(maxLength).optional());

const createInboundPhoneSchema = z.object({
  patient_id: optionalTrimmedString(100),
  case_id: optionalTrimmedString(100),
  event_type: z.enum(PHONE_EVENT_TYPES),
  counterpart_name: optionalTrimmedString(120),
  counterpart_contact: optionalTrimmedString(120),
  content: z.string().trim().min(1, '電話メモ本文は必須です').max(2000),
  occurred_at: z.string().datetime().optional(),
});

function buildInboundPhoneHref(patientId?: string | null) {
  if (!patientId) return '/communications/inbound';
  return `/patients/${encodeURIComponent(patientId)}/collaboration`;
}

function hasMedicationStockSignal(eventType: (typeof PHONE_EVENT_TYPES)[number]) {
  return eventType === 'medication_stock_report';
}

function hasPatientSafetySignal(eventType: (typeof PHONE_EVENT_TYPES)[number]) {
  return eventType === 'medication_safety_report';
}

function hasScheduleSignal(eventType: (typeof PHONE_EVENT_TYPES)[number]) {
  return eventType === 'schedule_request';
}

const authenticatedPOST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) {
      return withSensitiveNoStore(validationError('リクエストボディが不正です'));
    }

    const parsed = createInboundPhoneSchema.safeParse(payload);
    if (!parsed.success) {
      return withSensitiveNoStore(
        validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
      );
    }

    const input = parsed.data;
    const eventResult = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        if (
          !(await canAccessCommunicationRequestRecord({
            db: tx,
            orgId: ctx.orgId,
            patientId: input.patient_id,
            caseId: input.case_id,
            accessContext: ctx,
          }))
        ) {
          return {
            ok: false as const,
            response: validationError('患者またはケースの割当権限がありません'),
          };
        }

        const created = await tx.inboundCommunicationEvent.create({
          data: {
            org_id: ctx.orgId,
            patient_id: input.patient_id,
            case_id: input.case_id,
            source_channel: 'phone',
            source_system: 'phone_call',
            direction: 'inbound',
            sender_name: input.counterpart_name,
            sender_contact: input.counterpart_contact,
            event_type: PHONE_EVENT_TYPE_TO_INBOUND_EVENT_TYPE[input.event_type],
            raw_text: input.content,
            normalized_summary: PHONE_EVENT_SUBJECTS[input.event_type],
            has_medication_stock_signal: hasMedicationStockSignal(input.event_type),
            has_patient_safety_signal: hasPatientSafetySignal(input.event_type),
            has_schedule_signal: hasScheduleSignal(input.event_type),
            confidence: 'high',
            processing_status: 'unprocessed',
            created_by: ctx.userId,
            ...(input.occurred_at ? { occurred_at: new Date(input.occurred_at) } : {}),
          },
          select: {
            id: true,
            patient_id: true,
            case_id: true,
            event_type: true,
            source_channel: true,
            received_at: true,
          },
        });

        return { ok: true as const, event: created };
      },
      { requestContext: ctx },
    );

    if (!eventResult.ok) return withSensitiveNoStore(eventResult.response);

    const event = eventResult.event;
    return withSensitiveNoStore(
      success(
        {
          data: {
            id: event.id,
            patient_id: event.patient_id,
            case_id: event.case_id,
            event_type: event.event_type,
            channel: event.source_channel,
            status: 'needs_review',
            action_href: buildInboundPhoneHref(event.patient_id),
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
    message: '他職種受信の登録権限がありません',
  },
);

export const POST: typeof authenticatedPOST = async (req, routeContext) => {
  try {
    return await authenticatedPOST(req, routeContext);
  } catch (err) {
    unstable_rethrow(err);
    logger.error(
      {
        event: 'inbound_phone_post_unhandled_error',
        route: ROUTE,
        method: req.method,
        status: 500,
      },
      err,
    );
    return withSensitiveNoStore(internalError());
  }
};
