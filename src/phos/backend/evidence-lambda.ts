import { S3Client } from '@aws-sdk/client-s3';
import {
  createEvidencePresignUploadHandler,
  createS3EvidenceUploadPresigner,
  type EvidenceUploadPresigner,
} from './evidence-handlers';
import { withTenantContext } from './lambda-handler';

type EvidenceLambdaDependencies = {
  presigner?: EvidenceUploadPresigner;
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

export function createEvidencePresignUploadLambdaHandler(deps: EvidenceLambdaDependencies = {}) {
  return withTenantContext(
    createEvidencePresignUploadHandler(createEvidenceUploadPresigner(deps), {
      generateEvidenceId: deps.generateEvidenceId,
      max_size_bytes: deps.max_size_bytes,
    }),
  );
}

export const evidencePresignUploadHandler: ReturnType<
  typeof createEvidencePresignUploadLambdaHandler
> = (event) => createEvidencePresignUploadLambdaHandler()(event);
