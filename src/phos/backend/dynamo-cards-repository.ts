import type {
  CardBoardItemView,
  CardDetailResponse,
  CardSearchResponse,
} from '@/phos/contracts/phos_contracts';
import {
  assertTenantPk,
  assertTenantScopedDynamoOperation,
  boardGsiPk,
  cardSk,
  tenantPk,
} from './dynamodb-keys';
import type { CardSearchQuery, PhosCardsRepository } from './cards-repository';
import { PhosDomainError } from './cards-repository';
import type { TenantContext } from './tenant-context';

export const PHOS_CORE_TABLE = 'phos_core';
export const PHOS_BOARD_GSI = 'GSI1';

export type DynamoQueryInput = {
  table_name: string;
  index_name?: string;
  partition_key: string;
  key_type?: 'PK' | 'GSI';
  sort_key_begins_with?: string;
  limit: number;
  cursor?: string;
};

export type DynamoGetInput = {
  table_name: string;
  partition_key: string;
  sort_key: string;
};

export type DynamoQueryOutput<T> = {
  items: T[];
  next_cursor?: string;
};

export type DynamoCardsClient<TSummary, TDetail> = {
  query(input: DynamoQueryInput): Promise<DynamoQueryOutput<TSummary>>;
  get(input: DynamoGetInput): Promise<TDetail | null>;
};

export type DynamoCardsMapper<TSummary, TDetail> = {
  toCardBoardItem(item: TSummary): CardBoardItemView;
  toCardDetail(item: TDetail): CardDetailResponse;
};

export function createDynamoCardsRepository<TSummary, TDetail>(
  client: DynamoCardsClient<TSummary, TDetail>,
  mapper: DynamoCardsMapper<TSummary, TDetail>,
): Pick<PhosCardsRepository, 'searchCards' | 'getCardDetail'> {
  return {
    async searchCards(ctx: TenantContext, query: CardSearchQuery): Promise<CardSearchResponse> {
      const partition_key = boardGsiPk(ctx);
      assertTenantScopedDynamoOperation(ctx, {
        operation: 'Query',
        partition_key,
        key_type: 'GSI',
      });

      const result = await client.query({
        table_name: PHOS_CORE_TABLE,
        index_name: PHOS_BOARD_GSI,
        partition_key,
        key_type: 'GSI',
        limit: query.limit,
        cursor: query.cursor,
      });

      return {
        items: result.items.map((item) => mapper.toCardBoardItem(item)),
        next_cursor: result.next_cursor,
        server_time: new Date().toISOString(),
      };
    },

    async getCardDetail(ctx: TenantContext, card_id: string): Promise<CardDetailResponse | null> {
      const partition_key = tenantPk(ctx);
      assertTenantPk(ctx, partition_key);

      const item = await client.get({
        table_name: PHOS_CORE_TABLE,
        partition_key,
        sort_key: cardSk(card_id),
      });

      if (!item) return null;
      const detail = mapper.toCardDetail(item);
      if (detail.card.card_id !== card_id) {
        throw new PhosDomainError({
          status: 500,
          error_code: 'INTERNAL_ERROR',
          message_key: 'api.error.card_detail_mapping_mismatch',
        });
      }
      return detail;
    },
  };
}
