import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { successWithMeasuredJsonPayload, validationError, internalError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import {
  listCommunicationQueue,
  type CommunicationQueueItem,
} from '@/server/services/communication-queue';
import { logger } from '@/lib/utils/logger';

const ROUTE = '/api/communications/inbound';
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 50;
const CHANNELS = ['phone', 'fax', 'email', 'mcs'] as const;
const STATUSES = [
  'needs_review',
  'reviewed_pending_action',
  'task_created',
  'task_completed',
] as const;
const PRIORITIES = ['urgent', 'high', 'normal'] as const;

type InboundChannel = (typeof CHANNELS)[number];
type InboundStatus = (typeof STATUSES)[number];
type InboundPriority = (typeof PRIORITIES)[number];

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

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    try {
      const { searchParams } = req.nextUrl;
      const limitResult = parseLimit(searchParams);
      if (!limitResult.ok) return withSensitiveNoStore(limitResult.response);

      const channelResult = parseEnumParam(searchParams, 'channel', CHANNELS);
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
              channel_counts: CHANNELS.reduce<Record<InboundChannel, number>>(
                (acc, current) => {
                  acc[current] = overview.items.filter((item) => item.channel === current).length;
                  return acc;
                },
                { phone: 0, fax: 0, email: 0, mcs: 0 },
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
