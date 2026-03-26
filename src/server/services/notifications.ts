import { Prisma, type NotificationType } from '@prisma/client';

type Tx = Prisma.TransactionClient;

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

export async function dispatchNotificationEvent(
  tx: Tx,
  input: DispatchNotificationEventInput
) {
  const rules = await tx.notificationRule.findMany({
    where: {
      org_id: input.orgId,
      event_type: input.eventType,
      enabled: true,
      channel: 'in_app',
    },
  });

  const roleRecipients = rules.flatMap((rule) => {
    const recipients = rule.recipients as {
      roles?: string[];
      user_ids?: string[];
    } | null;
    return recipients?.roles ?? [];
  });
  const userRecipients = rules.flatMap((rule) => {
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

  const targetUserIds = uniqueStrings([
    ...(input.explicitUserIds ?? []),
    ...userRecipients,
    ...membershipRecipients.map((membership) => membership.user_id),
  ]);

  if (targetUserIds.length === 0) {
    return [];
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

  return notifications;
}
