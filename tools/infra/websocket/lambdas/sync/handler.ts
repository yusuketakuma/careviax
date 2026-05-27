import {
  ApiGatewayManagementApiClient,
  DeleteConnectionCommand,
  GoneException,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import {
  deleteConnection,
  getConnection,
  listConnectionsByRoom,
  type VerifiedConnection,
} from '../shared/connection-store';

const MAX_YJS_MESSAGE_BYTES = 64 * 1024;
const MAX_FAN_OUT_CONCURRENCY = 10;
const ALLOWED_YJS_MESSAGE_TYPES = new Set([0, 1, 3]);

type SyncEvent = {
  body?: string | null;
  isBase64Encoded?: boolean;
  requestContext: {
    connectionId?: string;
    domainName?: string;
    stage?: string;
  };
};

type TaskResult =
  | {
      ok: true;
      apiCloseFailed?: boolean;
    }
  | {
      ok: false;
      error: unknown;
      apiCloseFailed?: boolean;
    };

function decodeBody(event: SyncEvent) {
  if (!event.body) return null;
  if (!event.isBase64Encoded) return null;
  return Buffer.from(event.body, 'base64');
}

function apiEndpoint(event: SyncEvent) {
  const configuredEndpoint = process.env.WEBSOCKET_API_ENDPOINT;
  const { domainName, stage } = event.requestContext;
  if (!domainName || !stage) return null;
  if (!/^[a-z0-9-]+\.execute-api\.[a-z0-9-]+\.amazonaws\.com$/.test(domainName)) return null;

  const endpoint = `https://${domainName}/${stage}`;
  if (configuredEndpoint && configuredEndpoint !== endpoint) return null;
  return configuredEndpoint ?? endpoint;
}

function isExpired(connection: VerifiedConnection) {
  return connection.expiresAt <= Math.floor(Date.now() / 1000);
}

function isAllowedYjsMessage(data: Uint8Array) {
  if (data.length === 0 || data.length > MAX_YJS_MESSAGE_BYTES) return false;
  return ALLOWED_YJS_MESSAGE_TYPES.has(data[0]);
}

async function postToPeer(args: {
  client: ApiGatewayManagementApiClient;
  connectionId: string;
  data: Uint8Array;
}): Promise<TaskResult> {
  try {
    await args.client.send(
      new PostToConnectionCommand({
        ConnectionId: args.connectionId,
        Data: args.data,
      }),
    );
    return { ok: true };
  } catch (error) {
    if (error instanceof GoneException || (error as { name?: string }).name === 'GoneException') {
      return deleteConnectionBestEffort(args.connectionId, args.client);
    }
    return { ok: false, error };
  }
}

async function closeConnectionBestEffort(
  client: ApiGatewayManagementApiClient,
  connectionId: string,
) {
  try {
    await client.send(new DeleteConnectionCommand({ ConnectionId: connectionId }));
    return false;
  } catch (error) {
    if (error instanceof GoneException || (error as { name?: string }).name === 'GoneException') {
      return false;
    }
    // API Gateway close is best-effort; the DDB record is the sync authority.
    return true;
  }
}

async function deleteConnectionBestEffort(
  connectionId: string,
  client?: ApiGatewayManagementApiClient,
): Promise<TaskResult> {
  const [deleteResult, closeResult] = await Promise.allSettled([
    deleteConnection(connectionId),
    client ? closeConnectionBestEffort(client, connectionId) : Promise.resolve(false),
  ]);
  const apiCloseFailed = closeResult.status === 'fulfilled' ? closeResult.value : true;

  if (deleteResult.status === 'rejected') {
    return { ok: false, error: deleteResult.reason, apiCloseFailed };
  }
  return { ok: true, apiCloseFailed };
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<TaskResult>,
): Promise<TaskResult[]> {
  let nextIndex = 0;
  const results: TaskResult[] = [];

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) return;

      results[currentIndex] = await task(items[currentIndex]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export async function handler(event: SyncEvent) {
  const senderConnectionId = event.requestContext.connectionId;
  const data = decodeBody(event);
  const endpoint = apiEndpoint(event);
  if (!senderConnectionId || !data || !endpoint) return { statusCode: 400 };
  if (!isAllowedYjsMessage(data)) return { statusCode: 400 };

  const client = new ApiGatewayManagementApiClient({ endpoint });
  const sender = await getConnection(senderConnectionId);
  if (!sender) {
    const apiCloseFailed = await closeConnectionBestEffort(client, senderConnectionId);
    if (apiCloseFailed) {
      console.warn('[websocket-sync] stale sender close failure', { apiCloseFailureCount: 1 });
    }
    return { statusCode: 403 };
  }

  if (isExpired(sender)) {
    const senderCleanupResult = await deleteConnectionBestEffort(senderConnectionId, client);
    if (!senderCleanupResult.ok || senderCleanupResult.apiCloseFailed) {
      console.warn('[websocket-sync] stale sender cleanup failure', {
        cleanupFailureCount: senderCleanupResult.ok ? 0 : 1,
        apiCloseFailureCount: senderCleanupResult.apiCloseFailed ? 1 : 0,
      });
    }
    return { statusCode: 403 };
  }

  const peers = await listConnectionsByRoom(sender.room);
  const activePeers = peers.filter(
    (peer) => peer.connectionId !== senderConnectionId && !isExpired(peer),
  );
  const deliveryResults = await runWithConcurrency(activePeers, MAX_FAN_OUT_CONCURRENCY, (peer) =>
    postToPeer({
      client,
      connectionId: peer.connectionId,
      data,
    }),
  );

  const expiredPeers = peers.filter(
    (peer) => peer.connectionId !== senderConnectionId && isExpired(peer),
  );
  const cleanupResults = await runWithConcurrency(expiredPeers, MAX_FAN_OUT_CONCURRENCY, (peer) =>
    deleteConnectionBestEffort(peer.connectionId, client),
  );

  const deliveryFailureCount = deliveryResults.filter((result) => !result.ok).length;
  const cleanupFailureCount = cleanupResults.filter((result) => !result.ok).length;
  const apiCloseFailureCount = [...deliveryResults, ...cleanupResults].filter(
    (result) => result.apiCloseFailed,
  ).length;
  if (deliveryFailureCount > 0 || cleanupFailureCount > 0) {
    console.warn('[websocket-sync] partial fan-out failure', {
      deliveryFailureCount,
      cleanupFailureCount,
      activePeerCount: activePeers.length,
      expiredPeerCount: expiredPeers.length,
    });
  }
  if (apiCloseFailureCount > 0) {
    console.warn('[websocket-sync] stale connection close failure', { apiCloseFailureCount });
  }

  if (activePeers.length > 0 && deliveryFailureCount === activePeers.length) {
    return { statusCode: 502 };
  }

  return { statusCode: 200 };
}
