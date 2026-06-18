import { describe, expect, it } from 'vitest';
import type { ClaimCandidateView } from '@/phos/contracts/phos_contracts';
import { PhosDomainError } from '@/phos/contracts/phos_errors';
import {
  assertCanExcludeClaimCandidate,
  buildExcludedClaimCandidateResponse,
  isUnresolvedClaimCandidateStatus,
} from './claimCandidateLifecycle';

function candidate(overrides: Partial<ClaimCandidateView> = {}): ClaimCandidateView {
  return {
    candidate_id: 'claim_1',
    card_id: 'card_1',
    patient_name: '患者 山田太郎',
    fee_code: 'M001',
    fee_label: '在宅患者訪問薬剤管理指導料',
    billing_month: '2026-06-01',
    status: 'READY',
    status_label: '算定可',
    missing_evidence_keys: [],
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

describe('ClaimCandidate lifecycle', () => {
  it('classifies claim candidate statuses by unresolved/finalized state', () => {
    expect(isUnresolvedClaimCandidateStatus('CANDIDATE')).toBe(true);
    expect(isUnresolvedClaimCandidateStatus('MISSING_EVIDENCE')).toBe(true);
    expect(isUnresolvedClaimCandidateStatus('READY')).toBe(true);
    expect(isUnresolvedClaimCandidateStatus('APPROVED')).toBe(false);
    expect(isUnresolvedClaimCandidateStatus('EXCLUDED')).toBe(false);
  });

  it('excludes active candidates with a required reason and recalculates claim state', () => {
    expect(
      buildExcludedClaimCandidateResponse({
        candidate: candidate(),
        command: {
          reason_code: 'NOT_ELIGIBLE',
          reason_note: '対象外',
          idempotency_key: 'idem_1',
          client_version: 1,
        },
        now: '2026-06-09T01:00:00.000Z',
      }),
    ).toMatchObject({
      candidate: {
        status: 'EXCLUDED',
        excluded_reason_code: 'NOT_ELIGIBLE',
        server_version: 2,
      },
      side_effects: [{ type: 'CLAIM_RECALCULATED', card_id: 'card_1' }],
      server_version: 2,
    });
  });

  it('rejects stale versions and finalized candidates', () => {
    expect(() =>
      assertCanExcludeClaimCandidate(candidate({ server_version: 2 }), {
        reason_code: 'NOT_ELIGIBLE',
        idempotency_key: 'idem_1',
        client_version: 1,
      }),
    ).toThrow('STALE_VERSION');

    expect(() =>
      assertCanExcludeClaimCandidate(candidate({ status: 'APPROVED' }), {
        reason_code: 'NOT_ELIGIBLE',
        idempotency_key: 'idem_2',
        client_version: 1,
      }),
    ).toThrow('STALE_VERSION');
  });

  it('throws contract-owned PHOS domain errors', () => {
    expect(() =>
      assertCanExcludeClaimCandidate(candidate({ server_version: 2 }), {
        reason_code: 'NOT_ELIGIBLE',
        idempotency_key: 'idem_3',
        client_version: 1,
      }),
    ).toThrow(PhosDomainError);
  });

  it('rejects a whitespace-only reason_code on an otherwise-valid candidate with VALIDATION_ERROR', () => {
    let caught: unknown;
    try {
      assertCanExcludeClaimCandidate(candidate(), {
        reason_code: '   ',
        idempotency_key: 'idem_4',
        client_version: 1,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PhosDomainError);
    const domainError = caught as PhosDomainError;
    expect(domainError.error_code).toBe('VALIDATION_ERROR');
    expect(domainError.status).toBe(400);
    expect(domainError.details).toEqual({ field: 'reason_code' });
  });

  it('trims the reason_note when present', () => {
    const response = buildExcludedClaimCandidateResponse({
      candidate: candidate(),
      command: {
        reason_code: 'NOT_ELIGIBLE',
        reason_note: '  対象外メモ  ',
        idempotency_key: 'idem_5',
        client_version: 1,
      },
      now: '2026-06-09T01:00:00.000Z',
    });

    expect(response.candidate.excluded_reason_note).toBe('対象外メモ');
  });

  it('omits excluded_reason_note entirely when reason_note is absent or empty', () => {
    const withoutNote = buildExcludedClaimCandidateResponse({
      candidate: candidate(),
      command: {
        reason_code: 'NOT_ELIGIBLE',
        idempotency_key: 'idem_6',
        client_version: 1,
      },
      now: '2026-06-09T01:00:00.000Z',
    });

    expect('excluded_reason_note' in withoutNote.candidate).toBe(false);
    expect(withoutNote.candidate.excluded_reason_note).toBeUndefined();

    const emptyNote = buildExcludedClaimCandidateResponse({
      candidate: candidate(),
      command: {
        reason_code: 'NOT_ELIGIBLE',
        reason_note: '',
        idempotency_key: 'idem_7',
        client_version: 1,
      },
      now: '2026-06-09T01:00:00.000Z',
    });

    expect('excluded_reason_note' in emptyNote.candidate).toBe(false);
  });
});
