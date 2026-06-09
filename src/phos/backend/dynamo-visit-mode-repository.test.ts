import { describe, expect, it, vi } from 'vitest';
import {
  UserRole,
  VisitStatus,
  VisitStep,
  type VisitModeView,
} from '@/phos/contracts/phos_contracts';
import { toDynamoAttributeValue } from './dynamodb-attribute-values';
import { createDynamoVisitModeRepository } from './dynamo-visit-mode-repository';
import type { DynamoVisitModeClient } from './dynamo-visit-mode-repository';
import type { TenantContext } from './tenant-context';
import { EvidenceObjectVerificationError } from './evidence-upload-verification';

const ctx: TenantContext = {
  tenant_id: 'tenant_abc123',
  user_id: 'user_1',
  role: UserRole.PHARMACIST,
  request_id: 'req_1',
  correlation_id: 'corr_1',
  scopes: ['phos/visit-mode.write'],
};

function visit(overrides: Partial<VisitModeView> = {}): VisitModeView {
  return {
    packet_id: 'packet_1',
    card_id: 'card_1',
    server_version: 3,
    patient_name: '患者 山田太郎',
    visit_status: VisitStatus.IN_PROGRESS,
    applicable_steps: [VisitStep.ARRIVAL_CONFIRM],
    required_steps: [VisitStep.ARRIVAL_CONFIRM],
    step_completed: Object.fromEntries(
      Object.values(VisitStep).map((step) => [step, false]),
    ) as Record<VisitStep, boolean>,
    last_opened_step: VisitStep.ARRIVAL_CONFIRM,
    evidence_sync: { blocking_unsynced_count: 0, non_blocking_unsynced_count: 0 },
    online: true,
    ...overrides,
  };
}

function evidenceIntent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    evidence_id: { S: 'evidence_1' },
    card_id: { S: 'card_1' },
    s3_key: { S: 'tenants/tenant_abc123/evidence/card_1/evidence_1.jpg' },
    mime_type: { S: 'image/jpeg' },
    sha256: { S: 'a'.repeat(64) },
    size_bytes: { N: '1024' },
    expires_at: { S: '2026-06-09T07:35:00.000Z' },
    upload_status: { S: 'PRESIGNED' },
    ...Object.fromEntries(
      Object.entries(overrides).map(([key, value]) => [key, toDynamoAttributeValue(value)]),
    ),
  };
}

function client(overrides: Partial<DynamoVisitModeClient> = {}): DynamoVisitModeClient {
  return {
    getVisitPacket: vi.fn(async () => ({ visit_mode: toDynamoAttributeValue(visit()) })),
    getIdempotency: vi.fn(async () => null),
    getEvidenceIntent: vi.fn(async () => evidenceIntent()),
    transactCommitVisitStep: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('createDynamoVisitModeRepository', () => {
  it('loads a tenant-scoped VisitModeView without scanning', async () => {
    const fakeClient = client();
    const store = createDynamoVisitModeRepository(fakeClient);

    await expect(store.loadVisitMode(ctx, 'packet_1')).resolves.toEqual(visit());

    expect(fakeClient.getVisitPacket).toHaveBeenCalledWith({
      table_name: 'phos_core',
      partition_key: 'TENANT#tenant_abc123',
      sort_key: 'VISIT_PACKET#packet_1',
    });
  });

  it('replays a matching idempotency record', async () => {
    const response = visit({ server_version: 4 });
    const fakeClient = client({
      getIdempotency: vi.fn(async () => ({
        request_fingerprint: { S: 'fingerprint_1' },
        response: { S: JSON.stringify(response) },
      })),
    });
    const store = createDynamoVisitModeRepository(fakeClient);

    await expect(
      store.getIdempotentVisitStep(
        ctx,
        'VISIT_STEP:packet_1:COMPLETE_CHECK',
        'idem_1',
        'fingerprint_1',
      ),
    ).resolves.toEqual({ status: 'MATCH', response });
  });

  it('commits visit packet and idempotency records in one transaction contract', async () => {
    const fakeClient = client();
    const store = createDynamoVisitModeRepository(fakeClient, {
      now: () => new Date('2026-06-09T00:00:00.000Z'),
    });
    const response = visit({ server_version: 4 });

    await expect(
      store.commitVisitStep(ctx, {
        packet_id: 'packet_1',
        step: VisitStep.COMPLETE_CHECK,
        mutation_key: 'VISIT_STEP:packet_1:COMPLETE_CHECK',
        command: { idempotency_key: 'idem_1', client_version: 3 },
        request_fingerprint: 'fingerprint_1',
        previous_visit: visit(),
        response,
      }),
    ).resolves.toEqual(response);

    expect(fakeClient.transactCommitVisitStep).toHaveBeenCalledWith(
      expect.objectContaining({
        table_name: 'phos_core',
        partition_key: 'TENANT#tenant_abc123',
        visit_packet_sort_key: 'VISIT_PACKET#packet_1',
        idempotency_sort_key: 'VISIT_STEP_IDEMPOTENCY#packet_1#COMPLETE_CHECK#idem_1',
        expected_server_version: 3,
        response,
      }),
    );
  });

  it('verifies an evidence upload intent through tenant Dynamo key and S3 metadata', async () => {
    const fakeClient = client();
    const verifier = {
      verifyObject: vi.fn(async () => undefined),
    };
    const store = createDynamoVisitModeRepository(fakeClient, {
      evidence_object_verifier: verifier,
      now: () => new Date('2026-06-09T07:30:00.000Z'),
    });

    await expect(
      store.verifyEvidenceUpload(ctx, {
        packet_id: 'packet_1',
        step: 'EVIDENCE_UPLOAD',
        visit: visit({ card_id: 'card_1' }),
        evidence_key: 'evidence_1',
      }),
    ).resolves.toEqual({
      evidence_id: 'evidence_1',
      card_id: 'card_1',
      s3_key: 'tenants/tenant_abc123/evidence/card_1/evidence_1.jpg',
    });

    expect(fakeClient.getEvidenceIntent).toHaveBeenCalledWith({
      table_name: 'phos_core',
      partition_key: 'TENANT#tenant_abc123',
      sort_key: 'EVIDENCE#evidence_1',
    });
    expect(verifier.verifyObject).toHaveBeenCalledWith({
      key: 'tenants/tenant_abc123/evidence/card_1/evidence_1.jpg',
      mime_type: 'image/jpeg',
      sha256: 'a'.repeat(64),
      size_bytes: 1024,
      allowed_key_prefix: 'tenants/tenant_abc123/evidence/',
    });
  });

  it('rejects evidence intents bound to another card before S3 verification', async () => {
    const fakeClient = client({ getEvidenceIntent: vi.fn(async () => evidenceIntent()) });
    const verifier = { verifyObject: vi.fn(async () => undefined) };
    const store = createDynamoVisitModeRepository(fakeClient, {
      evidence_object_verifier: verifier,
      now: () => new Date('2026-06-09T07:30:00.000Z'),
    });

    await expect(
      store.verifyEvidenceUpload(ctx, {
        packet_id: 'packet_1',
        step: 'EVIDENCE_UPLOAD',
        visit: visit({ card_id: 'card_other' }),
        evidence_key: 'evidence_1',
      }),
    ).rejects.toMatchObject({
      status: 422,
      error_code: 'ACTION_GUARD_FAILED',
      details: { reason: 'evidence_card_mismatch' },
    });
    expect(verifier.verifyObject).not.toHaveBeenCalled();
  });

  it('rejects missing S3 objects before completing evidence upload', async () => {
    const fakeClient = client();
    const store = createDynamoVisitModeRepository(fakeClient, {
      now: () => new Date('2026-06-09T07:30:00.000Z'),
      evidence_object_verifier: {
        verifyObject: vi.fn(async () => {
          throw new EvidenceObjectVerificationError('object_missing', {
            key: 'tenants/tenant_abc123/evidence/card_1/evidence_1.jpg',
          });
        }),
      },
    });

    await expect(
      store.verifyEvidenceUpload(ctx, {
        packet_id: 'packet_1',
        step: 'EVIDENCE_UPLOAD',
        visit: visit({ card_id: 'card_1' }),
        evidence_key: 'evidence_1',
      }),
    ).rejects.toMatchObject({
      status: 422,
      error_code: 'ACTION_GUARD_FAILED',
      details: { reason: 'object_missing' },
    });
  });

  it('rejects expired evidence upload intents before S3 verification', async () => {
    const fakeClient = client({
      getEvidenceIntent: vi.fn(async () =>
        evidenceIntent({ expires_at: '2026-06-09T07:29:59.000Z' }),
      ),
    });
    const verifier = { verifyObject: vi.fn(async () => undefined) };
    const store = createDynamoVisitModeRepository(fakeClient, {
      evidence_object_verifier: verifier,
      now: () => new Date('2026-06-09T07:30:00.000Z'),
    });

    await expect(
      store.verifyEvidenceUpload(ctx, {
        packet_id: 'packet_1',
        step: 'EVIDENCE_UPLOAD',
        visit: visit({ card_id: 'card_1' }),
        evidence_key: 'evidence_1',
      }),
    ).rejects.toMatchObject({
      status: 422,
      error_code: 'ACTION_GUARD_FAILED',
      details: { reason: 'evidence_upload_intent_expired' },
    });
    expect(verifier.verifyObject).not.toHaveBeenCalled();
  });

  it('includes verified evidence status update in the visit commit transaction', async () => {
    const fakeClient = client();
    const verifier = {
      verifyObject: vi.fn(async () => undefined),
      markObjectVerified: vi.fn(async () => undefined),
    };
    const store = createDynamoVisitModeRepository(fakeClient, {
      now: () => new Date('2026-06-09T00:00:00.000Z'),
      evidence_object_verifier: verifier,
    });
    const response = visit({ server_version: 4 });

    await store.commitVisitStep(ctx, {
      packet_id: 'packet_1',
      step: VisitStep.EVIDENCE_UPLOAD,
      mutation_key: 'VISIT_STEP:packet_1:EVIDENCE_UPLOAD',
      command: {
        idempotency_key: 'idem_1',
        client_version: 3,
        payload: { evidence_key: 'evidence_1' },
      },
      request_fingerprint: 'fingerprint_1',
      previous_visit: visit(),
      response,
      verified_evidence: {
        evidence_id: 'evidence_1',
        card_id: 'card_1',
        s3_key: 'tenants/tenant_abc123/evidence/card_1/evidence_1.jpg',
      },
    });

    expect(fakeClient.transactCommitVisitStep).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence_sort_key: 'EVIDENCE#evidence_1',
        verified_evidence: {
          evidence_id: 'evidence_1',
          card_id: 'card_1',
          s3_key: 'tenants/tenant_abc123/evidence/card_1/evidence_1.jpg',
        },
      }),
    );
    expect(verifier.markObjectVerified).toHaveBeenCalledWith({
      key: 'tenants/tenant_abc123/evidence/card_1/evidence_1.jpg',
      allowed_key_prefix: 'tenants/tenant_abc123/evidence/',
    });
  });

  it('marks already committed evidence objects verified during idempotency replay', async () => {
    const fakeClient = client({
      getEvidenceIntent: vi.fn(async () => evidenceIntent({ upload_status: 'VERIFIED' })),
    });
    const verifier = {
      verifyObject: vi.fn(async () => undefined),
      markObjectVerified: vi.fn(async () => undefined),
    };
    const store = createDynamoVisitModeRepository(fakeClient, {
      evidence_object_verifier: verifier,
    });

    await expect(store.markVerifiedEvidenceUpload?.(ctx, ' evidence_1 ')).resolves.toBeUndefined();

    expect(fakeClient.getEvidenceIntent).toHaveBeenCalledWith({
      table_name: 'phos_core',
      partition_key: 'TENANT#tenant_abc123',
      sort_key: 'EVIDENCE#evidence_1',
    });
    expect(verifier.markObjectVerified).toHaveBeenCalledWith({
      key: 'tenants/tenant_abc123/evidence/card_1/evidence_1.jpg',
      allowed_key_prefix: 'tenants/tenant_abc123/evidence/',
    });
  });
});
