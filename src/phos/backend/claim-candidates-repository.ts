import type {
  ClaimCandidateMutationResponse,
  ClaimCandidateSearchResponse,
  ClaimCandidateStatus,
  ExcludeClaimCandidateRequest,
} from '@/phos/contracts/phos_contracts';
import type { TenantContext } from './tenant-context';

export type ClaimCandidateSearchQuery = {
  card_id?: string;
  status?: ClaimCandidateStatus;
  cursor?: string;
  limit: number;
};

export type PhosClaimCandidatesRepository = {
  searchClaimCandidates(
    ctx: TenantContext,
    query: ClaimCandidateSearchQuery,
  ): Promise<ClaimCandidateSearchResponse>;
  excludeClaimCandidate(
    ctx: TenantContext,
    candidate_id: string,
    command: ExcludeClaimCandidateRequest,
  ): Promise<ClaimCandidateMutationResponse>;
};
