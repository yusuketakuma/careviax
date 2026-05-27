import { putConnection } from '../shared/connection-store';

type ConnectAuthorizerContext = {
  userId?: string;
  orgId?: string;
  entityType?: string;
  entityId?: string;
  room?: string;
  tokenExpiresAt?: string;
};

type ConnectEvent = {
  requestContext: {
    connectionId?: string;
    authorizer?: ConnectAuthorizerContext;
  };
};

function isSupportedEntityType(entityType: string | undefined) {
  return entityType === 'dispense_task' || entityType === 'visit_record';
}

function canonicalRoom(args: { orgId: string; entityType: string; entityId: string }) {
  return `${args.orgId}:${args.entityType}:${args.entityId}`;
}

function getVerifiedConnection(event: ConnectEvent) {
  const connectionId = event.requestContext.connectionId;
  const authorizer = event.requestContext.authorizer;
  const tokenExpiresAt = Number(authorizer?.tokenExpiresAt);

  if (
    !connectionId ||
    !authorizer?.userId ||
    !authorizer.orgId ||
    !isSupportedEntityType(authorizer.entityType) ||
    !authorizer.entityId ||
    !authorizer.room ||
    !Number.isFinite(tokenExpiresAt)
  ) {
    return null;
  }

  if (
    authorizer.room !==
    canonicalRoom({
      orgId: authorizer.orgId,
      entityType: authorizer.entityType,
      entityId: authorizer.entityId,
    })
  ) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (tokenExpiresAt <= now) return null;

  return {
    connectionId,
    room: authorizer.room,
    userId: authorizer.userId,
    orgId: authorizer.orgId,
    entityType: authorizer.entityType,
    entityId: authorizer.entityId,
    connectedAt: now,
    expiresAt: tokenExpiresAt,
    ttl: tokenExpiresAt,
  };
}

export async function handler(event: ConnectEvent) {
  const connection = getVerifiedConnection(event);
  if (!connection) return { statusCode: 401 };

  await putConnection(connection);
  return { statusCode: 200 };
}
