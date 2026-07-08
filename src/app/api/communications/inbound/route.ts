import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import {
  success,
  successWithMeasuredJsonPayload,
  validationError,
  internalError,
} from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import {
  listCommunicationQueue,
  type CommunicationQueueItem,
} from '@/server/services/communication-queue';
import { canAccessCommunicationRequestRecord } from '@/server/services/communication-request-access';
import { logger } from '@/lib/utils/logger';

const ROUTE = '/api/communications/inbound';
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 50;
const LIST_CHANNELS = ['phone', 'fax', 'email', 'mcs', 'manual'] as const;
const CREATE_CHANNELS = ['fax', 'email', 'manual'] as const;
const STATUSES = [
  'needs_review',
  'reviewed_pending_action',
  'task_created',
  'task_completed',
] as const;
const PRIORITIES = ['urgent', 'high', 'normal'] as const;
const CREATE_EVENT_TYPES = [
  'general_note',
  'medication_stock_report',
  'side_effect_report',
  'schedule_request',
] as const;

const CREATE_EVENT_LABELS: Record<(typeof CREATE_EVENT_TYPES)[number], string> = {
  general_note: '一般メモ',
  medication_stock_report: '残数報告',
  side_effect_report: '薬剤安全確認',
  schedule_request: '日程相談',
};

const CREATE_CHANNEL_LABELS: Record<(typeof CREATE_CHANNELS)[number], string> = {
  fax: 'FAX受信',
  email: 'メール受信',
  manual: '手入力',
};

type InboundChannel = (typeof LIST_CHANNELS)[number];
type InboundStatus = (typeof STATUSES)[number];
type InboundPriority = (typeof PRIORITIES)[number];

const optionalTrimmedString = (maxLength: number) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, z.string().max(maxLength).optional());

const createInboundCommunicationSchema = z
  .object({
    source_channel: z.enum(CREATE_CHANNELS),
    patient_id: optionalTrimmedString(100),
    case_id: optionalTrimmedString(100),
    event_type: z.enum(CREATE_EVENT_TYPES),
    raw_text: z.string().trim().min(1, '本文は必須です').max(4000),
    occurred_at: z.string().datetime().optional(),
    sender_name: optionalTrimmedString(120),
    sender_contact: optionalTrimmedString(120),
    sender_role: z
      .enum([
        'nurse',
        'care_manager',
        'physician',
        'dentist',
        'therapist',
        'facility_staff',
        'family',
        'patient',
        'pharmacist',
        'admin',
        'unknown',
      ])
      .optional(),
    sender_organization_name: optionalTrimmedString(160),
  })
  .strict();

function parseEnumParam<T extends string>(
  searchParams: URLSearchParams,
  key: string,
  allowed: readonly T[],
) {
  const raw = searchParams.get(key);
  if (raw === null || raw === '') return { ok: true as const, value: null };
  if (allowed.includes(raw as T)) return { ok: true as const, value: raw as T };
  return {
    ok: false as const,
    response: validationError('検索条件が不正です', { [key]: ['指定できない値です'] }),
  };
}

function parseLimit(searchParams: URLSearchParams) {
  const raw = searchParams.get('limit');
  if (raw === null || raw === '') return { ok: true as const, value: DEFAULT_LIMIT };

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', {
        limit: ['limit は整数で指定してください'],
      }),
    };
  }

  return { ok: true as const, value: Math.min(Math.max(parsed, 1), MAX_LIMIT) };
}

function isSafeRelativeHref(href: string) {
  if (!href.startsWith('/') || href.startsWith('//')) return false;
  const lowered = href.toLowerCase();
  return (
    !lowered.includes('token=') &&
    !lowered.includes('storagekey=') &&
    !lowered.includes('storage_key=') &&
    !lowered.includes('x-amz-') &&
    !lowered.includes('signature=')
  );
}

function toInboundInboxItem(item: CommunicationQueueItem) {
  return {
    id: item.id,
    title: item.title,
    summary: item.summary,
    channel: item.channel,
    status: item.status,
    priority: item.priority,
    patient_name: item.patient_name,
    due_at: item.due_at,
    action_href: isSafeRelativeHref(item.action_href)
      ? item.action_href
      : '/communications/requests',
    action_label: item.action_label,
  };
}

function hasMedicationStockSignal(eventType: (typeof CREATE_EVENT_TYPES)[number]) {
  return eventType === 'medication_stock_report';
}

function hasPatientSafetySignal(eventType: (typeof CREATE_EVENT_TYPES)[number]) {
  return eventType === 'side_effect_report';
}

function hasScheduleSignal(eventType: (typeof CREATE_EVENT_TYPES)[number]) {
  return eventType === 'schedule_request';
}

function buildNormalizedSummary(input: {
  sourceChannel: (typeof CREATE_CHANNELS)[number];
  eventType: (typeof CREATE_EVENT_TYPES)[number];
}) {
  return `${CREATE_CHANNEL_LABELS[input.sourceChannel]}: ${CREATE_EVENT_LABELS[input.eventType]}`;
}

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    try {
      const { searchParams } = req.nextUrl;
      const limitResult = parseLimit(searchParams);
      if (!limitResult.ok) return withSensitiveNoStore(limitResult.response);

      const channelResult = parseEnumParam(searchParams, 'channel', LIST_CHANNELS);
      if (!channelResult.ok) return withSensitiveNoStore(channelResult.response);

      const statusResult = parseEnumParam(searchParams, 'status', STATUSES);
      if (!statusResult.ok) return withSensitiveNoStore(statusResult.response);

      const priorityResult = parseEnumParam(searchParams, 'priority', PRIORITIES);
      if (!priorityResult.ok) return withSensitiveNoStore(priorityResult.response);

      const overview = await listCommunicationQueue(prisma, {
        orgId: ctx.orgId,
        limit: limitResult.value,
        queueTypes: ['inbound_communication'],
        sourceScope: 'requested',
      });

      const channel = channelResult.value as InboundChannel | null;
      const status = statusResult.value as InboundStatus | null;
      const priority = priorityResult.value as InboundPriority | null;

      const filteredItems = overview.items.filter((item) => {
        if (channel && item.channel !== channel) return false;
        if (status && item.status !== status) return false;
        if (priority && item.priority !== priority) return false;
        return true;
      });

      return withSensitiveNoStore(
        successWithMeasuredJsonPayload({
          data: {
            summary: {
              total_visible_count: overview.summary.inbound_communications,
              filtered_count: filteredItems.length,
              needs_review_count: overview.items.filter((item) => item.status === 'needs_review')
                .length,
              reviewed_pending_action_count: overview.items.filter(
                (item) => item.status === 'reviewed_pending_action',
              ).length,
              urgent_count: overview.items.filter((item) => item.priority === 'urgent').length,
              channel_counts: LIST_CHANNELS.reduce<Record<InboundChannel, number>>(
                (acc, current) => {
                  acc[current] = overview.items.filter((item) => item.channel === current).length;
                  return acc;
                },
                { phone: 0, fax: 0, email: 0, mcs: 0, manual: 0 },
              ),
            },
            items: filteredItems.map(toInboundInboxItem),
            filters: {
              channel,
              status,
              priority,
            },
          },
          meta: {
            generated_at: new Date().toISOString(),
            limit: limitResult.value,
            visible_count: filteredItems.length,
            hidden_count: Math.max(
              overview.summary.inbound_communications - filteredItems.length,
              0,
            ),
            count_basis: 'visible_window',
            partial_failures: [],
          },
        }),
      );
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'inbound_communications_get_unhandled_error',
          route: ROUTE,
          method: req.method,
          status: 500,
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  },
  {
    permission: 'canReport',
    message: '他職種受信の閲覧権限がありません',
  },
);

const authenticatedPOST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) {
      return withSensitiveNoStore(validationError('リクエストボディが不正です'));
    }

    const parsed = createInboundCommunicationSchema.safeParse(payload);
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
            source_channel: input.source_channel,
            source_system: 'ph_os_manual_intake',
            direction: 'inbound',
            sender_name: input.sender_name,
            sender_contact: input.sender_contact,
            sender_role: input.sender_role ?? 'unknown',
            sender_organization_name: input.sender_organization_name,
            event_type: input.event_type,
            raw_text: input.raw_text,
            normalized_summary: buildNormalizedSummary({
              sourceChannel: input.source_channel,
              eventType: input.event_type,
            }),
            attachment_count: 0,
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
            event_type: true,
            source_channel: true,
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
            event_type: event.event_type,
            channel: event.source_channel,
            status: 'needs_review',
            action_href: '/communications/inbound',
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

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return await authenticatedGET(req, routeContext);
  } catch (err) {
    unstable_rethrow(err);
    logger.error(
      {
        event: 'inbound_communications_get_unhandled_error',
        route: ROUTE,
        method: req.method,
        status: 500,
      },
      err,
    );
    return withSensitiveNoStore(internalError());
  }
};

export const POST: typeof authenticatedPOST = async (req, routeContext) => {
  try {
    return await authenticatedPOST(req, routeContext);
  } catch (err) {
    unstable_rethrow(err);
    logger.error(
      {
        event: 'inbound_communications_post_unhandled_error',
        route: ROUTE,
        method: req.method,
        status: 500,
      },
      err,
    );
    return withSensitiveNoStore(internalError());
  }
};
