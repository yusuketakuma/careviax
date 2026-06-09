import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import {
  createS3EvidenceObjectVerifier,
  EvidenceObjectVerificationError,
} from './evidence-upload-verification';

const expected = {
  key: 'tenants/tenant_abc123/evidence/card_1/evidence_1.jpg',
  mime_type: 'image/jpeg',
  sha256: 'a'.repeat(64),
  size_bytes: 1024,
};
const expectedChecksum = Buffer.from(expected.sha256, 'hex').toString('base64');

describe('S3 evidence object verifier', () => {
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
      };
    });
    const verifier = createS3EvidenceObjectVerifier({
      client: { send },
      bucket: 'phos-evidence-prod',
    });

    await expect(verifier.verifyObject(expected)).resolves.toBeUndefined();
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

    await expect(verifier.verifyObject(expected)).rejects.toMatchObject({
      reason: 'object_missing',
      details: { key: expected.key },
    });
  });

  it('rejects size, mime, and sha256 metadata mismatches', async () => {
    const verifier = createS3EvidenceObjectVerifier({
      client: {
        send: vi.fn(async () => ({
          ChecksumSHA256: Buffer.from('b'.repeat(64), 'hex').toString('base64'),
          ContentLength: 2048,
          ContentType: 'image/png',
          Metadata: {
            sha256: 'b'.repeat(64),
            size_bytes: '2048',
          },
        })),
      },
      bucket: 'phos-evidence-prod',
    });

    await expect(verifier.verifyObject(expected)).rejects.toBeInstanceOf(
      EvidenceObjectVerificationError,
    );
    await expect(verifier.verifyObject(expected)).rejects.toMatchObject({
      reason: 'content_type_mismatch',
    });
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

    await expect(verifier.verifyObject(expected)).rejects.toMatchObject({
      reason: 'checksum_sha256_mismatch',
    });
  });
});
