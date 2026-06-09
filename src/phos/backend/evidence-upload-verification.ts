import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectTaggingCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { evidenceObjectTagSet } from './evidence-object-tags';

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
  allowed_key_prefix?: string;
};

export type EvidenceObjectTaggingInput = {
  key: string;
  allowed_key_prefix?: string;
};

export type EvidenceObjectVerifier = {
  verifyObject(input: EvidenceObjectVerificationInput): Promise<void>;
  markObjectVerified?(input: EvidenceObjectTaggingInput): Promise<void>;
};

type EvidenceHeadObjectResult = {
  ChecksumSHA256?: string;
  ContentLength?: number;
  ContentType?: string;
  Metadata?: Record<string, string>;
};

type EvidenceCleanupFailure = {
  mismatch_reason: string;
  cleanup_error: string;
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

  return undefined;
}

async function cleanupMismatchedEvidenceObject(input: {
  client: Pick<S3Client, 'send'>;
  bucket: string;
  key: string;
  mismatch: EvidenceObjectVerificationError;
  on_cleanup_failure: (failure: EvidenceCleanupFailure) => void;
}): Promise<void> {
  try {
    await input.client.send(
      new DeleteObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
      }),
    );
  } catch (error) {
    input.on_cleanup_failure({
      mismatch_reason: input.mismatch.reason,
      cleanup_error: cleanupErrorName(error),
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

      const mismatch = findVerificationMismatch(result, expected);
      if (mismatch) {
        if (input.cleanup_mismatched_object !== false) {
          await cleanupMismatchedEvidenceObject({
            client: input.client,
            bucket: input.bucket,
            key: expected.key,
            mismatch,
            on_cleanup_failure: (failure) =>
              reportCleanupFailure(input.on_cleanup_failure, failure),
          });
        }
        throw mismatch;
      }
    },

    async markObjectVerified(expected) {
      assertAllowedEvidenceKeyPrefix(expected);
      await input.client.send(
        new PutObjectTaggingCommand({
          Bucket: input.bucket,
          Key: expected.key,
          Tagging: {
            TagSet: evidenceObjectTagSet('VERIFIED'),
          },
        }),
      );
    },
  };
}
