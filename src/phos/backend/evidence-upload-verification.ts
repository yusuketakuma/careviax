import {
  DeleteObjectCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
  PutObjectTaggingCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { EVIDENCE_TENANT_ID_TAG, evidenceObjectTagSet } from './evidence-object-tags';

export class EvidenceObjectVerificationError extends Error {
  readonly reason: string;
  readonly details: Record<string, unknown>;

  constructor(reason: string, details: Record<string, unknown> = {}) {
    super(reason);
    this.name = 'EvidenceObjectVerificationError';
    this.reason = reason;
    this.details = details;
  }
}

export type EvidenceObjectVerificationInput = {
  key: string;
  mime_type: string;
  sha256: string;
  size_bytes: number;
  kms_key_arn: string;
  allowed_key_prefix?: string;
  tenant_id: string;
  user_id?: string;
  request_id?: string;
  correlation_id?: string;
};

export type EvidenceObjectTaggingInput = {
  key: string;
  tenant_id: string;
  allowed_key_prefix?: string;
  version_id?: string;
};

export type EvidenceObjectVerificationResult = {
  version_id?: string;
};

export type EvidenceObjectVerifier = {
  verifyObject(
    input: EvidenceObjectVerificationInput,
  ): Promise<EvidenceObjectVerificationResult | void>;
  markObjectVerified?(input: EvidenceObjectTaggingInput): Promise<void>;
};

type EvidenceHeadObjectResult = {
  ChecksumSHA256?: string;
  ContentLength?: number;
  ContentType?: string;
  Metadata?: Record<string, string>;
  ServerSideEncryption?: string;
  SSEKMSKeyId?: string;
  VersionId?: string;
};

type EvidenceObjectTaggingResult = {
  TagSet?: { Key?: string; Value?: string }[];
};

type EvidenceCleanupFailure = {
  mismatch_reason: string;
  cleanup_error: string;
  tenant_id?: string;
  user_id?: string;
  request_id?: string;
  correlation_id?: string;
};

function normalizeContentType(value: string | undefined): string {
  return (value ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

function readMetadataSha256(metadata: Record<string, string> | undefined): string | undefined {
  return metadata?.sha256?.trim().toLowerCase();
}

function readMetadataSizeBytes(metadata: Record<string, string> | undefined): number | undefined {
  const value = metadata?.size_bytes?.trim();
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function sha256HexToBase64(hex: string): string {
  return Buffer.from(hex, 'hex').toString('base64');
}

function isMissingObjectError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { name?: unknown; $metadata?: { httpStatusCode?: number } };
  return (
    record.name === 'NotFound' ||
    record.name === 'NoSuchKey' ||
    record.$metadata?.httpStatusCode === 404
  );
}

function cleanupErrorName(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  return typeof error;
}

function cleanupContextFields(
  context: Pick<
    EvidenceObjectVerificationInput,
    'tenant_id' | 'user_id' | 'request_id' | 'correlation_id'
  >,
): Pick<EvidenceCleanupFailure, 'tenant_id' | 'user_id' | 'request_id' | 'correlation_id'> {
  return {
    ...(context.tenant_id ? { tenant_id: context.tenant_id } : {}),
    ...(context.user_id ? { user_id: context.user_id } : {}),
    ...(context.request_id ? { request_id: context.request_id } : {}),
    ...(context.correlation_id ? { correlation_id: context.correlation_id } : {}),
  };
}

function assertAllowedEvidenceKeyPrefix(expected: EvidenceObjectTaggingInput): void {
  if (!expected.allowed_key_prefix) return;
  if (expected.key.startsWith(expected.allowed_key_prefix)) return;
  throw new EvidenceObjectVerificationError('evidence_key_prefix_mismatch', {
    expected_prefix: expected.allowed_key_prefix,
  });
}

function findVerificationMismatch(
  result: EvidenceHeadObjectResult,
  expected: EvidenceObjectVerificationInput,
): EvidenceObjectVerificationError | undefined {
  const actualContentType = normalizeContentType(result.ContentType);
  const expectedContentType = normalizeContentType(expected.mime_type);
  if (actualContentType !== expectedContentType) {
    return new EvidenceObjectVerificationError('content_type_mismatch', {
      expected: expectedContentType,
      actual: actualContentType,
    });
  }

  if (result.ContentLength !== expected.size_bytes) {
    return new EvidenceObjectVerificationError('content_length_mismatch', {
      expected: expected.size_bytes,
      actual: result.ContentLength,
    });
  }

  const metadataSha256 = readMetadataSha256(result.Metadata);
  if (metadataSha256 !== expected.sha256.toLowerCase()) {
    return new EvidenceObjectVerificationError('sha256_mismatch', {
      expected: expected.sha256.toLowerCase(),
      actual: metadataSha256 ?? null,
    });
  }

  const expectedChecksum = sha256HexToBase64(expected.sha256);
  if (result.ChecksumSHA256 !== expectedChecksum) {
    return new EvidenceObjectVerificationError('checksum_sha256_mismatch', {
      expected: expectedChecksum,
      actual: result.ChecksumSHA256 ?? null,
    });
  }

  const metadataSizeBytes = readMetadataSizeBytes(result.Metadata);
  if (metadataSizeBytes !== expected.size_bytes) {
    return new EvidenceObjectVerificationError('metadata_size_mismatch', {
      expected: expected.size_bytes,
      actual: metadataSizeBytes ?? null,
    });
  }

  if (result.ServerSideEncryption !== 'aws:kms') {
    return new EvidenceObjectVerificationError('server_side_encryption_mismatch', {
      expected: 'aws:kms',
      actual: result.ServerSideEncryption ?? null,
    });
  }
  if (result.SSEKMSKeyId !== expected.kms_key_arn) {
    return new EvidenceObjectVerificationError('kms_key_mismatch', {
      expected: expected.kms_key_arn,
      actual: result.SSEKMSKeyId ?? null,
    });
  }

  return undefined;
}

function findTenantTagMismatch(
  result: EvidenceObjectTaggingResult,
  expected: EvidenceObjectVerificationInput,
): EvidenceObjectVerificationError | undefined {
  const tenantTag = result.TagSet?.find((tag) => tag.Key === EVIDENCE_TENANT_ID_TAG)?.Value;
  if (tenantTag !== expected.tenant_id) {
    return new EvidenceObjectVerificationError('tenant_tag_mismatch', {
      expected: expected.tenant_id,
      actual: tenantTag ?? null,
    });
  }
  return undefined;
}

async function cleanupMismatchedEvidenceObject(input: {
  client: Pick<S3Client, 'send'>;
  bucket: string;
  key: string;
  version_id?: string;
  mismatch: EvidenceObjectVerificationError;
  context: Pick<
    EvidenceObjectVerificationInput,
    'tenant_id' | 'user_id' | 'request_id' | 'correlation_id'
  >;
  on_cleanup_failure: (failure: EvidenceCleanupFailure) => void;
}): Promise<void> {
  try {
    await input.client.send(
      new DeleteObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        ...(input.version_id ? { VersionId: input.version_id } : {}),
      }),
    );
  } catch (error) {
    input.on_cleanup_failure({
      mismatch_reason: input.mismatch.reason,
      cleanup_error: cleanupErrorName(error),
      ...cleanupContextFields(input.context),
    });
  }
}

function reportCleanupFailure(
  handler: ((failure: EvidenceCleanupFailure) => void) | undefined,
  failure: EvidenceCleanupFailure,
): void {
  const reporter =
    handler ??
    ((event: EvidenceCleanupFailure) => {
      console.error(
        JSON.stringify({
          level: 'WARNING',
          message: 'phos_evidence_cleanup_failed',
          ...event,
          tenant_id: event.tenant_id ?? 'UNKNOWN',
          user_id: event.user_id ?? 'UNKNOWN',
          request_id: event.request_id ?? 'UNKNOWN',
          correlation_id: event.correlation_id ?? 'UNKNOWN',
        }),
      );
    });
  try {
    reporter(failure);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'WARNING',
        message: 'phos_evidence_cleanup_failure_report_failed',
        tenant_id: failure.tenant_id ?? 'UNKNOWN',
        user_id: failure.user_id ?? 'UNKNOWN',
        request_id: failure.request_id ?? 'UNKNOWN',
        correlation_id: failure.correlation_id ?? 'UNKNOWN',
        reporter_error: cleanupErrorName(error),
      }),
    );
  }
}

export function createS3EvidenceObjectVerifier(input: {
  client: Pick<S3Client, 'send'>;
  bucket: string;
  cleanup_mismatched_object?: boolean;
  on_cleanup_failure?: (failure: EvidenceCleanupFailure) => void;
}): EvidenceObjectVerifier {
  return {
    async verifyObject(expected) {
      assertAllowedEvidenceKeyPrefix(expected);
      let result: EvidenceHeadObjectResult;
      try {
        result = await input.client.send(
          new HeadObjectCommand({
            Bucket: input.bucket,
            Key: expected.key,
            ChecksumMode: 'ENABLED',
          }),
        );
      } catch (error) {
        if (isMissingObjectError(error)) {
          throw new EvidenceObjectVerificationError('object_missing', { key: expected.key });
        }
        throw error;
      }

      let mismatch = findVerificationMismatch(result, expected);
      if (!mismatch) {
        const tagResult = (await input.client.send(
          new GetObjectTaggingCommand({
            Bucket: input.bucket,
            Key: expected.key,
            ...(result.VersionId ? { VersionId: result.VersionId } : {}),
          }),
        )) as EvidenceObjectTaggingResult;
        mismatch = findTenantTagMismatch(tagResult, expected);
      }
      if (mismatch) {
        if (input.cleanup_mismatched_object !== false) {
          await cleanupMismatchedEvidenceObject({
            client: input.client,
            bucket: input.bucket,
            key: expected.key,
            version_id: result.VersionId,
            mismatch,
            context: {
              tenant_id: expected.tenant_id,
              user_id: expected.user_id,
              request_id: expected.request_id,
              correlation_id: expected.correlation_id,
            },
            on_cleanup_failure: (failure) =>
              reportCleanupFailure(input.on_cleanup_failure, failure),
          });
        }
        throw mismatch;
      }

      return result.VersionId ? { version_id: result.VersionId } : {};
    },

    async markObjectVerified(expected) {
      assertAllowedEvidenceKeyPrefix(expected);
      await input.client.send(
        new PutObjectTaggingCommand({
          Bucket: input.bucket,
          Key: expected.key,
          ...(expected.version_id ? { VersionId: expected.version_id } : {}),
          Tagging: {
            TagSet: evidenceObjectTagSet('VERIFIED', expected.tenant_id),
          },
        }),
      );
    },
  };
}
