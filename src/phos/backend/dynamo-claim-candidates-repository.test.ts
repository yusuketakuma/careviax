import { describe, expect, it, vi } from 'vitest';
import {
  UserRole,
  type ClaimCandidateMutationResponse,
  type ClaimCandidateView,
} from '@/phos/contracts/phos_contracts';
import { toDynamoAttributeValue } from './dynamodb-attribute-values';
import { createDynamoClaimCandidatesRepository } from './dynamo-claim-candidates-repository';
import type { DynamoClaimCandidatesClient } from './dynamo-claim-candidates-repository';
import { PhosDomainError } from './cards-repository';
import type { TenantContext } from './tenant-context';

const ctx: TenantContext = {
  tenant_id: 'tenant_abc123',
  user_id: 'user_1',
  role: UserRole.PHARMACIST,
  request_id: 'req_1',
  correlation_id: 'corr_1',
  scopes: ['phos/claim-candidates.read'],
};

function candidate(overrides: Partial<ClaimCandidateView> = {}): ClaimCandidateView {
  return {
    candidate_id: 'claim_1',
    card_id: 'card_1',
    patient_name: '患者 山田太郎',
    fee_code: 'M001',
    fee_label: '在宅患者訪問薬剤管理指導料',
    billing_month: '2026-06-01',
    status: 'MISSING_EVIDENCE',
    status_label: '根拠不足',
    missing_evidence_keys: ['management_plan'],
    evidence_requirements: [],
    rule_version_id: 'rv_2026',
    priority_rank: 10,
    source_refs: [],
    created_at: '2026-06-09T00:00:00.000Z',
    updated_at: '2026-06-09T00:00:00.000Z',
    server_version: 1,
    ...overrides,
  };
}

function client(overrides: Partial<DynamoClaimCandidatesClient> = {}): DynamoClaimCandidatesClient {
  return {
    getIdempotency: vi.fn(async () => null),
    queryClaimCandidates: vi.fn(async () => ({
      items: [{ claim_candidate: toDynamoAttributeValue(candidate()) }],
    })),
    excludeClaimCandidate: vi.fn(
      async (): Promise<ClaimCandidateMutationResponse> => ({
        candidate: candidate({ status: 'EXCLUDED', status_label: '除外済み', server_version: 2 }),
        side_effects: [{ type: 'CLAIM_RECALCULATED', card_id: 'card_1' }],
        server_version: 2,
      }),
    ),
    ...overrides,
  };
}

describe('createDynamoClaimCandidatesRepository', () => {
  it('queries claim candidates through a tenant-scoped status GSI without scanning', async () => {
    const fakeClient = client();
    const repository = createDynamoClaimCandidatesRepository(fakeClient, {
      now: () => new Date('2026-06-09T01:00:00.000Z'),
    });

    await expect(
      repository.searchClaimCandidates(ctx, { status: 'MISSING_EVIDENCE', limit: 25 }),
    ).resolves.toMatchObject({
      items: [{ candidate_id: 'claim_1' }],
      server_time: '2026-06-09T01:00:00.000Z',
    });

    expect(fakeClient.queryClaimCandidates).toHaveBeenCalledWith({
      table_name: 'phos_core',
      index_name: 'GSI1',
      partition_key: 'TENANT#tenant_abc123#CLAIM_CANDIDATE_STATUS#MISSING_EVIDENCE',
      limit: 25,
      cursor: undefined,
    });
  });

  it('uses a tenant-scoped card GSI for card-specific claim history', async () => {
    const fakeClient = client();
    const repository = createDynamoClaimCandidatesRepository(fakeClient);

    await repository.searchClaimCandidates(ctx, { card_id: 'card_1', limit: 10 });

    expect(fakeClient.queryClaimCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        index_name: 'GSI2',
        partition_key: 'TENANT#tenant_abc123#CLAIM_CANDIDATE_CARD#card_1',
      }),
    );
  });

  it('commits excludes with idempotency metadata and client version', async () => {
    const fakeClient = client();
    const repository = createDynamoClaimCandidatesRepository(fakeClient, {
      now: () => new Date('2026-06-09T01:00:00.000Z'),
    });

    await repository.excludeClaimCandidate(ctx, 'claim_1', {
      reason_code: 'NOT_ELIGIBLE',
      idempotency_key: 'idem_1',
      client_version: 1,
    });

    expect(fakeClient.excludeClaimCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        table_name: 'phos_core',
        partition_key: 'TENANT#tenant_abc123',
        sort_key: 'CLAIM_CANDIDATE#claim_1',
        idempotency_sort_key: 'CLAIM_CANDIDATE_IDEMPOTENCY#exclude#claim_1#idem_1',
        client_version: 1,
        reason_code: 'NOT_ELIGIBLE',
      }),
    );
  });

  it('replays matching exclude idempotency responses without loading the candidate', async () => {
    const replayed: ClaimCandidateMutationResponse = {
      candidate: candidate({ status: 'EXCLUDED', status_label: '除外済み', server_version: 2 }),
      side_effects: [{ type: 'CLAIM_RECALCULATED', card_id: 'card_1' }],
      server_version: 2,
    };
    const fakeClient = client({
      getIdempotency: vi.fn(async () => ({
        request_fingerprint: toDynamoAttributeValue(
          JSON.stringify({
            client_version: 1,
            reason_code: 'NOT_ELIGIBLE',
            reason_note: null,
          }),
        ),
        response_json: toDynamoAttributeValue(JSON.stringify(replayed)),
      })),
    });
    const repository = createDynamoClaimCandidatesRepository(fakeClient);

    await expect(
      repository.excludeClaimCandidate(ctx, 'claim_1', {
        reason_code: 'NOT_ELIGIBLE',
        idempotency_key: 'idem_1',
        client_version: 1,
      }),
    ).resolves.toEqual(replayed);

    expect(fakeClient.getIdempotency).toHaveBeenCalledWith({
      table_name: 'phos_core',
      partition_key: 'TENANT#tenant_abc123',
      sort_key: 'CLAIM_CANDIDATE_IDEMPOTENCY#exclude#claim_1#idem_1',
    });
    expect(fakeClient.excludeClaimCandidate).not.toHaveBeenCalled();
  });

  it('replays matching exclude idempotency responses after concurrent commit races', async () => {
    const replayed: ClaimCandidateMutationResponse = {
      candidate: candidate({ status: 'EXCLUDED', status_label: '除外済み', server_version: 2 }),
      side_effects: [{ type: 'CLAIM_RECALCULATED', card_id: 'card_1' }],
      server_version: 2,
    };
    const fakeClient = client({
      getIdempotency: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          request_fingerprint: toDynamoAttributeValue(
            JSON.stringify({
              client_version: 1,
              reason_code: 'NOT_ELIGIBLE',
              reason_note: null,
            }),
          ),
          response_json: toDynamoAttributeValue(JSON.stringify(replayed)),
        }),
      excludeClaimCandidate: vi.fn(async () => {
        throw new PhosDomainError({
          status: 409,
          error_code: 'STALE_VERSION',
          message_key: 'api.error.stale_version',
        });
      }),
    });
    const repository = createDynamoClaimCandidatesRepository(fakeClient);

    await expect(
      repository.excludeClaimCandidate(ctx, 'claim_1', {
        reason_code: 'NOT_ELIGIBLE',
        idempotency_key: 'idem_1',
        client_version: 1,
      }),
    ).resolves.toEqual(replayed);

    expect(fakeClient.getIdempotency).toHaveBeenCalledTimes(2);
    expect(fakeClient.excludeClaimCandidate).toHaveBeenCalledOnce();
  });

  it('keeps stale exclude conflicts when concurrent idempotency replay is absent', async () => {
    const stale = new PhosDomainError({
      status: 409,
      error_code: 'STALE_VERSION',
      message_key: 'api.error.stale_version',
    });
    const fakeClient = client({
      getIdempotency: vi.fn(async () => null),
      excludeClaimCandidate: vi.fn(async () => {
        throw stale;
      }),
    });
    const repository = createDynamoClaimCandidatesRepository(fakeClient);

    await expect(
      repository.excludeClaimCandidate(ctx, 'claim_1', {
        reason_code: 'NOT_ELIGIBLE',
        idempotency_key: 'idem_1',
        client_version: 1,
      }),
    ).rejects.toBe(stale);

    expect(fakeClient.getIdempotency).toHaveBeenCalledTimes(2);
  });

  it('rejects conflicting exclude idempotency keys before candidate mutation', async () => {
    const fakeClient = client({
      getIdempotency: vi.fn(async () => ({
        request_fingerprint: toDynamoAttributeValue('different'),
      })),
    });
    const repository = createDynamoClaimCandidatesRepository(fakeClient);

    await expect(
      repository.excludeClaimCandidate(ctx, 'claim_1', {
        reason_code: 'NOT_ELIGIBLE',
        idempotency_key: 'idem_1',
        client_version: 1,
      }),
    ).rejects.toMatchObject({
      status: 409,
      error_code: 'IDEMPOTENCY_CONFLICT',
      details: { idempotency_key: 'idem_1' },
    });
    expect(fakeClient.excludeClaimCandidate).not.toHaveBeenCalled();
  });
});
