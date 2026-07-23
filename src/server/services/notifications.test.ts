import { describe } from 'vitest';
import { registerNotificationCoreCases } from './notifications/fixtures/notifications-core.cases';
import { registerNotificationDeliveryRoutingCases } from './notifications/fixtures/notifications-delivery-routing.cases';
import { registerNotificationDurableDeliveryCases } from './notifications/fixtures/notifications-durable-delivery.cases';
import { registerNotificationTestHooks } from './notifications/fixtures/notifications.test-support';

describe('dispatchNotificationEvent', () => {
  registerNotificationTestHooks();
  registerNotificationCoreCases();
  registerNotificationDeliveryRoutingCases();
  registerNotificationDurableDeliveryCases();
});
