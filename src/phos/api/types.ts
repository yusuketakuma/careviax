import type {
  ActionRequest,
  ActionResponse,
  BoardQuickFilter,
  BoardSortKey,
  CapacityResponse,
  CapacityScope,
  CardDetailResponse,
  CardSearchResponse,
  ClaimCandidateMutationResponse,
  ClaimCandidateSearchResponse,
  ClaimCandidateStatus,
  CreateHandoffRequest,
  ErrorResponse,
  ExcludeClaimCandidateRequest,
  EvidencePresignUploadResponse,
  EvidencePendingView,
  EvidenceUploadRequest,
  FeeRuleSearchResponse,
  HandoffMutationResponse,
  HandoffSearchQuery,
  HandoffSearchResponse,
  MarkReportActionDoneRequest,
  OpenHandoffRequest,
  RegisterReportReplyRequest,
  ReportDeliveryMutationResponse,
  ReportDeliverySearchResponse,
  ReportDeliveryStatus,
  ResolveHandoffRequest,
  ReturnHandoffRequest,
  VisitModeView,
  VisitStep,
  VisitStepMutationRequest,
  OfflineOpClass,
} from '@/phos/contracts/phos_contracts';
import type { PhosOfflineEvidenceInput } from './offlineEvidenceQueue';

export type PhosCardsQuery = {
  query?: string;
  filter?: BoardQuickFilter;
  sort?: BoardSortKey;
  cursor?: string;
  limit?: number;
};

export type PhosCapacityQuery = {
  date: string;
  scope: CapacityScope;
};

export type PhosClaimCandidatesQuery = {
  card_id?: string;
  status?: ClaimCandidateStatus;
  cursor?: string;
  limit?: number;
};

export type PhosReportDeliveriesQuery = {
  status?: ReportDeliveryStatus;
  cursor?: string;
  limit?: number;
};

export type PhosRequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type PhosApiClient = {
  getCards(query?: PhosCardsQuery, options?: PhosRequestOptions): Promise<CardSearchResponse>;
  getCapacity(query: PhosCapacityQuery, options?: PhosRequestOptions): Promise<CapacityResponse>;
  getClaimCandidates(
    query?: PhosClaimCandidatesQuery,
    options?: PhosRequestOptions,
  ): Promise<ClaimCandidateSearchResponse>;
  excludeClaimCandidate(
    candidate_id: string,
    request: ExcludeClaimCandidateRequest,
    options?: PhosRequestOptions,
  ): Promise<ClaimCandidateMutationResponse>;
  getFeeRules(
    query?: {
      fee_code?: string;
      cursor?: string;
      limit?: number;
    },
    options?: PhosRequestOptions,
  ): Promise<FeeRuleSearchResponse>;
  getCardDetail(card_id: string, options?: PhosRequestOptions): Promise<CardDetailResponse>;
  executeCardAction(
    card_id: string,
    request: ActionRequest,
    options?: PhosRequestOptions & { offlineReplay?: boolean },
  ): Promise<ActionResponse>;
  getVisitMode(packet_id: string, options?: PhosRequestOptions): Promise<VisitModeView>;
  updateVisitStep(
    packet_id: string,
    step: VisitStep,
    request: VisitStepMutationRequest,
    options?: PhosRequestOptions,
  ): Promise<VisitModeView>;
  presignEvidenceUpload(
    request: EvidenceUploadRequest,
    options?: PhosRequestOptions,
  ): Promise<EvidencePresignUploadResponse>;
  getHandoffs(
    query?: HandoffSearchQuery,
    options?: PhosRequestOptions,
  ): Promise<HandoffSearchResponse>;
  getReportDeliveries(
    query?: PhosReportDeliveriesQuery,
    options?: PhosRequestOptions,
  ): Promise<ReportDeliverySearchResponse>;
  registerReportReply(
    delivery_id: string,
    request: RegisterReportReplyRequest,
    options?: PhosRequestOptions,
  ): Promise<ReportDeliveryMutationResponse>;
  markReportActionDone(
    delivery_id: string,
    request: MarkReportActionDoneRequest,
    options?: PhosRequestOptions,
  ): Promise<ReportDeliveryMutationResponse>;
  createHandoff(
    request: CreateHandoffRequest,
    options?: PhosRequestOptions,
  ): Promise<HandoffMutationResponse>;
  openHandoff(
    handoff_id: string,
    request: OpenHandoffRequest,
    options?: PhosRequestOptions,
  ): Promise<HandoffMutationResponse>;
  resolveHandoff(
    handoff_id: string,
    request: ResolveHandoffRequest,
    options?: PhosRequestOptions,
  ): Promise<HandoffMutationResponse>;
  returnHandoff(
    handoff_id: string,
    request: ReturnHandoffRequest,
    options?: PhosRequestOptions,
  ): Promise<HandoffMutationResponse>;
};

export type PhosOfflineCardActionQueueInput = {
  card_id: string;
  request: ActionRequest;
  offline_op_class: OfflineOpClass;
};

export type PhosOfflineActionQueueResult = {
  queue_id: string | number;
};

export type PhosOfflineActionQueue = {
  enqueueCardAction(input: PhosOfflineCardActionQueueInput): Promise<PhosOfflineActionQueueResult>;
};

export type PhosOfflineEvidenceRetryResult = {
  synced: number;
  failed: number;
  verified_visits: VisitModeView[];
};

export type PhosOfflineEvidenceQueue = {
  enqueueEvidence(input: PhosOfflineEvidenceInput): Promise<{ queue_id: string | number }>;
  listPendingEvidence(packet_id: string): Promise<EvidencePendingView[]>;
  retryUploads(input: {
    client: Pick<PhosApiClient, 'getVisitMode' | 'presignEvidenceUpload' | 'updateVisitStep'>;
    fetchImpl?: typeof fetch;
  }): Promise<PhosOfflineEvidenceRetryResult>;
};

export class PhosApiError extends Error {
  status: number;
  response: ErrorResponse;

  constructor(status: number, response: ErrorResponse) {
    super(response.error_code);
    this.name = 'PhosApiError';
    this.status = status;
    this.response = response;
  }
}

export class PhosOfflineQueuedError extends Error {
  queued: PhosOfflineActionQueueResult;

  constructor(queued: PhosOfflineActionQueueResult) {
    super('PH-OS action queued for offline sync');
    this.name = 'PhosOfflineQueuedError';
    this.queued = queued;
  }
}
