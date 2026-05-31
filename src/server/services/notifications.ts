import { Prisma, type MemberRole, type NotificationType } from '@prisma/client';
import webpush from 'web-push';
import { isMemberRole } from '@/lib/auth/member-roles';
import { LineNotificationAdapter } from '@/server/adapters/line';
import { SmsNotificationAdapter } from '@/server/adapters/sms';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:noreply@ph-os.jp';

function getWebPushEnabled() {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

if (getWebPushEnabled()) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!);
}

type Tx = {
  membership: Pick<Prisma.TransactionClient['membership'], 'findMany'>;
  notification: Pick<Prisma.TransactionClient['notification'], 'create' | 'upsert'>;
  notificationRule: Pick<Prisma.TransactionClient['notificationRule'], 'findMany'>;
  pushSubscription: Pick<Prisma.TransactionClient['pushSubscription'], 'findMany'>;
  user: Pick<Prisma.TransactionClient['user'], 'findMany'>;
};
type NotificationChannel = 'in_app' | 'sms' | 'line' | 'email' | 'fax' | 'mcs';

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
  if (!recipients || typeof recipients !== 'object' || Array.isArray(recipients)) {
    return {};
  }
  return recipients as Record<string, Prisma.JsonValue>;
}

function readRecipientRoles(recipients: Prisma.JsonValue) {
  const roles = getRecipientConfig(recipients).roles;
  return Array.isArray(roles) ? roles.filter(isMemberRole) : [];
}

function readRecipientUserIds(recipients: Prisma.JsonValue) {
  const userIds = getRecipientConfig(recipients).user_ids;
  return Array.isArray(userIds) ? userIds.filter((userId): userId is string => typeof userId === 'string') : [];
}

const smsAdapter = new SmsNotificationAdapter();
const lineAdapter = new LineNotificationAdapter();

function getEnabledRulesForChannel(
  rules: Array<{
    channel: string;
    enabled: boolean;
    recipients: Prisma.JsonValue;
  }>,
  channel: NotificationChannel
) {
  return rules.filter((rule) => rule.channel === channel && rule.enabled);
}

async function resolveTargetUserIds(
  tx: Tx,
  input: Pick<DispatchNotificationEventInput, 'orgId' | 'explicitUserIds'>,
  rules: Array<{
    channel: string;
    enabled: boolean;
    recipients: Prisma.JsonValue;
  }>,
  channel: NotificationChannel
) {
  const channelRules = rules.filter((rule) => rule.channel === channel);
  const enabledRules = getEnabledRulesForChannel(rules, channel);
  if (channel !== 'in_app' && enabledRules.length === 0) {
    return [];
  }

  const roleRecipients = uniqueMemberRoles(
    enabledRules.flatMap((rule) => readRecipientRoles(rule.recipients))
  );
  const userRecipients = uniqueStrings(
    enabledRules.flatMap((rule) => readRecipientUserIds(rule.recipients))
  );

  const membershipRecipients =
    roleRecipients.length === 0
      ? []
      : await tx.membership.findMany({
          where: {
            org_id: input.orgId,
            is_active: true,
            role: { in: roleRecipients },
            user: {
              is_active: true,
            },
          },
          select: {
            user_id: true,
          },
        });

  const allowExplicitRecipients =
    channel === 'in_app'
      ? channelRules.length === 0 || enabledRules.length > 0
      : enabledRules.length > 0;

  return uniqueStrings([
    ...(allowExplicitRecipients ? (input.explicitUserIds ?? []) : []),
    ...userRecipients,
    ...membershipRecipients.map((membership) => membership.user_id),
  ]);
}

export async function dispatchNotificationEvent(
  tx: Tx,
  input: DispatchNotificationEventInput
) {
  const rules = await tx.notificationRule.findMany({
    where: {
      org_id: input.orgId,
      event_type: input.eventType,
    },
  });
  const targetUserIds = await resolveTargetUserIds(tx, input, rules, 'in_app');

  if (targetUserIds.length === 0) {
    const smsUserIds = await resolveTargetUserIds(tx, input, rules, 'sms');
    const lineUserIds = await resolveTargetUserIds(tx, input, rules, 'line');
    if (smsUserIds.length === 0 && lineUserIds.length === 0) {
      return [];
    }
  }

  const notifications = await Promise.all(
    targetUserIds.map((userId) => {
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
    })
  );

  const [smsUserIds, lineUserIds, faxUserIds, mcsUserIds] = await Promise.all([
    resolveTargetUserIds(tx, input, rules, 'sms'),
    resolveTargetUserIds(tx, input, rules, 'line'),
    resolveTargetUserIds(tx, input, rules, 'fax'),
    resolveTargetUserIds(tx, input, rules, 'mcs'),
  ]);
  const externalUserIds = uniqueStrings([...smsUserIds, ...lineUserIds, ...faxUserIds, ...mcsUserIds]);

  // Web Push — send to all subscriptions for in-app notification recipients
  if (getWebPushEnabled() && targetUserIds.length > 0) {
    const pushSubscriptions = await tx.pushSubscription.findMany({
      where: { org_id: input.orgId, user_id: { in: targetUserIds } },
      select: { endpoint: true, p256dh: true, auth: true },
    });

    const pushPayload = JSON.stringify({
      title: input.title,
      body: input.message,
      link: input.link ?? null,
    });

    await Promise.allSettled(
      pushSubscriptions.map((sub) =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          pushPayload
        )
      )
    );
  }

  if (externalUserIds.length > 0) {
    const users = await tx.user.findMany({
      where: {
        org_id: input.orgId,
        id: { in: externalUserIds },
        is_active: true,
      },
      select: {
        id: true,
        phone: true,
      },
    });
    const usersById = new Map(users.map((user) => [user.id, user]));

    await Promise.all([
      ...smsUserIds
        .filter((userId) => usersById.get(userId)?.phone)
        .map((userId) =>
          smsAdapter.sendSms(usersById.get(userId)!.phone!, `${input.title}\n${input.message}`)
        ),
      ...lineUserIds
        .filter((userId) => usersById.has(userId))
        .map((userId) =>
          lineAdapter.sendMessage(userId, `${input.title}\n${input.message}`)
        ),
    ]);
  }

  return notifications;
}
