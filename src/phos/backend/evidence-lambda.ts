import { DynamoDBClient, type DynamoDBClient as AwsDynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import {
  createEvidencePresignUploadHandler,
  createS3EvidenceUploadPresigner,
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

type EvidenceLambdaDependencies = PhosLambdaRuntimeDependencies & {
  presigner?: EvidenceUploadPresigner;
  upload_intent_store?: EvidenceUploadIntentStore;
  dynamo_client?: Pick<AwsDynamoDBClient, 'send'>;
  s3_client?: S3Client;
  bucket?: string;
  expires_in_seconds?: number;
  generateEvidenceId?: () => string;
  max_size_bytes?: number;
};

export function createEvidenceUploadPresigner(
  deps: EvidenceLambdaDependencies = {},
): EvidenceUploadPresigner {
  if (deps.presigner) return deps.presigner;
  const bucket = deps.bucket ?? process.env.PHOS_EVIDENCE_BUCKET;
  if (!bucket) {
    throw new Error('PH-OS evidence S3 bucket is not configured');
  }
  return createS3EvidenceUploadPresigner({
    client: deps.s3_client ?? new S3Client({}),
    bucket,
    expires_in_seconds: deps.expires_in_seconds,
  });
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

export function createEvidencePresignUploadLambdaHandler(deps: EvidenceLambdaDependencies = {}) {
  return withTenantContext(
    createEvidencePresignUploadHandler(createEvidenceUploadPresigner(deps), {
      generateEvidenceId: deps.generateEvidenceId,
      max_size_bytes: deps.max_size_bytes,
      upload_intent_store: createEvidenceUploadIntentStore(deps),
    }),
    {
      observability: createLambdaObservabilitySink(deps),
      now: deps.now,
    },
  );
}

export const evidencePresignUploadHandler: ReturnType<
  typeof createEvidencePresignUploadLambdaHandler
> = (event) => createEvidencePresignUploadLambdaHandler()(event);
