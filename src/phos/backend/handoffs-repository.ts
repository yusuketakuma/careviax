import type {
  CreateHandoffRequest,
  HandoffMutationResponse,
  HandoffSearchQuery,
  HandoffSearchResponse,
  OpenHandoffRequest,
  ResolveHandoffRequest,
  ReturnHandoffRequest,
} from '@/phos/contracts/phos_contracts';
import type { TenantContext } from './tenant-context';

export type CreateHandoffCommand = CreateHandoffRequest;
export type OpenHandoffCommand = OpenHandoffRequest;
export type ResolveHandoffCommand = ResolveHandoffRequest;
export type ReturnHandoffCommand = ReturnHandoffRequest;

export type PhosHandoffsRepository = {
  searchHandoffs(ctx: TenantContext, query: HandoffSearchQuery): Promise<HandoffSearchResponse>;
  createHandoff(ctx: TenantContext, command: CreateHandoffCommand): Promise<HandoffMutationResponse>;
  openHandoff(
    ctx: TenantContext,
    handoff_id: string,
    command: OpenHandoffCommand,
  ): Promise<HandoffMutationResponse>;
  resolveHandoff(
    ctx: TenantContext,
    handoff_id: string,
    command: ResolveHandoffCommand,
  ): Promise<HandoffMutationResponse>;
  returnHandoff(
    ctx: TenantContext,
    handoff_id: string,
    command: ReturnHandoffCommand,
  ): Promise<HandoffMutationResponse>;
};
