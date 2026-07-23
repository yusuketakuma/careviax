import { afterEach, beforeEach, vi } from 'vitest';
import { buildExternalNotificationContent, dispatchNotificationEvent } from '../../notifications';

const {
  broadcastStatusUpdateMock,
  loggerWarnMock,
  sendSmsMock,
  sendLineMessageMock,
  sendWebPushMock,
  setVapidDetailsMock,
} = vi.hoisted(() => ({
  broadcastStatusUpdateMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  sendSmsMock: vi.fn(),
  sendLineMessageMock: vi.fn(),
  sendWebPushMock: vi.fn(),
  setVapidDetailsMock: vi.fn(),
}));

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: setVapidDetailsMock,
    sendNotification: sendWebPushMock,
  },
}));

vi.mock('@/server/adapters/realtime', () => ({
  getRealtimeAdapter: () => ({
    broadcastStatusUpdate: broadcastStatusUpdateMock,
  }),
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    warn: loggerWarnMock,
  },
}));

vi.mock('@/server/adapters/sms', () => ({
  SmsNotificationAdapter: class {
    sendSms = sendSmsMock;
  },
}));

vi.mock('@/server/adapters/line', () => ({
  LineNotificationAdapter: class {
    sendMessage = sendLineMessageMock;
  },
}));

async function waitForAsyncAssertion(assertion: () => void) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw lastError;
}

function createTx() {
  const notificationRuleFindMany = vi.fn();
  const domainEventOutboxCreateMany = vi.fn().mockResolvedValue({ count: 0 });
  const membershipFindMany = vi.fn();
  const notificationCreate = vi.fn();
  const notificationUpsert = vi.fn();
  const pushSubscriptionFindMany = vi.fn().mockResolvedValue([]);
  const userFindMany = vi.fn();

  return {
    tx: {
      domainEventOutbox: {
        createMany: domainEventOutboxCreateMany,
      },
      notificationRule: {
        findMany: notificationRuleFindMany,
      },
      membership: {
        findMany: membershipFindMany,
      },
      notification: {
        create: notificationCreate,
        upsert: notificationUpsert,
      },
      pushSubscription: {
        findMany: pushSubscriptionFindMany,
      },
      user: {
        findMany: userFindMany,
      },
    },
    notificationRuleFindMany,
    domainEventOutboxCreateMany,
    membershipFindMany,
    notificationCreate,
    notificationUpsert,
    pushSubscriptionFindMany,
    userFindMany,
  };
}

export function getNotificationTestSupport() {
  return {
    broadcastStatusUpdateMock,
    loggerWarnMock,
    sendSmsMock,
    sendLineMessageMock,
    sendWebPushMock,
    setVapidDetailsMock,
    buildExternalNotificationContent,
    dispatchNotificationEvent,
    waitForAsyncAssertion,
    createTx,
  };
}

export function registerNotificationTestHooks() {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });
}
