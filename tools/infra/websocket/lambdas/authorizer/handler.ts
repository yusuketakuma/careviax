import { validateRoomToken } from '../shared/room-token';

type WebSocketAuthorizerEvent = {
  methodArn: string;
  queryStringParameters?: Record<string, string | undefined> | null;
};

type PolicyEffect = 'Allow' | 'Deny';

function buildPolicy(args: {
  effect: PolicyEffect;
  methodArn: string;
  principalId?: string;
  context?: Record<string, string>;
}) {
  return {
    principalId: args.principalId ?? 'unauthorized',
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: args.effect,
          Resource: args.methodArn,
        },
      ],
    },
    context: args.context ?? {},
  };
}

export async function handler(event: WebSocketAuthorizerEvent) {
  const token = event.queryStringParameters?.token;
  const result = await validateRoomToken(token);

  if (!result.ok) {
    return buildPolicy({
      effect: 'Deny',
      methodArn: event.methodArn,
    });
  }

  return buildPolicy({
    effect: 'Allow',
    methodArn: event.methodArn,
    principalId: result.payload.user_id,
    context: {
      userId: result.payload.user_id,
      orgId: result.payload.org_id,
      entityType: result.payload.entity_type,
      entityId: result.payload.entity_id,
      room: result.payload.room,
      tokenExpiresAt: String(result.payload.exp),
    },
  });
}
