import type {
  ActionRequest,
  ActionResponse,
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

export type PhosCardsQuery = {
  query?: string;
  filter?: string;
  sort?: string;
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

export type PhosApiClient = {
  getCards(query?: PhosCardsQuery): Promise<CardSearchResponse>;
  getCapacity(query: PhosCapacityQuery): Promise<CapacityResponse>;
  getClaimCandidates(query?: PhosClaimCandidatesQuery): Promise<ClaimCandidateSearchResponse>;
  excludeClaimCandidate(
    candidate_id: string,
    request: ExcludeClaimCandidateRequest,
  ): Promise<ClaimCandidateMutationResponse>;
  getFeeRules(query?: {
    fee_code?: string;
    cursor?: string;
    limit?: number;
  }): Promise<FeeRuleSearchResponse>;
  getCardDetail(card_id: string): Promise<CardDetailResponse>;
  executeCardAction(card_id: string, request: ActionRequest): Promise<ActionResponse>;
  getVisitMode(packet_id: string): Promise<VisitModeView>;
  updateVisitStep(
    packet_id: string,
    step: VisitStep,
    request: VisitStepMutationRequest,
  ): Promise<VisitModeView>;
  presignEvidenceUpload(request: EvidenceUploadRequest): Promise<EvidencePresignUploadResponse>;
  getHandoffs(query?: HandoffSearchQuery): Promise<HandoffSearchResponse>;
  getReportDeliveries(query?: PhosReportDeliveriesQuery): Promise<ReportDeliverySearchResponse>;
  registerReportReply(
    delivery_id: string,
    request: RegisterReportReplyRequest,
  ): Promise<ReportDeliveryMutationResponse>;
  markReportActionDone(
    delivery_id: string,
    request: MarkReportActionDoneRequest,
  ): Promise<ReportDeliveryMutationResponse>;
  createHandoff(request: CreateHandoffRequest): Promise<HandoffMutationResponse>;
  openHandoff(handoff_id: string, request: OpenHandoffRequest): Promise<HandoffMutationResponse>;
  resolveHandoff(
    handoff_id: string,
    request: ResolveHandoffRequest,
  ): Promise<HandoffMutationResponse>;
  returnHandoff(
    handoff_id: string,
    request: ReturnHandoffRequest,
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
