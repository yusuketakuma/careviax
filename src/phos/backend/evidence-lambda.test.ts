import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EvidenceUploadPresigner } from './evidence-handlers';
import {
  createEvidencePresignUploadLambdaHandler,
  createEvidenceUploadPresigner,
} from './evidence-lambda';
import type { PhosHttpEvent } from './lambda-handler';

const body = {
  card_id: 'card_1',
  evidence_type: 'PHOTO',
  file_name: 'photo.jpg',
  mime_type: 'image/jpeg',
  sha256: 'a'.repeat(64),
  size_bytes: 1024,
};

function event(overrides: Partial<PhosHttpEvent> = {}): PhosHttpEvent {
  return {
    routeKey: 'POST /evidence/presign-upload',
    requestContext: {
      requestId: 'req_1',
      authorizer: {
        jwt: {
          claims: {
            token_use: 'access',
            tenant_id: 'tenant_abc123',
            sub: 'user_001',
            role: 'PHARMACIST',
            scope: 'phos/evidence.write',
          },
        },
      },
    },
    body: JSON.stringify(body),
    ...overrides,
  };
}

function presigner(): EvidenceUploadPresigner {
  return {
    presignPut: vi.fn(async () => ({
      upload_url: 'https://s3.example/upload',
      headers: { 'Content-Type': 'image/jpeg' },
      expires_in_seconds: 300,
    })),
  };
}

describe('PH-OS evidence Lambda composition', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('wires POST /evidence/presign-upload through tenant context into the presigner', async () => {
    const fakePresigner = presigner();
    const handler = createEvidencePresignUploadLambdaHandler({
      presigner: fakePresigner,
      generateEvidenceId: () => 'evidence_1',
    });

    const response = await handler(event());

    expect(response.statusCode).toBe(200);
    expect(fakePresigner.presignPut).toHaveBeenCalledWith({
      key: 'tenants/tenant_abc123/evidence/card_1/evidence_1.jpg',
      mime_type: 'image/jpeg',
      sha256: 'a'.repeat(64),
      size_bytes: 1024,
    });
  });

  it('fails closed when the production bucket configuration is missing', () => {
    const previous = process.env.PHOS_EVIDENCE_BUCKET;
    delete process.env.PHOS_EVIDENCE_BUCKET;

    try {
      expect(() => createEvidenceUploadPresigner()).toThrow(
        'PH-OS evidence S3 bucket is not configured',
      );
    } finally {
      if (previous === undefined) {
        delete process.env.PHOS_EVIDENCE_BUCKET;
      } else {
        process.env.PHOS_EVIDENCE_BUCKET = previous;
      }
    }
  });
});
