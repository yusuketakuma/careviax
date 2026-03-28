import { Prisma, type NotificationType } from '@prisma/client';
import { LineNotificationAdapter } from '@/server/adapters/line';
import { SmsNotificationAdapter } from '@/server/adapters/sms';

type Tx = Prisma.TransactionClient;
type NotificationChannel = 'in_app' | 'sms' | 'line' | 'email';

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

  const roleRecipients = enabledRules.flatMap((rule) => {
    const recipients = rule.recipients as {
      roles?: string[];
      user_ids?: string[];
    } | null;
    return recipients?.roles ?? [];
  });
  const userRecipients = enabledRules.flatMap((rule) => {
    const recipients = rule.recipients as {
      roles?: string[];
      user_ids?: string[];
    } | null;
    return recipients?.user_ids ?? [];
  });

  const membershipRecipients =
    roleRecipients.length === 0
      ? []
      : await tx.membership.findMany({
          where: {
            org_id: input.orgId,
            is_active: true,
            role: { in: roleRecipients as never[] },
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

  const notifications = [];
  for (const userId of targetUserIds) {
    if (input.dedupeKey) {
      notifications.push(
        await tx.notification.upsert({
          where: {
            org_id_user_id_dedupe_key: {
              org_id: input.orgId,
              user_id: userId,
              dedupe_key: input.dedupeKey,
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
        })
      );
      continue;
    }

    notifications.push(
      await tx.notification.create({
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
      })
    );
  }

  const smsUserIds = await resolveTargetUserIds(tx, input, rules, 'sms');
  const lineUserIds = await resolveTargetUserIds(tx, input, rules, 'line');
  const externalUserIds = uniqueStrings([...smsUserIds, ...lineUserIds]);

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

    for (const userId of smsUserIds) {
      const phoneNumber = usersById.get(userId)?.phone;
      if (!phoneNumber) continue;
      await smsAdapter.sendSms(phoneNumber, `${input.title}\n${input.message}`);
    }

    for (const userId of lineUserIds) {
      if (!usersById.has(userId)) continue;
      await lineAdapter.sendMessage(userId, `${input.title}\n${input.message}`);
    }
  }

  return notifications;
}
