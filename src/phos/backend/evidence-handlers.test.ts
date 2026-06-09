import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import {
  createEvidencePresignUploadHandler,
  createS3EvidenceUploadPresigner,
  type EvidenceUploadPresigner,
} from './evidence-handlers';
import { withTenantContext } from './lambda-handler';
import type { PhosHttpEvent } from './lambda-handler';
import { createInMemoryObservabilitySink } from './observability';
import type { EvidenceUploadIntentStore } from './evidence-upload-intent-store';

const baseBody = {
  idempotency_key: 'idem_evidence_1',
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

  it('returns the S3 object tagging header required by the presigned PUT', async () => {
    const presigner = createS3EvidenceUploadPresigner({
      client: new S3Client({
        region: 'ap-northeast-1',
        credentials: {
          accessKeyId: 'test-access-key',
          secretAccessKey: 'test-secret-key',
        },
      }),
      bucket: 'phos-evidence-prod',
      kms_key_arn:
        'arn:aws:kms:ap-northeast-1:123456789012:key/11111111-2222-3333-4444-555555555555',
      expires_in_seconds: 120,
    });

    const response = await presigner.presignPut({
      key: 'tenants/tenant_abc123/evidence/card_1/evidence_1.jpg',
      tenant_id: 'tenant_abc123',
      mime_type: 'image/jpeg',
      sha256: 'a'.repeat(64),
      size_bytes: 1024,
    });

    expect(response).toMatchObject({
      upload_url: expect.stringContaining('https://'),
      headers: {
        'Content-Type': 'image/jpeg',
        'x-amz-checksum-sha256': Buffer.from('a'.repeat(64), 'hex').toString('base64'),
        'x-amz-meta-sha256': 'a'.repeat(64),
        'x-amz-meta-size_bytes': '1024',
        'x-amz-server-side-encryption': 'aws:kms',
        'x-amz-server-side-encryption-aws-kms-key-id':
          'arn:aws:kms:ap-northeast-1:123456789012:key/11111111-2222-3333-4444-555555555555',
        'x-amz-tagging':
          'phos-object-class=evidence&phos-upload-status=PRESIGNED&phos-tenant-id=tenant_abc123',
      },
      expires_in_seconds: 120,
    });
  });

  it('builds a tenant-prefixed S3 key and presigns PUT without accepting client s3_key', async () => {
    const fakePresigner = presigner();
    const uploadIntentStore: EvidenceUploadIntentStore = {
      recordUploadIntent: vi.fn(async () => {}),
    };
    const handler = withTenantContext(
      createEvidencePresignUploadHandler(fakePresigner, {
        generateEvidenceId: () => 'evidence_1',
        max_size_bytes: 2048,
        upload_intent_store: uploadIntentStore,
        now: () => new Date('2026-06-09T07:30:00.000Z'),
      }),
    );

    const response = await handler(event());

    expect(response.statusCode).toBe(200);
    expect(fakePresigner.presignPut).toHaveBeenCalledWith({
      key: 'tenants/tenant_abc123/evidence/card_1/evidence_1.jpg',
      tenant_id: 'tenant_abc123',
      mime_type: 'image/jpeg',
      sha256: 'a'.repeat(64),
      size_bytes: 1024,
    });
    expect(uploadIntentStore.recordUploadIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant_abc123',
        user_id: 'user_001',
      }),
      {
        idempotency_key: 'idem_evidence_1',
        evidence_id: 'evidence_1',
        card_id: 'card_1',
        evidence_type: 'PHOTO',
        s3_key: 'tenants/tenant_abc123/evidence/card_1/evidence_1.jpg',
        mime_type: 'image/jpeg',
        sha256: 'a'.repeat(64),
        size_bytes: 1024,
        expires_in_seconds: 300,
        expires_at: '2026-06-09T07:35:00.000Z',
      },
    );
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

  it('trims upload metadata before building S3 keys and recording intents', async () => {
    const fakePresigner = presigner();
    const uploadIntentStore: EvidenceUploadIntentStore = {
      recordUploadIntent: vi.fn(async () => {}),
    };
    const handler = withTenantContext(
      createEvidencePresignUploadHandler(fakePresigner, {
        generateEvidenceId: () => 'evidence_1',
        upload_intent_store: uploadIntentStore,
      }),
    );

    const response = await handler(
      event({
        body: JSON.stringify({
          ...baseBody,
          card_id: ' card_1 ',
          evidence_type: ' PHOTO ',
          file_name: ' photo.JPG ',
          mime_type: ' image/jpeg ',
          sha256: ` ${'A'.repeat(64)} `,
        }),
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(fakePresigner.presignPut).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'tenants/tenant_abc123/evidence/card_1/evidence_1.jpg',
        mime_type: 'image/jpeg',
        sha256: 'a'.repeat(64),
      }),
    );
    expect(uploadIntentStore.recordUploadIntent).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        card_id: 'card_1',
        evidence_type: 'PHOTO',
        s3_key: 'tenants/tenant_abc123/evidence/card_1/evidence_1.jpg',
        mime_type: 'image/jpeg',
        sha256: 'a'.repeat(64),
      }),
    );
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

  it('rejects client supplied non-string s3_key before presigning', async () => {
    const fakePresigner = presigner();
    const handler = withTenantContext(createEvidencePresignUploadHandler(fakePresigner));

    const response = await handler(
      event({
        body: JSON.stringify({
          ...baseBody,
          s3_key: 123,
        }),
      }),
    );

    expect(response.statusCode).toBe(400);
    expect(fakePresigner.presignPut).not.toHaveBeenCalled();
    expect(JSON.parse(response.body)).toMatchObject({
      error_code: 'VALIDATION_ERROR',
      details: { reason: 'client supplied s3_key is forbidden' },
    });
  });

  it('rejects non-string upload identifiers before presigning', async () => {
    const fakePresigner = presigner();
    const handler = withTenantContext(createEvidencePresignUploadHandler(fakePresigner));

    const response = await handler(
      event({
        body: JSON.stringify({
          ...baseBody,
          card_id: 123,
        }),
      }),
    );

    expect(response.statusCode).toBe(400);
    expect(fakePresigner.presignPut).not.toHaveBeenCalled();
    expect(JSON.parse(response.body)).toMatchObject({
      error_code: 'VALIDATION_ERROR',
      details: { reason: 'card_id is required' },
    });
  });

  it('rejects non-number size_bytes before presigning', async () => {
    const fakePresigner = presigner();
    const handler = withTenantContext(createEvidencePresignUploadHandler(fakePresigner));

    const response = await handler(
      event({
        body: JSON.stringify({
          ...baseBody,
          size_bytes: '1024',
        }),
      }),
    );

    expect(response.statusCode).toBe(400);
    expect(fakePresigner.presignPut).not.toHaveBeenCalled();
    expect(JSON.parse(response.body)).toMatchObject({
      error_code: 'VALIDATION_ERROR',
      details: { reason: 'size_bytes must be a number' },
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
    const observability = createInMemoryObservabilitySink();
    const handler = withTenantContext(
      createEvidencePresignUploadHandler(fakePresigner, { max_size_bytes: 100 }),
      { observability },
    );

    const response = await handler(event());

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      error_code: 'VALIDATION_ERROR',
      details: { reason: 'size_bytes exceeds max upload size' },
    });
    expect(fakePresigner.presignPut).not.toHaveBeenCalled();
    expect(observability.metrics).toContainEqual(
      expect.objectContaining({
        name: 'EvidenceUploadFailedCount',
        route_key: 'POST /evidence/presign-upload',
        tenant_id: 'tenant_abc123',
        error_code: 'VALIDATION_ERROR',
      }),
    );
  });

  it('does not return a presign success response when upload intent persistence fails', async () => {
    const fakePresigner = presigner();
    const uploadIntentStore: EvidenceUploadIntentStore = {
      recordUploadIntent: vi.fn(async () => {
        throw new Error('dynamo unavailable');
      }),
    };
    const handler = withTenantContext(
      createEvidencePresignUploadHandler(fakePresigner, {
        generateEvidenceId: () => 'evidence_1',
        upload_intent_store: uploadIntentStore,
      }),
    );

    const response = await handler(event());

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({
      request_id: 'req_1',
      error_code: 'INTERNAL_ERROR',
      message_key: 'api.error.internal',
    });
  });

  it('requires evidence write scope', async () => {
    const fakePresigner = presigner();
    const observability = createInMemoryObservabilitySink();
    const handler = withTenantContext(createEvidencePresignUploadHandler(fakePresigner), {
      observability,
    });

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
    expect(observability.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'AuthorizationDeniedCount',
          error_code: 'FORBIDDEN',
        }),
        expect.objectContaining({
          name: 'EvidenceUploadFailedCount',
          error_code: 'FORBIDDEN',
        }),
      ]),
    );
    expect(observability.security_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: 'AUTHORIZATION_DENIED',
          error_code: 'FORBIDDEN',
        }),
        expect.objectContaining({
          event_type: 'EVIDENCE_UPLOAD_REJECTED',
          error_code: 'FORBIDDEN',
        }),
      ]),
    );
  });

  it('emits an upload failure metric when presigning throws', async () => {
    const fakePresigner: EvidenceUploadPresigner = {
      presignPut: vi.fn(async () => {
        throw new Error('s3 unavailable');
      }),
    };
    const observability = createInMemoryObservabilitySink();
    const handler = withTenantContext(createEvidencePresignUploadHandler(fakePresigner), {
      observability,
    });

    const response = await handler(event());

    expect(response.statusCode).toBe(500);
    expect(observability.metrics).toContainEqual(
      expect.objectContaining({
        name: 'EvidenceUploadFailedCount',
        route_key: 'POST /evidence/presign-upload',
        tenant_id: 'tenant_abc123',
        error_code: 'INTERNAL_ERROR',
      }),
    );
  });
});
