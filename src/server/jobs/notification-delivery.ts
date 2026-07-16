import { prisma } from '@/lib/db/client';
import {
  drainNotificationDeliveryOutbox,
  listNotificationDeliveryOrgIds,
} from '@/server/services/notification-delivery-outbox';
import { runJob } from './runner';

type NotificationDeliveryJobContext = {
  orgId?: string;
};

export function drainNotificationDeliveries(context: NotificationDeliveryJobContext = {}) {
  return runJob(
    'notification_delivery_drain',
    async () => {
      const orgIds = context.orgId ? [context.orgId] : await listNotificationDeliveryOrgIds(prisma);
      const aggregate = {
        processedCount: 0,
        acceptedCount: 0,
        retryCount: 0,
        unknownCount: 0,
        deadLetterCount: 0,
        errors: [] as string[],
      };

      for (const orgId of orgIds) {
        try {
          const result = await drainNotificationDeliveryOutbox(orgId);
          aggregate.processedCount += result.processedCount;
          aggregate.acceptedCount += result.acceptedCount;
          aggregate.retryCount += result.retryCount;
          aggregate.unknownCount += result.unknownCount;
          aggregate.deadLetterCount += result.deadLetterCount;
          aggregate.errors.push(...result.errors);
        } catch {
          aggregate.errors.push('notification_delivery_org_drain_failed');
        }
      }

      return aggregate;
    },
    context.orgId,
  );
}
