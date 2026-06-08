import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEvidencePresignUploadHandler,
  type EvidenceUploadPresigner,
} from './evidence-handlers';
import { withTenantContext } from './lambda-handler';
import type { PhosHttpEvent } from './lambda-handler';

const baseBody = {
  card_id: 'card_1',
  evidence_type: 'PHOTO',
  file_name: 'photo.JPG',
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
    body: JSON.stringify(baseBody),
    ...overrides,
  };
}

function presigner(): EvidenceUploadPresigner {
  return {
    presignPut: vi.fn(async () => ({
      upload_url: 'https://s3.example/upload',
      headers: {
        'Content-Type': 'image/jpeg',
        'x-amz-meta-sha256': 'a'.repeat(64),
      },
      expires_in_seconds: 300,
    })),
  };
}

describe('PH-OS evidence presign upload handler', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a tenant-prefixed S3 key and presigns PUT without accepting client s3_key', async () => {
    const fakePresigner = presigner();
    const handler = withTenantContext(
      createEvidencePresignUploadHandler(fakePresigner, {
        generateEvidenceId: () => 'evidence_1',
        max_size_bytes: 2048,
      }),
    );

    const response = await handler(event());

    expect(response.statusCode).toBe(200);
    expect(fakePresigner.presignPut).toHaveBeenCalledWith({
      key: 'tenants/tenant_abc123/evidence/card_1/evidence_1.jpg',
      mime_type: 'image/jpeg',
      sha256: 'a'.repeat(64),
      size_bytes: 1024,
    });
    expect(JSON.parse(response.body)).toEqual({
      request_id: 'req_1',
      evidence_id: 'evidence_1',
      s3_key: 'tenants/tenant_abc123/evidence/card_1/evidence_1.jpg',
      upload_url: 'https://s3.example/upload',
      method: 'PUT',
      headers: {
        'Content-Type': 'image/jpeg',
        'x-amz-meta-sha256': 'a'.repeat(64),
      },
      expires_in_seconds: 300,
      max_size_bytes: 2048,
    });
  });

  it('rejects client supplied s3_key before presigning', async () => {
    const fakePresigner = presigner();
    const handler = withTenantContext(createEvidencePresignUploadHandler(fakePresigner));

    const response = await handler(
      event({
        body: JSON.stringify({
          ...baseBody,
          s3_key: 'tenants/other/evidence/card_1/evidence_1.jpg',
        }),
      }),
    );

    expect(response.statusCode).toBe(400);
    expect(fakePresigner.presignPut).not.toHaveBeenCalled();
    expect(JSON.parse(response.body)).toMatchObject({
      request_id: 'req_1',
      error_code: 'VALIDATION_ERROR',
      details: { reason: 'client supplied s3_key is forbidden' },
    });
  });

  it('rejects unsafe card ids and invalid upload metadata', async () => {
    const fakePresigner = presigner();
    const handler = withTenantContext(createEvidencePresignUploadHandler(fakePresigner));

    const response = await handler(
      event({
        body: JSON.stringify({
          ...baseBody,
          card_id: '../card_1',
          mime_type: 'not-a-mime',
        }),
      }),
    );

    expect(response.statusCode).toBe(400);
    expect(fakePresigner.presignPut).not.toHaveBeenCalled();
  });

  it('rejects oversized uploads before presigning', async () => {
    const fakePresigner = presigner();
    const handler = withTenantContext(
      createEvidencePresignUploadHandler(fakePresigner, { max_size_bytes: 100 }),
    );

    const response = await handler(event());

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      error_code: 'VALIDATION_ERROR',
      details: { reason: 'size_bytes exceeds max upload size' },
    });
    expect(fakePresigner.presignPut).not.toHaveBeenCalled();
  });

  it('requires evidence write scope', async () => {
    const fakePresigner = presigner();
    const handler = withTenantContext(createEvidencePresignUploadHandler(fakePresigner));

    const response = await handler(
      event({
        requestContext: {
          requestId: 'req_1',
          authorizer: {
            jwt: {
              claims: {
                token_use: 'access',
                tenant_id: 'tenant_abc123',
                sub: 'user_001',
                role: 'PHARMACIST',
                scope: 'phos/cards.read',
              },
            },
          },
        },
      }),
    );

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toMatchObject({
      error_code: 'FORBIDDEN',
      details: { missing_scopes: ['phos/evidence.write'] },
    });
    expect(fakePresigner.presignPut).not.toHaveBeenCalled();
  });
});
