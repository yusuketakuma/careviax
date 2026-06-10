import {
  DynamoDBClient,
  GetItemCommand,
  type AttributeValue,
  type DynamoDBClient as AwsDynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { UserRole } from '@/phos/contracts/phos_contracts';
import {
  createEvidencePresignUploadHandler,
  createS3EvidenceUploadPresigner,
  type EvidenceUploadAuthorizer,
  type EvidenceUploadPresigner,
} from './evidence-handlers';
import {
  createDynamoEvidenceUploadIntentStore,
  type EvidenceUploadIntentStore,
} from './evidence-upload-intent-store';
import {
  createLambdaObservabilitySink,
  type PhosLambdaRuntimeDependencies,
} from './lambda-observability';
import { withTenantContext } from './lambda-handler';
import { dynamoKey } from './dynamodb-attribute-values';
import { cardSk, tenantPk } from './dynamodb-keys';
import { phosCoreTableName } from './dynamo-cards-repository';
import { PhosDomainError } from './cards-repository';
import type { TenantContext } from './tenant-context';

type EvidenceLambdaDependencies = PhosLambdaRuntimeDependencies & {
  presigner?: EvidenceUploadPresigner;
  upload_authorizer?: EvidenceUploadAuthorizer;
  upload_intent_store?: EvidenceUploadIntentStore;
  dynamo_client?: Pick<AwsDynamoDBClient, 'send'>;
  s3_client?: S3Client;
  bucket?: string;
  kms_key_arn?: string;
  expires_in_seconds?: number;
  generateEvidenceId?: () => string;
  max_size_bytes?: number;
};

export function createEvidenceUploadPresigner(
  deps: EvidenceLambdaDependencies = {},
): EvidenceUploadPresigner {
  if (deps.presigner) return deps.presigner;
  const bucket =
    deps.bucket ?? process.env.PHOS_EVIDENCE_BUCKET ?? process.env.PHOS_EVIDENCE_BUCKET_NAME;
  if (!bucket) {
    throw new Error('PH-OS evidence S3 bucket is not configured');
  }
  const kms_key_arn = deps.kms_key_arn ?? process.env.PHOS_EVIDENCE_KMS_KEY_ARN;
  if (!kms_key_arn?.trim()) {
    throw new Error('PH-OS evidence KMS key ARN is not configured');
  }
  return createS3EvidenceUploadPresigner({
    client: deps.s3_client ?? new S3Client({}),
    bucket,
    kms_key_arn,
    expires_in_seconds: deps.expires_in_seconds,
  });
}

function createLazyEvidenceUploadPresigner(
  deps: EvidenceLambdaDependencies = {},
): EvidenceUploadPresigner {
  let presigner: EvidenceUploadPresigner | undefined;
  return {
    presignPut(input) {
      presigner ??= createEvidenceUploadPresigner(deps);
      return presigner.presignPut(input);
    },
  };
}

function stringAttr(item: Record<string, AttributeValue>, key: string): string | undefined {
  const value = item[key];
  return value && 'S' in value ? value.S : undefined;
}

function canBypassEvidenceCardAssignment(ctx: TenantContext): boolean {
  return ctx.role === UserRole.MANAGER || ctx.role === UserRole.ADMIN;
}

export function createDynamoEvidenceUploadAuthorizer(input: {
  client: Pick<AwsDynamoDBClient, 'send'>;
}): EvidenceUploadAuthorizer {
  return {
    async authorizeEvidenceUpload(ctx, card_id) {
      const result = await input.client.send(
        new GetItemCommand({
          TableName: phosCoreTableName(),
          Key: dynamoKey(tenantPk(ctx), cardSk(card_id)),
        }),
      );
      if (!result.Item) {
        throw new PhosDomainError({
          status: 404,
          error_code: 'NOT_FOUND',
          message_key: 'api.error.card_not_found',
          details: { card_id },
        });
      }
      if (canBypassEvidenceCardAssignment(ctx)) return;
      if (
        stringAttr(result.Item as Record<string, AttributeValue>, 'pharmacist_assignee_user_id') ===
        ctx.user_id
      ) {
        return;
      }
      throw new PhosDomainError({
        status: 403,
        error_code: 'FORBIDDEN',
        message_key: 'api.error.forbidden',
        details: {
          reason: 'evidence_card_assignee_forbidden',
          card_id,
        },
      });
    },
  };
}

function createLazyEvidenceUploadAuthorizer(
  deps: EvidenceLambdaDependencies = {},
): EvidenceUploadAuthorizer {
  let authorizer: EvidenceUploadAuthorizer | undefined;
  return {
    authorizeEvidenceUpload(ctx, card_id) {
      authorizer ??=
        deps.upload_authorizer ??
        createDynamoEvidenceUploadAuthorizer({
          client: deps.dynamo_client ?? new DynamoDBClient({}),
        });
      return authorizer.authorizeEvidenceUpload(ctx, card_id);
    },
  };
}

export function createEvidenceUploadIntentStore(
  deps: EvidenceLambdaDependencies = {},
): EvidenceUploadIntentStore {
  if (deps.upload_intent_store) return deps.upload_intent_store;
  return createDynamoEvidenceUploadIntentStore({
    client: deps.dynamo_client ?? new DynamoDBClient({}),
    now: deps.now,
  });
}

function createLazyEvidenceUploadIntentStore(
  deps: EvidenceLambdaDependencies = {},
): EvidenceUploadIntentStore {
  let store: EvidenceUploadIntentStore | undefined;
  return {
    recordUploadIntent(ctx, input) {
      store ??= createEvidenceUploadIntentStore(deps);
      return store.recordUploadIntent(ctx, input);
    },
  };
}

export function createEvidencePresignUploadLambdaHandler(deps: EvidenceLambdaDependencies = {}) {
  return withTenantContext(
    createEvidencePresignUploadHandler(createLazyEvidenceUploadPresigner(deps), {
      generateEvidenceId: deps.generateEvidenceId,
      max_size_bytes: deps.max_size_bytes,
      upload_intent_store: createLazyEvidenceUploadIntentStore(deps),
      upload_authorizer: createLazyEvidenceUploadAuthorizer(deps),
      now: deps.now,
    }),
    {
      observability: createLambdaObservabilitySink(deps),
      now: deps.now,
    },
  );
}

let defaultEvidencePresignUploadHandler:
  | ReturnType<typeof createEvidencePresignUploadLambdaHandler>
  | undefined;

export const evidencePresignUploadHandler: ReturnType<
  typeof createEvidencePresignUploadLambdaHandler
> = (event) => {
  defaultEvidencePresignUploadHandler ??= createEvidencePresignUploadLambdaHandler();
  return defaultEvidencePresignUploadHandler(event);
};
