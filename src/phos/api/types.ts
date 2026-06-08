import type {
  ActionRequest,
  ActionResponse,
  CapacityResponse,
  CapacityScope,
  CardDetailResponse,
  CardSearchResponse,
  CreateHandoffRequest,
  ErrorResponse,
  EvidencePresignUploadResponse,
  EvidenceUploadRequest,
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

export type PhosReportDeliveriesQuery = {
  status?: ReportDeliveryStatus;
  cursor?: string;
  limit?: number;
};

export type PhosApiClient = {
  getCards(query?: PhosCardsQuery): Promise<CardSearchResponse>;
  getCapacity(query: PhosCapacityQuery): Promise<CapacityResponse>;
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

export type PhosApiErrorStatus = 400 | 403 | 404 | 409 | 422 | 500;

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
