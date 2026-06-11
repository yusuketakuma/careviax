import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteConnection,
  getConnection,
  listConnectionsByRoom,
  type VerifiedConnection,
} from '../shared/connection-store';
import { handler } from './handler';

const {
  apiGatewayClientMock,
  apiGatewaySendMock,
  deleteConnectionCommandMock,
  postToConnectionCommandMock,
} = vi.hoisted(() => ({
  apiGatewayClientMock: vi.fn(),
  apiGatewaySendMock: vi.fn(),
  deleteConnectionCommandMock: vi.fn(function MockDeleteConnectionCommand(
    this: { commandName?: string; input?: unknown },
    input: unknown,
  ) {
    this.commandName = 'DeleteConnectionCommand';
    this.input = input;
  }),
  postToConnectionCommandMock: vi.fn(function MockPostToConnectionCommand(
    this: { commandName?: string; input?: unknown },
    input: unknown,
  ) {
    this.commandName = 'PostToConnectionCommand';
    this.input = input;
  }),
}));

vi.mock('@aws-sdk/client-apigatewaymanagementapi', () => ({
  ApiGatewayManagementApiClient: apiGatewayClientMock.mockImplementation(
    function MockApiGatewayClient() {
      return {
        send: apiGatewaySendMock,
      };
    },
  ),
  GoneException: class GoneException extends Error {
    constructor() {
      super('gone');
      this.name = 'GoneException';
    }
  },
  DeleteConnectionCommand: deleteConnectionCommandMock,
  PostToConnectionCommand: postToConnectionCommandMock,
}));

vi.mock('../shared/connection-store', () => ({
  deleteConnection: vi.fn(),
  getConnection: vi.fn(),
  listConnectionsByRoom: vi.fn(),
}));

const deleteConnectionMock = vi.mocked(deleteConnection);
const getConnectionMock = vi.mocked(getConnection);
const listConnectionsByRoomMock = vi.mocked(listConnectionsByRoom);

function connection(overrides: Partial<VerifiedConnection> = {}): VerifiedConnection {
  const expiresAt = Math.floor(Date.now() / 1000) + 300;
  return {
    connectionId: 'conn_sender',
    room: 'org_1:dispense_task:dt_1',
    userId: 'user_1',
    orgId: 'org_1',
    entityType: 'dispense_task',
    entityId: 'dt_1',
    connectedAt: expiresAt - 300,
    expiresAt,
    ttl: expiresAt,
    ...overrides,
  };
}

function syncEvent(body = Buffer.from([0, 1, 2]).toString('base64')) {
  return {
    body,
    isBase64Encoded: true,
    requestContext: {
      connectionId: 'conn_sender',
      domainName: 'abc.execute-api.ap-northeast-1.amazonaws.com',
      stage: 'prod',
    },
  };
}

function syncEventForEndpoint(endpoint: string, body = Buffer.from([0, 1, 2]).toString('base64')) {
  const parsedEndpoint = new URL(endpoint);
  return {
    body,
    isBase64Encoded: true,
    requestContext: {
      connectionId: 'conn_sender',
      domainName: parsedEndpoint.hostname,
      stage: parsedEndpoint.pathname.slice(1),
    },
  };
}

function sentCommandInputs(commandName: string) {
  return apiGatewaySendMock.mock.calls
    .map(([command]) => command as { commandName?: string; input?: unknown })
    .filter((command) => command.commandName === commandName)
    .map((command) => command.input);
}

function sentDeleteConnectionIds() {
  return sentCommandInputs('DeleteConnectionCommand').map(
    (input) => (input as { ConnectionId?: string }).ConnectionId,
  );
}

function sentPostConnectionIds() {
  return sentCommandInputs('PostToConnectionCommand').map(
    (input) => (input as { ConnectionId?: string }).ConnectionId,
  );
}

describe('websocket sync handler', () => {
  afterEach(() => {
    vi.useRealTimers();
    apiGatewayClientMock.mockClear();
    apiGatewaySendMock.mockReset();
    deleteConnectionMock.mockReset();
    getConnectionMock.mockReset();
    listConnectionsByRoomMock.mockReset();
    deleteConnectionCommandMock.mockClear();
    postToConnectionCommandMock.mockClear();
    delete process.env.WEBSOCKET_API_ENDPOINT;
    delete process.env.PHOS_AWS_CLIENT_MAX_ATTEMPTS;
  });

  it('broadcasts only to peers in the verified sender room from the connection store', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T00:00:00.000Z'));
    getConnectionMock.mockResolvedValue(connection());
    listConnectionsByRoomMock.mockResolvedValue([
      connection(),
      connection({ connectionId: 'conn_peer' }),
      connection({ connectionId: 'conn_expired', expiresAt: 1, ttl: 1 }),
    ]);
    apiGatewaySendMock.mockResolvedValue({});

    await expect(handler(syncEvent())).resolves.toEqual({ statusCode: 200 });

    expect(listConnectionsByRoomMock).toHaveBeenCalledWith('org_1:dispense_task:dt_1');
    expect(postToConnectionCommandMock).toHaveBeenCalledTimes(1);
    expect(postToConnectionCommandMock).toHaveBeenCalledWith({
      ConnectionId: 'conn_peer',
      Data: Buffer.from([0, 1, 2]),
    });
    expect(deleteConnectionMock).toHaveBeenCalledWith('conn_expired');
    expect(deleteConnectionCommandMock).toHaveBeenCalledWith({
      ConnectionId: 'conn_expired',
    });
    expect(apiGatewayClientMock).toHaveBeenCalledWith({
      endpoint: 'https://abc.execute-api.ap-northeast-1.amazonaws.com/prod',
      maxAttempts: 2,
    });
    expect(apiGatewaySendMock).toHaveBeenCalledWith(expect.anything(), {
      abortSignal: expect.any(AbortSignal),
    });
    expect(sentDeleteConnectionIds()).toContain('conn_expired');
  });

  it('reuses the timeout-wrapped API Gateway client for the same endpoint', async () => {
    const endpoint = 'https://reuse.execute-api.ap-northeast-1.amazonaws.com/prod';
    process.env.WEBSOCKET_API_ENDPOINT = endpoint;
    getConnectionMock.mockResolvedValue(connection());
    listConnectionsByRoomMock.mockResolvedValue([connection({ connectionId: 'conn_peer' })]);
    apiGatewaySendMock.mockResolvedValue({});

    await expect(handler(syncEventForEndpoint(endpoint))).resolves.toEqual({ statusCode: 200 });
    await expect(handler(syncEventForEndpoint(endpoint))).resolves.toEqual({ statusCode: 200 });

    expect(apiGatewayClientMock).toHaveBeenCalledTimes(1);
    expect(apiGatewayClientMock).toHaveBeenCalledWith({
      endpoint,
      maxAttempts: 2,
    });
    expect(postToConnectionCommandMock).toHaveBeenCalledTimes(2);
    expect(apiGatewaySendMock).toHaveBeenCalledWith(expect.anything(), {
      abortSignal: expect.any(AbortSignal),
    });
  });

  it('keeps API Gateway client reuse separated by endpoint', async () => {
    const prodEndpoint = 'https://stage-split.execute-api.ap-northeast-1.amazonaws.com/prod';
    const betaEndpoint = 'https://stage-split.execute-api.ap-northeast-1.amazonaws.com/beta';
    getConnectionMock.mockResolvedValue(connection());
    listConnectionsByRoomMock.mockResolvedValue([connection({ connectionId: 'conn_peer' })]);
    apiGatewaySendMock.mockResolvedValue({});

    process.env.WEBSOCKET_API_ENDPOINT = prodEndpoint;
    await expect(handler(syncEventForEndpoint(prodEndpoint))).resolves.toEqual({ statusCode: 200 });
    process.env.WEBSOCKET_API_ENDPOINT = betaEndpoint;
    await expect(handler(syncEventForEndpoint(betaEndpoint))).resolves.toEqual({ statusCode: 200 });

    expect(apiGatewayClientMock).toHaveBeenCalledTimes(2);
    expect(apiGatewayClientMock).toHaveBeenNthCalledWith(1, {
      endpoint: prodEndpoint,
      maxAttempts: 2,
    });
    expect(apiGatewayClientMock).toHaveBeenNthCalledWith(2, {
      endpoint: betaEndpoint,
      maxAttempts: 2,
    });
    expect(postToConnectionCommandMock).toHaveBeenCalledTimes(2);
  });

  it('does not trust any room-like data in the message body', async () => {
    getConnectionMock.mockResolvedValue(connection({ room: 'org_1:visit_record:vr_1' }));
    listConnectionsByRoomMock.mockResolvedValue([connection({ connectionId: 'conn_peer' })]);
    apiGatewaySendMock.mockResolvedValue({});

    await expect(handler(syncEvent(Buffer.from([1, 2, 3]).toString('base64')))).resolves.toEqual({
      statusCode: 200,
    });

    expect(listConnectionsByRoomMock).toHaveBeenCalledWith('org_1:visit_record:vr_1');
  });

  it.each([
    ['sync', 0],
    ['awareness', 1],
    ['query awareness', 3],
  ])('accepts Yjs %s frames', async (_label, messageType) => {
    getConnectionMock.mockResolvedValue(connection());
    listConnectionsByRoomMock.mockResolvedValue([connection({ connectionId: 'conn_peer' })]);
    apiGatewaySendMock.mockResolvedValue({});

    await expect(
      handler(syncEvent(Buffer.from([messageType, 1, 2]).toString('base64'))),
    ).resolves.toEqual({ statusCode: 200 });

    expect(postToConnectionCommandMock).toHaveBeenCalledWith({
      ConnectionId: 'conn_peer',
      Data: Buffer.from([messageType, 1, 2]),
    });
  });

  it.each([
    ['auth', 2],
    ['unknown', 9],
  ])('rejects Yjs %s frames before reading the connection store', async (_label, messageType) => {
    await expect(
      handler(syncEvent(Buffer.from([messageType, 1, 2]).toString('base64'))),
    ).resolves.toEqual({
      statusCode: 400,
    });

    expect(getConnectionMock).not.toHaveBeenCalled();
    expect(apiGatewaySendMock).not.toHaveBeenCalled();
  });

  it('rejects missing sender connections by closing the stale API Gateway socket', async () => {
    getConnectionMock.mockResolvedValue(null);
    apiGatewaySendMock.mockResolvedValue({});

    await expect(handler(syncEvent())).resolves.toEqual({ statusCode: 403 });

    expect(deleteConnectionMock).not.toHaveBeenCalled();
    expect(listConnectionsByRoomMock).not.toHaveBeenCalled();
    expect(postToConnectionCommandMock).not.toHaveBeenCalled();
    expect(sentDeleteConnectionIds()).toEqual(['conn_sender']);
  });

  it('rejects expired sender connections before broadcasting', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T00:00:00.000Z'));
    getConnectionMock.mockResolvedValue(connection({ expiresAt: 1, ttl: 1 }));
    apiGatewaySendMock.mockResolvedValue({});

    await expect(handler(syncEvent())).resolves.toEqual({ statusCode: 403 });

    expect(deleteConnectionMock).toHaveBeenCalledWith('conn_sender');
    expect(listConnectionsByRoomMock).not.toHaveBeenCalled();
    expect(deleteConnectionCommandMock).toHaveBeenCalledWith({
      ConnectionId: 'conn_sender',
    });
    expect(sentDeleteConnectionIds()).toEqual(['conn_sender']);
    expect(postToConnectionCommandMock).not.toHaveBeenCalled();
  });

  it('still closes an expired sender socket when DDB cleanup fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T00:00:00.000Z'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    getConnectionMock.mockResolvedValue(connection({ expiresAt: 1, ttl: 1 }));
    deleteConnectionMock.mockRejectedValue(new Error('ddb unavailable'));
    apiGatewaySendMock.mockResolvedValue({});

    try {
      await expect(handler(syncEvent())).resolves.toEqual({ statusCode: 403 });
      expect(warnSpy).toHaveBeenCalledWith('[websocket-sync] stale sender cleanup failure', {
        cleanupFailureCount: 1,
        apiCloseFailureCount: 0,
      });
    } finally {
      warnSpy.mockRestore();
    }

    expect(deleteConnectionMock).toHaveBeenCalledWith('conn_sender');
    expect(sentDeleteConnectionIds()).toEqual(['conn_sender']);
    expect(listConnectionsByRoomMock).not.toHaveBeenCalled();
    expect(postToConnectionCommandMock).not.toHaveBeenCalled();
  });

  it('removes stale peers when API Gateway reports a gone connection', async () => {
    const goneError = new Error('gone');
    goneError.name = 'GoneException';
    getConnectionMock.mockResolvedValue(connection());
    listConnectionsByRoomMock.mockResolvedValue([connection({ connectionId: 'conn_peer' })]);
    apiGatewaySendMock.mockRejectedValue(goneError);

    await expect(handler(syncEvent())).resolves.toEqual({ statusCode: 200 });

    expect(deleteConnectionMock).toHaveBeenCalledWith('conn_peer');
    expect(deleteConnectionCommandMock).toHaveBeenCalledWith({
      ConnectionId: 'conn_peer',
    });
    expect(sentDeleteConnectionIds()).toContain('conn_peer');
  });

  it('continues fan-out and cleanup when one peer send fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T00:00:00.000Z'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    getConnectionMock.mockResolvedValue(connection());
    listConnectionsByRoomMock.mockResolvedValue([
      connection(),
      connection({ connectionId: 'conn_failed' }),
      connection({ connectionId: 'conn_delivered' }),
      connection({ connectionId: 'conn_expired', expiresAt: 1, ttl: 1 }),
    ]);
    apiGatewaySendMock.mockImplementation(
      async (command: { input?: { ConnectionId?: string } }) => {
        if (command.input?.ConnectionId === 'conn_failed') {
          throw new Error('temporary gateway failure');
        }
        return {};
      },
    );

    try {
      await expect(handler(syncEvent())).resolves.toEqual({ statusCode: 200 });
      expect(warnSpy).toHaveBeenCalledWith('[websocket-sync] partial fan-out failure', {
        deliveryFailureCount: 1,
        cleanupFailureCount: 0,
        activePeerCount: 2,
        expiredPeerCount: 1,
      });
    } finally {
      warnSpy.mockRestore();
    }

    expect(postToConnectionCommandMock).toHaveBeenCalledWith({
      ConnectionId: 'conn_failed',
      Data: Buffer.from([0, 1, 2]),
    });
    expect(postToConnectionCommandMock).toHaveBeenCalledWith({
      ConnectionId: 'conn_delivered',
      Data: Buffer.from([0, 1, 2]),
    });
    expect(deleteConnectionMock).toHaveBeenCalledWith('conn_expired');
    expect(deleteConnectionMock).not.toHaveBeenCalledWith('conn_failed');
    expect(sentDeleteConnectionIds()).not.toContain('conn_failed');
    expect(deleteConnectionCommandMock).toHaveBeenCalledWith({
      ConnectionId: 'conn_expired',
    });
    expect(sentDeleteConnectionIds()).toContain('conn_expired');
  });

  it('treats API Gateway close failures as best-effort after DDB cleanup succeeds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T00:00:00.000Z'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    getConnectionMock.mockResolvedValue(connection());
    listConnectionsByRoomMock.mockResolvedValue([
      connection(),
      connection({ connectionId: 'conn_delivered' }),
      connection({ connectionId: 'conn_expired', expiresAt: 1, ttl: 1 }),
    ]);
    apiGatewaySendMock.mockImplementation(
      async (command: { commandName?: string; input?: { ConnectionId?: string } }) => {
        if (command.commandName === 'DeleteConnectionCommand') {
          throw new Error('management api close failed');
        }
        return {};
      },
    );

    try {
      await expect(handler(syncEvent())).resolves.toEqual({ statusCode: 200 });
      expect(warnSpy).toHaveBeenCalledWith('[websocket-sync] stale connection close failure', {
        apiCloseFailureCount: 1,
      });
    } finally {
      warnSpy.mockRestore();
    }

    expect(sentPostConnectionIds()).toEqual(['conn_delivered']);
    expect(deleteConnectionMock).toHaveBeenCalledWith('conn_expired');
    expect(sentDeleteConnectionIds()).toEqual(['conn_expired']);
  });

  it('runs expired cleanup even when every active peer send fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T00:00:00.000Z'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    getConnectionMock.mockResolvedValue(connection());
    listConnectionsByRoomMock.mockResolvedValue([
      connection(),
      connection({ connectionId: 'conn_failed_1' }),
      connection({ connectionId: 'conn_failed_2' }),
      connection({ connectionId: 'conn_expired', expiresAt: 1, ttl: 1 }),
    ]);
    apiGatewaySendMock.mockRejectedValue(new Error('gateway unavailable'));

    try {
      await expect(handler(syncEvent())).resolves.toEqual({ statusCode: 502 });
      expect(warnSpy).toHaveBeenCalledWith('[websocket-sync] partial fan-out failure', {
        deliveryFailureCount: 2,
        cleanupFailureCount: 0,
        activePeerCount: 2,
        expiredPeerCount: 1,
      });
    } finally {
      warnSpy.mockRestore();
    }

    expect(postToConnectionCommandMock).toHaveBeenCalledTimes(2);
    expect(deleteConnectionMock).toHaveBeenCalledWith('conn_expired');
    expect(deleteConnectionCommandMock).toHaveBeenCalledWith({
      ConnectionId: 'conn_expired',
    });
    expect(sentDeleteConnectionIds()).toContain('conn_expired');
  });

  it('bounds peer fan-out concurrency for large rooms', async () => {
    getConnectionMock.mockResolvedValue(connection());
    listConnectionsByRoomMock.mockResolvedValue([
      connection(),
      ...Array.from({ length: 25 }, (_, index) =>
        connection({ connectionId: `conn_peer_${index}` }),
      ),
    ]);

    let activeSends = 0;
    let maxActiveSends = 0;
    apiGatewaySendMock.mockImplementation(async () => {
      activeSends += 1;
      maxActiveSends = Math.max(maxActiveSends, activeSends);
      await Promise.resolve();
      activeSends -= 1;
      return {};
    });

    await expect(handler(syncEvent())).resolves.toEqual({ statusCode: 200 });

    expect(postToConnectionCommandMock).toHaveBeenCalledTimes(25);
    expect(maxActiveSends).toBeLessThanOrEqual(10);
  });

  it('rejects malformed events without reading the connection store', async () => {
    await expect(
      handler({
        requestContext: {
          connectionId: 'conn_sender',
          domainName: 'abc.execute-api.ap-northeast-1.amazonaws.com',
        },
      }),
    ).resolves.toEqual({ statusCode: 400 });

    expect(getConnectionMock).not.toHaveBeenCalled();
  });

  it('rejects text frames before reading the connection store', async () => {
    await expect(
      handler({
        body: String.fromCharCode(0, 1, 2),
        isBase64Encoded: false,
        requestContext: {
          connectionId: 'conn_sender',
          domainName: 'abc.execute-api.ap-northeast-1.amazonaws.com',
          stage: 'prod',
        },
      }),
    ).resolves.toEqual({ statusCode: 400 });

    expect(getConnectionMock).not.toHaveBeenCalled();
    expect(apiGatewaySendMock).not.toHaveBeenCalled();
  });

  it('rejects unexpected endpoints and empty or oversized Yjs frames before broadcasting', async () => {
    process.env.WEBSOCKET_API_ENDPOINT =
      'https://expected.execute-api.ap-northeast-1.amazonaws.com/prod';

    await expect(handler(syncEvent())).resolves.toEqual({ statusCode: 400 });

    delete process.env.WEBSOCKET_API_ENDPOINT;
    await expect(handler(syncEvent(Buffer.alloc(0).toString('base64')))).resolves.toEqual({
      statusCode: 400,
    });
    await expect(
      handler(syncEvent(Buffer.alloc(64 * 1024 + 1, 0).toString('base64'))),
    ).resolves.toEqual({
      statusCode: 400,
    });

    expect(getConnectionMock).not.toHaveBeenCalled();
    expect(apiGatewaySendMock).not.toHaveBeenCalled();
  });
});
