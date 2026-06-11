import { describe, expect, it, vi } from 'vitest';
import {
  UserRole,
  type ClaimCandidateMutationResponse,
  type ClaimCandidateSearchResponse,
} from '@/phos/contracts/phos_contracts';
import type { PhosLambdaResponse } from './error-response';
import {
  createClaimCandidateSearchHandler,
  createExcludeClaimCandidateHandler,
} from './claim-candidates-handlers';
import type { PhosClaimCandidatesRepository } from './claim-candidates-repository';
import type { TenantContext } from './tenant-context';

function ctx(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    tenant_id: 'tenant_abc123',
    user_id: 'user_1',
    role: UserRole.PHARMACIST,
    request_id: 'req_1',
    correlation_id: 'corr_1',
    scopes: ['phos/claim-candidates.read'],
    ...overrides,
  };
}

function searchResponse(): ClaimCandidateSearchResponse {
  return { items: [], server_time: '2026-06-09T00:00:00.000Z' };
}

function mutationResponse(): ClaimCandidateMutationResponse {
  return {
    candidate: {
      candidate_id: 'claim_1',
      card_id: 'card_1',
      patient_name: '患者 山田太郎',
      fee_code: 'M001',
      fee_label: '在宅患者訪問薬剤管理指導料',
      billing_month: '2026-06-01',
      status: 'EXCLUDED',
      status_label: '除外済み',
      missing_evidence_keys: [],
      evidence_requirements: [],
      rule_version_id: 'rv_2026',
      priority_rank: 10,
      source_refs: [],
      created_at: '2026-06-09T00:00:00.000Z',
      updated_at: '2026-06-09T01:00:00.000Z',
      server_version: 2,
      excluded_reason_code: 'NOT_ELIGIBLE',
    },
    side_effects: [{ type: 'CLAIM_RECALCULATED', card_id: 'card_1' }],
    server_version: 2,
  };
}

function repository(
  overrides: Partial<PhosClaimCandidatesRepository> = {},
): PhosClaimCandidatesRepository {
  return {
    searchClaimCandidates: vi.fn(async () => searchResponse()),
    excludeClaimCandidate: vi.fn(async () => mutationResponse()),
    ...overrides,
  };
}

describe('PH-OS claim-candidates handler', () => {
  it('loads claim candidates through read-scoped access', async () => {
    const repo = repository();
    const handler = createClaimCandidateSearchHandler(repo);

    await expect(
      handler({
        ctx: ctx(),
        body: undefined,
        event: {
          routeKey: 'GET /claim-candidates',
          queryStringParameters: { status: 'MISSING_EVIDENCE', limit: '25' },
        },
      }),
    ).resolves.toEqual(searchResponse());

    expect(repo.searchClaimCandidates).toHaveBeenCalledWith(ctx(), {
      status: 'MISSING_EVIDENCE',
      limit: 25,
    });
  });

  it('trims claim candidate query identifiers before repository access', async () => {
    const repo = repository();

    await expect(
      createClaimCandidateSearchHandler(repo)({
        ctx: ctx(),
        body: undefined,
        event: {
          routeKey: 'GET /claim-candidates',
          queryStringParameters: { card_id: ' card_1 ', cursor: ' cursor_1 ', limit: ' 25 ' },
        },
      }),
    ).resolves.toEqual(searchResponse());

    expect(repo.searchClaimCandidates).toHaveBeenCalledWith(ctx(), {
      card_id: 'card_1',
      cursor: 'cursor_1',
      limit: 25,
    });
  });

  it('rejects invalid query before repository access', async () => {
    const repo = repository();
    const result = (await createClaimCandidateSearchHandler(repo)({
      ctx: ctx(),
      body: undefined,
      event: { queryStringParameters: { status: 'BAD', limit: '200' } },
    })) as PhosLambdaResponse;

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toMatchObject({ error_code: 'VALIDATION_ERROR' });
    expect(repo.searchClaimCandidates).not.toHaveBeenCalled();
  });

  it('rejects malformed numeric limit before repository access', async () => {
    const repo = repository();
    const result = (await createClaimCandidateSearchHandler(repo)({
      ctx: ctx(),
      body: undefined,
      event: { queryStringParameters: { limit: '25x' } },
    })) as PhosLambdaResponse;

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toMatchObject({
      error_code: 'VALIDATION_ERROR',
      details: { field: 'limit' },
    });
    expect(repo.searchClaimCandidates).not.toHaveBeenCalled();
  });

  it('excludes claim candidates only through pharmacist-grade write access', async () => {
    const repo = repository();
    const handler = createExcludeClaimCandidateHandler(repo);

    const clerkResult = (await handler({
      ctx: ctx({ role: UserRole.PHARMACY_CLERK, scopes: ['phos/claim-candidates.write'] }),
      event: { pathParameters: { candidate_id: 'claim_1' } },
      body: {
        reason_code: 'NOT_ELIGIBLE',
        idempotency_key: 'idem_1',
        client_version: 1,
      },
    })) as PhosLambdaResponse;

    expect(clerkResult.statusCode).toBe(403);
    expect(repo.excludeClaimCandidate).not.toHaveBeenCalled();

    await expect(
      handler({
        ctx: ctx({ scopes: ['phos/claim-candidates.write'] }),
        event: {
          routeKey: 'POST /claim-candidates/{candidate_id}/exclude',
          pathParameters: { candidate_id: 'claim_1' },
        },
        body: {
          reason_code: ' NOT_ELIGIBLE ',
          reason_note: ' 対象外 ',
          idempotency_key: 'idem_1',
          client_version: 1,
        },
      }),
    ).resolves.toEqual(mutationResponse());

    expect(repo.excludeClaimCandidate).toHaveBeenCalledWith(expect.any(Object), 'claim_1', {
      reason_code: 'NOT_ELIGIBLE',
      reason_note: '対象外',
      idempotency_key: 'idem_1',
      client_version: 1,
    });
  });
});
