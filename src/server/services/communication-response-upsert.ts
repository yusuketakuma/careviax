import type { Prisma } from '@prisma/client';
import {
  buildCommunicationResponseIntentKey,
  buildLegacyCommunicationResponseIntentKey,
  isUniqueConstraintError,
} from '@/lib/communication-response-idempotency';

type CommunicationResponseWriteClient = Pick<
  Prisma.TransactionClient['communicationResponse'],
  'findFirst' | 'create'
>;

type CommunicationResponseWriteDb = {
  communicationResponse: CommunicationResponseWriteClient;
};

type CommunicationResponseRecord = Awaited<ReturnType<CommunicationResponseWriteClient['create']>>;

export type UpsertCommunicationResponseResult = {
  response: CommunicationResponseRecord;
  created: boolean;
  responseIntentKey: string;
};

type CommunicationResponseIntentArgs = {
  db: CommunicationResponseWriteDb;
  orgId: string;
  requestId: string;
  responderName: string;
  content: string;
  respondedAt: Date;
  intentRespondedAt?: Date | null;
};

function resolveIntentRespondedAt(
  args: Pick<CommunicationResponseIntentArgs, 'respondedAt' | 'intentRespondedAt'>,
) {
  return args.intentRespondedAt === undefined ? args.respondedAt : args.intentRespondedAt;
}

function buildCommunicationResponseIntentLookup(args: CommunicationResponseIntentArgs) {
  const responseIntentKey = buildCommunicationResponseIntentKey({
    requestId: args.requestId,
    responderName: args.responderName,
    content: args.content,
    respondedAt: resolveIntentRespondedAt(args),
  });
  const legacyResponseIntentKey = buildLegacyCommunicationResponseIntentKey({
    requestId: args.requestId,
    responderName: args.responderName,
    content: args.content,
    respondedAt: resolveIntentRespondedAt(args),
  });

  const responseLookupWhere = {
    org_id: args.orgId,
    request_id: args.requestId,
    OR: [
      { response_intent_key: responseIntentKey },
      { response_intent_key: legacyResponseIntentKey },
      {
        response_intent_key: null,
        responder_name: args.responderName,
        content: args.content,
        responded_at: args.respondedAt,
      },
    ],
  };

  return {
    responseIntentKey,
    legacyResponseIntentKey,
    responseLookupWhere,
  };
}

export async function findCommunicationResponseByIntent(args: CommunicationResponseIntentArgs) {
  const intent = buildCommunicationResponseIntentLookup(args);
  const existingResponse = await args.db.communicationResponse.findFirst({
    where: intent.responseLookupWhere,
  });
  return {
    response: existingResponse,
    responseIntentKey: intent.responseIntentKey,
    legacyResponseIntentKey: intent.legacyResponseIntentKey,
  };
}

export async function upsertCommunicationResponseByIntent(
  args: CommunicationResponseIntentArgs,
): Promise<UpsertCommunicationResponseResult> {
  const intent = buildCommunicationResponseIntentLookup(args);

  const existingResponse = await args.db.communicationResponse.findFirst({
    where: intent.responseLookupWhere,
  });
  if (existingResponse) {
    return {
      response: existingResponse,
      created: false,
      responseIntentKey: intent.responseIntentKey,
    };
  }

  try {
    const response = await args.db.communicationResponse.create({
      data: {
        org_id: args.orgId,
        request_id: args.requestId,
        responder_name: args.responderName,
        content: args.content,
        responded_at: args.respondedAt,
        response_intent_key: intent.responseIntentKey,
      },
    });
    return {
      response,
      created: true,
      responseIntentKey: intent.responseIntentKey,
    };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    const responseCreatedByConcurrentRetry = await args.db.communicationResponse.findFirst({
      where: {
        org_id: args.orgId,
        request_id: args.requestId,
        response_intent_key: intent.responseIntentKey,
      },
    });
    if (!responseCreatedByConcurrentRetry) throw error;

    return {
      response: responseCreatedByConcurrentRetry,
      created: false,
      responseIntentKey: intent.responseIntentKey,
    };
  }
}
