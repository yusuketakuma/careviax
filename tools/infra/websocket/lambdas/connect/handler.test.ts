import { afterEach, describe, expect, it, vi } from 'vitest';
import { putConnection } from '../shared/connection-store';
import { handler } from './handler';

vi.mock('../shared/connection-store', () => ({
  putConnection: vi.fn(),
}));

const putConnectionMock = vi.mocked(putConnection);

describe('websocket connect handler', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('stores only the verified room from the authorizer context', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T00:00:00.000Z'));

    await expect(
      handler({
        requestContext: {
          connectionId: 'conn_1',
          authorizer: {
            userId: 'user_1',
            orgId: 'org_1',
            entityType: 'dispense_task',
            entityId: 'dt_1',
            room: 'org_1:dispense_task:dt_1',
            tokenExpiresAt: String(Math.floor(Date.now() / 1000) + 300),
          },
        },
      }),
    ).resolves.toEqual({ statusCode: 200 });

    expect(putConnectionMock).toHaveBeenCalledWith({
      connectionId: 'conn_1',
      room: 'org_1:dispense_task:dt_1',
      userId: 'user_1',
      orgId: 'org_1',
      entityType: 'dispense_task',
      entityId: 'dt_1',
      connectedAt: 1779321600,
      expiresAt: 1779321900,
      ttl: 1779321900,
    });
  });

  it('rejects missing or expired authorizer context before storing a connection', async () => {
    await expect(
      handler({
        requestContext: {
          connectionId: 'conn_1',
        },
      }),
    ).resolves.toEqual({ statusCode: 401 });

    await expect(
      handler({
        requestContext: {
          connectionId: 'conn_1',
          authorizer: {
            userId: 'user_1',
            orgId: 'org_1',
            entityType: 'dispense_task',
            entityId: 'dt_1',
            room: 'org_1:dispense_task:dt_1',
            tokenExpiresAt: '1',
          },
        },
      }),
    ).resolves.toEqual({ statusCode: 401 });

    expect(putConnectionMock).not.toHaveBeenCalled();
  });

  it('rejects forged authorizer context with a non-canonical room or unsupported entity type', async () => {
    await expect(
      handler({
        requestContext: {
          connectionId: 'conn_1',
          authorizer: {
            userId: 'user_1',
            orgId: 'org_1',
            entityType: 'dispense_task',
            entityId: 'dt_1',
            room: 'org_1:visit_record:vr_1',
            tokenExpiresAt: String(Math.floor(Date.now() / 1000) + 300),
          },
        },
      }),
    ).resolves.toEqual({ statusCode: 401 });

    await expect(
      handler({
        requestContext: {
          connectionId: 'conn_1',
          authorizer: {
            userId: 'user_1',
            orgId: 'org_1',
            entityType: 'patient',
            entityId: 'patient_1',
            room: 'org_1:patient:patient_1',
            tokenExpiresAt: String(Math.floor(Date.now() / 1000) + 300),
          },
        },
      }),
    ).resolves.toEqual({ statusCode: 401 });

    expect(putConnectionMock).not.toHaveBeenCalled();
  });
});
