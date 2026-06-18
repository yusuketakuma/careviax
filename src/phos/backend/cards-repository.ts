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
export { PhosDomainError, type PhosDomainErrorCode } from '@/phos/contracts/phos_errors';

export type CardSearchQuery = {
  query?: string;
  filter?: BoardQuickFilter;
  sort?: BoardSortKey;
  cursor?: string;
  limit: number;
};

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
