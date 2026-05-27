import { deleteConnection } from '../shared/connection-store';

type DisconnectEvent = {
  requestContext: {
    connectionId?: string;
  };
};

export async function handler(event: DisconnectEvent) {
  const connectionId = event.requestContext.connectionId;
  if (!connectionId) return { statusCode: 400 };

  await deleteConnection(connectionId);
  return { statusCode: 200 };
}
