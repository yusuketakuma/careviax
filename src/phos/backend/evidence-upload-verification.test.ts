import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectTaggingCommand,
} from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createS3EvidenceObjectVerifier } from './evidence-upload-verification';

const expected = {
  key: 'tenants/tenant_abc123/evidence/card_1/evidence_1.jpg',
  mime_type: 'image/jpeg',
  sha256: 'a'.repeat(64),
  size_bytes: 1024,
};
const kms_key_arn =
  'arn:aws:kms:ap-northeast-1:123456789012:key/11111111-2222-3333-4444-555555555555';
const expectedChecksum = Buffer.from(expected.sha256, 'hex').toString('base64');

describe('S3 evidence object verifier', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects objects that are not encrypted with the configured evidence KMS key', async () => {
    const send = vi.fn(async (command: HeadObjectCommand | DeleteObjectCommand) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ChecksumSHA256: expectedChecksum,
          ContentLength: 1024,
          ContentType: 'image/jpeg',
          Metadata: {
            sha256: 'a'.repeat(64),
            size_bytes: '1024',
          },
          ServerSideEncryption: 'AES256',
        };
      }
      return {};
    });
    const verifier = createS3EvidenceObjectVerifier({
      client: { send },
      bucket: 'phos-evidence-prod',
    });

    await expect(verifier.verifyObject({ ...expected, kms_key_arn })).rejects.toMatchObject({
      reason: 'server_side_encryption_mismatch',
    });
  });

  it('rejects objects encrypted with a different KMS key', async () => {
    const send = vi.fn(async (command: HeadObjectCommand | DeleteObjectCommand) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ChecksumSHA256: expectedChecksum,
          ContentLength: 1024,
          ContentType: 'image/jpeg',
          Metadata: {
            sha256: 'a'.repeat(64),
            size_bytes: '1024',
          },
          ServerSideEncryption: 'aws:kms',
          SSEKMSKeyId: `${kms_key_arn}-old`,
        };
      }
      return {};
    });
    const verifier = createS3EvidenceObjectVerifier({
      client: { send },
      bucket: 'phos-evidence-prod',
    });

    await expect(verifier.verifyObject({ ...expected, kms_key_arn })).rejects.toMatchObject({
      reason: 'kms_key_mismatch',
    });
  });

  it('heads the generated S3 key and accepts matching metadata', async () => {
    const send = vi.fn(async (command: HeadObjectCommand) => {
      expect(command).toBeInstanceOf(HeadObjectCommand);
      return {
        ChecksumSHA256: expectedChecksum,
        ContentLength: 1024,
        ContentType: 'image/jpeg',
          Metadata: {
            sha256: 'a'.repeat(64),
            size_bytes: '1024',
          },
          ServerSideEncryption: 'aws:kms',
          SSEKMSKeyId: kms_key_arn,
        };
    });
    const verifier = createS3EvidenceObjectVerifier({
      client: { send },
      bucket: 'phos-evidence-prod',
    });

    await expect(verifier.verifyObject({ ...expected, kms_key_arn })).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledOnce();
    expect((send.mock.calls[0]?.[0] as HeadObjectCommand).input).toMatchObject({
      Bucket: 'phos-evidence-prod',
      Key: expected.key,
      ChecksumMode: 'ENABLED',
    });
  });

  it('rejects missing S3 objects with a stable reason', async () => {
    const send = vi.fn(async () => {
      const error = new Error('missing') as Error & { name: string; $metadata: object };
      error.name = 'NotFound';
      error.$metadata = { httpStatusCode: 404 };
      throw error;
    });
    const verifier = createS3EvidenceObjectVerifier({
      client: { send },
      bucket: 'phos-evidence-prod',
    });

    await expect(verifier.verifyObject({ ...expected, kms_key_arn })).rejects.toMatchObject({
      reason: 'object_missing',
      details: { key: expected.key },
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it('deletes mismatched uploaded objects before rejecting them', async () => {
    const send = vi.fn(async (command: HeadObjectCommand | DeleteObjectCommand) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ChecksumSHA256: Buffer.from('b'.repeat(64), 'hex').toString('base64'),
          ContentLength: 2048,
          ContentType: 'image/png',
          Metadata: {
            sha256: 'b'.repeat(64),
            size_bytes: '2048',
          },
          VersionId: '3HL4kqtJlcpXroDTDmjVBH40Nrjfkd',
        };
      }
      expect(command).toBeInstanceOf(DeleteObjectCommand);
      return {};
    });
    const verifier = createS3EvidenceObjectVerifier({
      client: { send },
      bucket: 'phos-evidence-prod',
    });

    await expect(verifier.verifyObject({ ...expected, kms_key_arn })).rejects.toMatchObject({
      reason: 'content_type_mismatch',
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(DeleteObjectCommand);
    expect((send.mock.calls[1]?.[0] as DeleteObjectCommand).input).toMatchObject({
      Bucket: 'phos-evidence-prod',
      Key: expected.key,
      VersionId: '3HL4kqtJlcpXroDTDmjVBH40Nrjfkd',
    });
  });

  it('rejects keys outside the allowed tenant evidence prefix before S3 calls', async () => {
    const send = vi.fn(async () => ({}));
    const verifier = createS3EvidenceObjectVerifier({
      client: { send },
      bucket: 'phos-evidence-prod',
    });

    await expect(
      verifier.verifyObject({
        ...expected,
        kms_key_arn,
        key: 'tenants/tenant_abc123/reports/report_1.pdf',
        allowed_key_prefix: 'tenants/tenant_abc123/evidence/',
      }),
    ).rejects.toMatchObject({
      reason: 'evidence_key_prefix_mismatch',
      details: {
        expected_prefix: 'tenants/tenant_abc123/evidence/',
      },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('marks verified evidence objects with a retained S3 tag', async () => {
    const send = vi.fn(async (command: PutObjectTaggingCommand) => {
      expect(command).toBeInstanceOf(PutObjectTaggingCommand);
      return {};
    });
    const verifier = createS3EvidenceObjectVerifier({
      client: { send },
      bucket: 'phos-evidence-prod',
    });

    await expect(
      verifier.markObjectVerified?.({
        key: expected.key,
        allowed_key_prefix: 'tenants/tenant_abc123/evidence/',
      }),
    ).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledOnce();
    expect((send.mock.calls[0]?.[0] as PutObjectTaggingCommand).input).toMatchObject({
      Bucket: 'phos-evidence-prod',
      Key: expected.key,
      Tagging: {
        TagSet: [
          { Key: 'phos-object-class', Value: 'evidence' },
          { Key: 'phos-upload-status', Value: 'VERIFIED' },
        ],
      },
    });
  });

  it('rejects verified tag updates outside the allowed tenant evidence prefix before S3 calls', async () => {
    const send = vi.fn(async () => ({}));
    const verifier = createS3EvidenceObjectVerifier({
      client: { send },
      bucket: 'phos-evidence-prod',
    });

    await expect(
      verifier.markObjectVerified?.({
        key: 'tenants/tenant_abc123/reports/report_1.pdf',
        allowed_key_prefix: 'tenants/tenant_abc123/evidence/',
      }),
    ).rejects.toMatchObject({
      reason: 'evidence_key_prefix_mismatch',
      details: {
        expected_prefix: 'tenants/tenant_abc123/evidence/',
      },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects objects whose S3 checksum does not match the claimed sha256', async () => {
    const verifier = createS3EvidenceObjectVerifier({
      client: {
        send: vi.fn(async () => ({
          ChecksumSHA256: Buffer.from('b'.repeat(64), 'hex').toString('base64'),
          ContentLength: 1024,
          ContentType: 'image/jpeg',
          Metadata: {
            sha256: 'a'.repeat(64),
            size_bytes: '1024',
          },
        })),
      },
      bucket: 'phos-evidence-prod',
    });

    await expect(verifier.verifyObject({ ...expected, kms_key_arn })).rejects.toMatchObject({
      reason: 'checksum_sha256_mismatch',
    });
  });

  it('preserves mismatch reason and reports a non-PHI warning when cleanup fails', async () => {
    const send = vi.fn(async (command: HeadObjectCommand | DeleteObjectCommand) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ChecksumSHA256: expectedChecksum,
          ContentLength: 2048,
          ContentType: 'image/jpeg',
          Metadata: {
            sha256: 'a'.repeat(64),
            size_bytes: '2048',
          },
        };
      }
      const error = new Error('denied');
      error.name = 'AccessDenied';
      throw error;
    });
    const onCleanupFailure = vi.fn();
    const verifier = createS3EvidenceObjectVerifier({
      client: { send },
      bucket: 'phos-evidence-prod',
      on_cleanup_failure: onCleanupFailure,
    });

    await expect(verifier.verifyObject({ ...expected, kms_key_arn })).rejects.toMatchObject({
      reason: 'content_length_mismatch',
    });
    expect(onCleanupFailure).toHaveBeenCalledWith({
      mismatch_reason: 'content_length_mismatch',
      cleanup_error: 'AccessDenied',
    });
  });

  it('logs default cleanup failures with tenant, user, request, and correlation fields', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const send = vi.fn(async (command: HeadObjectCommand | DeleteObjectCommand) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ChecksumSHA256: expectedChecksum,
          ContentLength: 2048,
          ContentType: 'image/jpeg',
          Metadata: {
            sha256: 'a'.repeat(64),
            size_bytes: '2048',
          },
        };
      }
      const error = new Error('denied');
      error.name = 'AccessDenied';
      throw error;
    });
    const verifier = createS3EvidenceObjectVerifier({
      client: { send },
      bucket: 'phos-evidence-prod',
    });

    await expect(
      verifier.verifyObject({
        ...expected,
        kms_key_arn,
        tenant_id: 'tenant_abc123',
        user_id: 'user_1',
        request_id: 'req_1',
        correlation_id: 'corr_1',
      }),
    ).rejects.toMatchObject({
      reason: 'content_length_mismatch',
    });

    expect(JSON.parse(String(errorSpy.mock.calls[0]?.[0]))).toMatchObject({
      level: 'WARNING',
      message: 'phos_evidence_cleanup_failed',
      tenant_id: 'tenant_abc123',
      user_id: 'user_1',
      request_id: 'req_1',
      correlation_id: 'corr_1',
      mismatch_reason: 'content_length_mismatch',
      cleanup_error: 'AccessDenied',
    });
  });
});
