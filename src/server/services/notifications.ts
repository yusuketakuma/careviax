import { Prisma, type MemberRole, type NotificationType } from '@prisma/client';
import { isMemberRole } from '@/lib/auth/member-roles';
import { readJsonObject } from '@/lib/db/json';
import { mapWithConcurrency, normalizeConcurrencyLimit } from '@/lib/utils/concurrency';
import { logger } from '@/lib/utils/logger';
import { normalizeNotificationStreamItem } from '@/lib/notifications/stream-payload';
import { getRealtimeAdapter } from '@/server/adapters/realtime';
import { enqueueNotificationDeliveries } from '@/server/services/notification-delivery-outbox';

const DEFAULT_NOTIFICATION_DELIVERY_CONCURRENCY = 16;
const MAX_NOTIFICATION_DELIVERY_CONCURRENCY = 32;
const EXTERNAL_NOTIFICATION_TITLE = 'PH-OS通知';
const EXTERNAL_NOTIFICATION_MESSAGE = 'アプリで詳細を確認してください';

function resolveNotificationDeliveryConcurrency() {
  return normalizeConcurrencyLimit(process.env.NOTIFICATION_DELIVERY_CONCURRENCY, {
    defaultValue: DEFAULT_NOTIFICATION_DELIVERY_CONCURRENCY,
    max: MAX_NOTIFICATION_DELIVERY_CONCURRENCY,
  });
}

type Tx = {
  domainEventOutbox: Pick<Prisma.TransactionClient['domainEventOutbox'], 'createMany'>;
  membership: Pick<Prisma.TransactionClient['membership'], 'findMany'>;
  notification: Pick<Prisma.TransactionClient['notification'], 'create' | 'upsert'>;
  notificationRule: Pick<Prisma.TransactionClient['notificationRule'], 'findMany'>;
  pushSubscription: Pick<Prisma.TransactionClient['pushSubscription'], 'findMany'>;
  user: Pick<Prisma.TransactionClient['user'], 'findMany'>;
};
type NotificationChannel = 'in_app' | 'sms' | 'line' | 'email' | 'fax' | 'mcs';
const DISPATCHED_NOTIFICATION_CHANNELS = ['in_app', 'sms', 'line', 'fax', 'mcs'] as const;
const dispatchedNotificationChannelSet = new Set<string>(DISPATCHED_NOTIFICATION_CHANNELS);
type PersistedNotification = {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  message: string;
  link: string | null;
  is_read?: boolean;
  created_at?: Date | string;
};

type DispatchNotificationEventInput = {
  orgId: string;
  eventType: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  explicitUserIds?: string[];
  dedupeKey?: string | null;
};

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function uniqueMemberRoles(values: MemberRole[]) {
  return Array.from(new Set(values));
}

function getRecipientConfig(recipients: Prisma.JsonValue) {
  return readJsonObject(recipients) ?? {};
}

function readRecipientRoles(recipients: Prisma.JsonValue) {
  const roles = getRecipientConfig(recipients).roles;
  return Array.isArray(roles) ? roles.filter(isMemberRole) : [];
}

function readRecipientUserIds(recipients: Prisma.JsonValue) {
  const userIds = getRecipientConfig(recipients).user_ids;
  return Array.isArray(userIds)
    ? userIds.filter((userId): userId is string => typeof userId === 'string')
    : [];
}

function buildNotificationUserChannel(userId: string) {
  return `user:${userId}`;
}

function toNotificationStreamItem(notification: PersistedNotification) {
  return normalizeNotificationStreamItem(
    {
      ...notification,
      is_read: notification.is_read ?? false,
      created_at: notification.created_at ?? new Date(),
    },
    { contentPolicy: 'sse-safe' },
  );
}

export function buildExternalNotificationContent() {
  return {
    title: EXTERNAL_NOTIFICATION_TITLE,
    message: EXTERNAL_NOTIFICATION_MESSAGE,
  };
}

async function broadcastPersistedNotifications(notifications: PersistedNotification[]) {
  if (notifications.length === 0) return;

  try {
    const adapter = getRealtimeAdapter();
    await mapWithConcurrency(
      notifications,
      resolveNotificationDeliveryConcurrency(),
      async (notification) => {
        const streamItem = toNotificationStreamItem(notification);
        if (!streamItem) return null;
        return adapter.broadcastStatusUpdate(buildNotificationUserChannel(notification.user_id), [
          streamItem,
        ] as unknown as Record<string, unknown>);
      },
    );
  } catch (cause) {
    logger.warn(
      {
        event: 'notifications.realtime_delivery_failed',
        entityType: 'notification',
        operation: 'broadcast',
        count: notifications.length,
      },
      cause,
    );
  }
}

function getEnabledRulesForChannel(
  rules: NotificationRecipientRule[],
  channel: NotificationChannel,
) {
  return rules.filter((rule) => rule.channel === channel && rule.enabled);
}

type NotificationRecipientRule = {
  channel: string;
  enabled: boolean;
  recipients: Prisma.JsonValue;
};

type EligibleNotificationRecipients = {
  directUserIds: ReadonlySet<string>;
  userIdsByRole: ReadonlyMap<MemberRole, ReadonlySet<string>>;
};

function allowsExplicitRecipients(
  rules: NotificationRecipientRule[],
  channel: NotificationChannel,
) {
  const channelRules = rules.filter((rule) => rule.channel === channel);
  const enabledRules = getEnabledRulesForChannel(rules, channel);
  return channel === 'in_app'
    ? channelRules.length === 0 || enabledRules.length > 0
    : enabledRules.length > 0;
}

async function resolveEligibleNotificationRecipients(
  tx: Tx,
  input: Pick<DispatchNotificationEventInput, 'orgId' | 'explicitUserIds'>,
  rules: NotificationRecipientRule[],
): Promise<EligibleNotificationRecipients> {
  const enabledRules = rules.filter(
    (rule) => rule.enabled && dispatchedNotificationChannelSet.has(rule.channel),
  );
  const explicitRecipientsEnabled = DISPATCHED_NOTIFICATION_CHANNELS.some((channel) =>
    allowsExplicitRecipients(rules, channel),
  );
  const directCandidateUserIds = uniqueStrings([
    ...(explicitRecipientsEnabled ? (input.explicitUserIds ?? []) : []),
    ...enabledRules.flatMap((rule) => readRecipientUserIds(rule.recipients)),
  ]);
  const candidateRoles = uniqueMemberRoles(
    enabledRules.flatMap((rule) => readRecipientRoles(rule.recipients)),
  );
  const candidateFilters: Prisma.MembershipWhereInput[] = [];
  if (directCandidateUserIds.length > 0) {
    candidateFilters.push({ user_id: { in: directCandidateUserIds } });
  }
  if (candidateRoles.length > 0) {
    candidateFilters.push({ role: { in: candidateRoles } });
  }
  if (candidateFilters.length === 0) {
    return { directUserIds: new Set(), userIdsByRole: new Map() };
  }

  const memberships = await tx.membership.findMany({
    where: {
      org_id: input.orgId,
      is_active: true,
      user: {
        is_active: true,
        account_status: 'active',
      },
      OR: candidateFilters,
    },
    select: {
      user_id: true,
      role: true,
    },
  });
  const directCandidateUserIdSet = new Set(directCandidateUserIds);
  const candidateRoleSet = new Set(candidateRoles);
  const directUserIds = new Set<string>();
  const userIdsByRole = new Map<MemberRole, Set<string>>();

  for (const membership of memberships) {
    if (directCandidateUserIdSet.has(membership.user_id)) {
      directUserIds.add(membership.user_id);
    }
    if (candidateRoleSet.has(membership.role)) {
      const userIds = userIdsByRole.get(membership.role) ?? new Set<string>();
      userIds.add(membership.user_id);
      userIdsByRole.set(membership.role, userIds);
    }
  }

  return { directUserIds, userIdsByRole };
}

function resolveTargetUserIds(
  input: Pick<DispatchNotificationEventInput, 'explicitUserIds'>,
  rules: NotificationRecipientRule[],
  channel: NotificationChannel,
  eligibleRecipients: EligibleNotificationRecipients,
) {
  const enabledRules = getEnabledRulesForChannel(rules, channel);
  if (channel !== 'in_app' && enabledRules.length === 0) {
    return [];
  }

  const roleRecipients = uniqueMemberRoles(
    enabledRules.flatMap((rule) => readRecipientRoles(rule.recipients)),
  );
  const userRecipients = uniqueStrings(
    enabledRules.flatMap((rule) => readRecipientUserIds(rule.recipients)),
  );
  const allowExplicitRecipients = allowsExplicitRecipients(rules, channel);
  const directUserIds = uniqueStrings([
    ...(allowExplicitRecipients ? (input.explicitUserIds ?? []) : []),
    ...userRecipients,
  ]).filter((userId) => eligibleRecipients.directUserIds.has(userId));
  const roleUserIds = roleRecipients.flatMap((role) =>
    Array.from(eligibleRecipients.userIdsByRole.get(role) ?? []),
  );

  return uniqueStrings([...directUserIds, ...roleUserIds]);
}

export async function dispatchNotificationEvent(tx: Tx, input: DispatchNotificationEventInput) {
  const rules = await tx.notificationRule.findMany({
    where: {
      org_id: input.orgId,
      event_type: input.eventType,
    },
  });
  const eligibleRecipients = await resolveEligibleNotificationRecipients(tx, input, rules);
  const targetUserIds = resolveTargetUserIds(input, rules, 'in_app', eligibleRecipients);

  if (targetUserIds.length === 0) {
    const smsUserIds = resolveTargetUserIds(input, rules, 'sms', eligibleRecipients);
    const lineUserIds = resolveTargetUserIds(input, rules, 'line', eligibleRecipients);
    if (smsUserIds.length === 0 && lineUserIds.length === 0) {
      return [];
    }
  }

  const notifications = await mapWithConcurrency(
    targetUserIds,
    resolveNotificationDeliveryConcurrency(),
    async (userId) => {
      if (input.dedupeKey) {
        return tx.notification.upsert({
          where: {
            org_id_user_id_dedupe_key: {
              org_id: input.orgId,
              user_id: userId,
              dedupe_key: input.dedupeKey!,
            },
          },
          create: {
            org_id: input.orgId,
            user_id: userId,
            event_type: input.eventType,
            type: input.type,
            title: input.title,
            message: input.message,
            link: input.link ?? null,
            metadata: input.metadata ?? Prisma.JsonNull,
            dedupe_key: input.dedupeKey,
          },
          update: {
            event_type: input.eventType,
            type: input.type,
            title: input.title,
            message: input.message,
            link: input.link ?? null,
            metadata: input.metadata ?? Prisma.JsonNull,
            is_read: false,
            read_at: null,
          },
        });
      }
      return tx.notification.create({
        data: {
          org_id: input.orgId,
          user_id: userId,
          event_type: input.eventType,
          type: input.type,
          title: input.title,
          message: input.message,
          link: input.link ?? null,
          metadata: input.metadata ?? Prisma.JsonNull,
        },
      });
    },
  );

  await broadcastPersistedNotifications(notifications);

  const smsUserIds = resolveTargetUserIds(input, rules, 'sms', eligibleRecipients);
  const lineUserIds = resolveTargetUserIds(input, rules, 'line', eligibleRecipients);
  const pushSubscriptions =
    targetUserIds.length > 0
      ? await tx.pushSubscription.findMany({
          where: { org_id: input.orgId, user_id: { in: targetUserIds } },
          select: { id: true },
        })
      : [];

  await enqueueNotificationDeliveries(tx, {
    orgId: input.orgId,
    sourceEventType: input.eventType,
    notificationType: input.type,
    dedupeKey: input.dedupeKey,
    targets: [
      ...smsUserIds.map((userId) => ({
        channel: 'sms' as const,
        aggregateType: 'user' as const,
        aggregateId: userId,
      })),
      ...lineUserIds.map((userId) => ({
        channel: 'line' as const,
        aggregateType: 'user' as const,
        aggregateId: userId,
      })),
      ...pushSubscriptions.map((subscription) => ({
        channel: 'web_push' as const,
        aggregateType: 'push_subscription' as const,
        aggregateId: subscription.id,
      })),
    ],
  });

  return notifications;
}
