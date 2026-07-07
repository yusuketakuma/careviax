import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { internalError, success, validationError } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import { parseMedicalCareStationUrl } from '@/lib/patient-mcs/source';
import { logger } from '@/lib/utils/logger';
import { canAccessCommunicationRequestRecord } from '@/server/services/communication-request-access';

const ROUTE = '/api/communications/inbound/mcs';

const MCS_EVENT_TYPES = [
  'general_note',
  'medication_stock_report',
  'medication_safety_report',
  'schedule_request',
] as const;

const MCS_EVENT_SUBJECTS: Record<(typeof MCS_EVENT_TYPES)[number], string> = {
  general_note: 'MCS貼り付け',
  medication_stock_report: 'MCS貼り付け: 残数報告',
  medication_safety_report: 'MCS貼り付け: 薬剤安全確認',
  schedule_request: 'MCS貼り付け: スケジュール相談',
};

const MCS_EVENT_TYPE_TO_INBOUND_EVENT_TYPE: Record<
  (typeof MCS_EVENT_TYPES)[number],
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

const createInboundMcsSchema = z.object({
  patient_id: optionalTrimmedString(100),
  case_id: optionalTrimmedString(100),
  event_type: z.enum(MCS_EVENT_TYPES),
  sender_name: optionalTrimmedString(120),
  sender_role: optionalTrimmedString(80),
  sender_organization: optionalTrimmedString(160),
  source_url: optionalTrimmedString(500),
  content: z.string().trim().min(1, 'MCS本文は必須です').max(4000),
  posted_at: z.string().datetime().optional(),
});

function buildInboundMcsHref(patientId?: string | null) {
  if (!patientId) return '/communications/inbound';
  return `/patients/${encodeURIComponent(patientId)}/mcs`;
}

function toInboundSenderRole(role?: string) {
  if (!role) return 'unknown';
  if (role.includes('看護')) return 'nurse';
  if (role.includes('ケアマネ') || role.includes('介護支援')) return 'care_manager';
  if (role.includes('医師') || role.includes('主治医')) return 'physician';
  if (role.includes('歯科')) return 'dentist';
  if (role.includes('療法士') || role.includes('リハ')) return 'therapist';
  if (role.includes('施設')) return 'facility_staff';
  if (role.includes('家族')) return 'family';
  if (role.includes('患者')) return 'patient';
  if (role.includes('薬剤師')) return 'pharmacist';
  return 'unknown';
}

function hasMedicationStockSignal(eventType: (typeof MCS_EVENT_TYPES)[number]) {
  return eventType === 'medication_stock_report';
}

function hasPatientSafetySignal(eventType: (typeof MCS_EVENT_TYPES)[number]) {
  return eventType === 'medication_safety_report';
}

function hasScheduleSignal(eventType: (typeof MCS_EVENT_TYPES)[number]) {
  return eventType === 'schedule_request';
}

const authenticatedPOST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) {
      return withSensitiveNoStore(validationError('リクエストボディが不正です'));
    }

    const parsed = createInboundMcsSchema.safeParse(payload);
    if (!parsed.success) {
      return withSensitiveNoStore(
        validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
      );
    }

    const input = parsed.data;
    const sourceUrl = input.source_url
      ? parseMedicalCareStationUrl(input.source_url)?.toString()
      : null;
    if (input.source_url && !sourceUrl) {
      return withSensitiveNoStore(
        validationError('入力値が不正です', {
          source_url: ['MCSのURLだけ指定できます'],
        }),
      );
    }

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
            source_channel: 'mcs',
            source_system: 'mcs',
            external_url: sourceUrl,
            direction: 'inbound',
            sender_name: input.sender_name,
            sender_role: toInboundSenderRole(input.sender_role),
            sender_organization_name: input.sender_organization,
            event_type: MCS_EVENT_TYPE_TO_INBOUND_EVENT_TYPE[input.event_type],
            raw_text: input.content,
            normalized_summary: MCS_EVENT_SUBJECTS[input.event_type],
            has_medication_stock_signal: hasMedicationStockSignal(input.event_type),
            has_patient_safety_signal: hasPatientSafetySignal(input.event_type),
            has_schedule_signal: hasScheduleSignal(input.event_type),
            confidence: 'high',
            processing_status: 'unprocessed',
            created_by: ctx.userId,
            ...(input.posted_at ? { occurred_at: new Date(input.posted_at) } : {}),
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
            action_href: buildInboundMcsHref(event.patient_id),
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
    message: 'MCS受信の登録権限がありません',
  },
);

export const POST: typeof authenticatedPOST = async (req, routeContext) => {
  try {
    return await authenticatedPOST(req, routeContext);
  } catch (err) {
    unstable_rethrow(err);
    logger.error(
      {
        event: 'inbound_mcs_post_unhandled_error',
        route: ROUTE,
        method: req.method,
        status: 500,
      },
      err,
    );
    return withSensitiveNoStore(internalError());
  }
};
