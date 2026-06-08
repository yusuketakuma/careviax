import type {
  ClaimCandidateStatus,
  ClaimCandidateMutationResponse,
  ClaimCandidateView,
  ExcludeClaimCandidateRequest,
} from '@/phos/contracts/phos_contracts';
import { PhosDomainError } from '@/phos/backend/cards-repository';

export const FINAL_CLAIM_CANDIDATE_STATUSES = ['APPROVED', 'EXCLUDED'] as const;

export function isUnresolvedClaimCandidateStatus(status: ClaimCandidateStatus): boolean {
  return !FINAL_CLAIM_CANDIDATE_STATUSES.includes(
    status as (typeof FINAL_CLAIM_CANDIDATE_STATUSES)[number],
  );
}

export function assertCanExcludeClaimCandidate(
  candidate: ClaimCandidateView,
  command: ExcludeClaimCandidateRequest,
): void {
  if (candidate.server_version !== command.client_version) {
    throw new PhosDomainError({
      status: 409,
      error_code: 'STALE_VERSION',
      message_key: 'api.error.stale_version',
      details: {
        candidate_id: candidate.candidate_id,
        client_version: command.client_version,
        server_version: candidate.server_version,
      },
    });
  }
  if (command.reason_code.trim().length === 0) {
    throw new PhosDomainError({
      status: 400,
      error_code: 'VALIDATION_ERROR',
      message_key: 'api.error.validation.generic',
      details: { field: 'reason_code' },
    });
  }
  if (!isUnresolvedClaimCandidateStatus(candidate.status)) {
    throw new PhosDomainError({
      status: 409,
      error_code: 'STALE_VERSION',
      message_key: 'api.error.claim_candidate_already_finalized',
      details: { candidate_id: candidate.candidate_id, status: candidate.status },
    });
  }
}

export function buildExcludedClaimCandidateResponse(input: {
  candidate: ClaimCandidateView;
  command: ExcludeClaimCandidateRequest;
  now: string;
}): ClaimCandidateMutationResponse {
  assertCanExcludeClaimCandidate(input.candidate, input.command);
  const candidate: ClaimCandidateView = {
    ...input.candidate,
    status: 'EXCLUDED',
    status_label: '除外済み',
    excluded_reason_code: input.command.reason_code.trim(),
    ...(input.command.reason_note
      ? { excluded_reason_note: input.command.reason_note.trim() }
      : {}),
    updated_at: input.now,
    server_version: input.candidate.server_version + 1,
  };

  return {
    candidate,
    side_effects: [{ type: 'CLAIM_RECALCULATED', card_id: candidate.card_id }],
    toast: {
      tone: 'INFO',
      message_key: 'toast.claim_candidate_excluded',
      params: { fee_code: candidate.fee_code },
    },
    server_version: candidate.server_version,
  };
}
