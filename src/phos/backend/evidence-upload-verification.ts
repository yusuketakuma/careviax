import { HeadObjectCommand, type S3Client } from '@aws-sdk/client-s3';

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
};

export type EvidenceObjectVerifier = {
  verifyObject(input: EvidenceObjectVerificationInput): Promise<void>;
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

export function createS3EvidenceObjectVerifier(input: {
  client: Pick<S3Client, 'send'>;
  bucket: string;
}): EvidenceObjectVerifier {
  return {
    async verifyObject(expected) {
      let result: {
        ChecksumSHA256?: string;
        ContentLength?: number;
        ContentType?: string;
        Metadata?: Record<string, string>;
      };
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

      const actualContentType = normalizeContentType(result.ContentType);
      const expectedContentType = normalizeContentType(expected.mime_type);
      if (actualContentType !== expectedContentType) {
        throw new EvidenceObjectVerificationError('content_type_mismatch', {
          expected: expectedContentType,
          actual: actualContentType,
        });
      }

      if (result.ContentLength !== expected.size_bytes) {
        throw new EvidenceObjectVerificationError('content_length_mismatch', {
          expected: expected.size_bytes,
          actual: result.ContentLength,
        });
      }

      const metadataSha256 = readMetadataSha256(result.Metadata);
      if (metadataSha256 !== expected.sha256.toLowerCase()) {
        throw new EvidenceObjectVerificationError('sha256_mismatch', {
          expected: expected.sha256.toLowerCase(),
          actual: metadataSha256 ?? null,
        });
      }

      const expectedChecksum = sha256HexToBase64(expected.sha256);
      if (result.ChecksumSHA256 !== expectedChecksum) {
        throw new EvidenceObjectVerificationError('checksum_sha256_mismatch', {
          expected: expectedChecksum,
          actual: result.ChecksumSHA256 ?? null,
        });
      }

      const metadataSizeBytes = readMetadataSizeBytes(result.Metadata);
      if (metadataSizeBytes !== expected.size_bytes) {
        throw new EvidenceObjectVerificationError('metadata_size_mismatch', {
          expected: expected.size_bytes,
          actual: metadataSizeBytes ?? null,
        });
      }
    },
  };
}
