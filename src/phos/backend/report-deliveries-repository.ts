import type {
  MarkReportActionDoneRequest,
  RegisterReportReplyRequest,
  ReportDeliveryMutationResponse,
  ReportDeliverySearchResponse,
  ReportDeliveryStatus,
} from '@/phos/contracts/phos_contracts';
import type { TenantContext } from './tenant-context';

export type ReportDeliverySearchQuery = {
  status?: ReportDeliveryStatus;
  cursor?: string;
  limit: number;
};

export type PhosReportDeliveriesRepository = {
  searchReportDeliveries(
    ctx: TenantContext,
    query: ReportDeliverySearchQuery,
  ): Promise<ReportDeliverySearchResponse>;
  registerReportReply(
    ctx: TenantContext,
    delivery_id: string,
    command: RegisterReportReplyRequest,
  ): Promise<ReportDeliveryMutationResponse>;
  markReportActionDone(
    ctx: TenantContext,
    delivery_id: string,
    command: MarkReportActionDoneRequest,
  ): Promise<ReportDeliveryMutationResponse>;
};

export type PhosReportDeliverySearchRepository = Pick<
  PhosReportDeliveriesRepository,
  'searchReportDeliveries'
>;
