import type {
  ActionCode,
  ActionRequest,
  ActionResponse,
  BoardQuickFilter,
  BoardSortKey,
  CardDetailResponse,
  CardSearchResponse,
} from '@/phos/contracts/phos_contracts';
import type { TenantContext } from './tenant-context';

export type CardSearchQuery = {
  query?: string;
  filter?: BoardQuickFilter;
  sort?: BoardSortKey;
  cursor?: string;
  limit: number;
};

export type PhosDomainErrorCode =
  | 'FORBIDDEN'
  | 'ACTION_GUARD_FAILED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'STALE_VERSION'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

export class PhosDomainError extends Error {
  error_code: PhosDomainErrorCode;
  status: number;
  message_key: string;
  details?: Record<string, unknown>;

  constructor(input: {
    status: number;
    error_code: PhosDomainErrorCode;
    message_key: string;
    details?: Record<string, unknown>;
  }) {
    super(input.error_code);
    this.name = 'PhosDomainError';
    this.status = input.status;
    this.error_code = input.error_code;
    this.message_key = input.message_key;
    this.details = input.details;
  }
}

export type CardActionCommand = ActionRequest & {
  action_code: ActionCode;
};

export type PhosCardsRepository = {
  searchCards(ctx: TenantContext, query: CardSearchQuery): Promise<CardSearchResponse>;
  getCardDetail(ctx: TenantContext, card_id: string): Promise<CardDetailResponse | null>;
  executeCardAction(
    ctx: TenantContext,
    card_id: string,
    command: CardActionCommand,
  ): Promise<ActionResponse>;
};
