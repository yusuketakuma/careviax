import type {
  CardBoardItemView,
  CardDetailResponse,
  CardSearchResponse,
} from '@/phos/contracts/phos_contracts';
import {
  BoardQuickFilter as BoardQuickFilterValues,
  BoardSortKey as BoardSortKeyValues,
} from '@/phos/contracts/phos_contracts';
import { selectBoardItems } from '@/phos/domain/board/boardFilters';
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

export function phosCoreTableName(): string {
  const tableName = process.env.PHOS_DYNAMODB_TABLE_NAME?.trim();
  return tableName || PHOS_CORE_TABLE;
}

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

const MAX_FILTERED_CARD_SEARCH_PAGES = 5;

function shouldFillFilteredCardSearchPage(query: CardSearchQuery): boolean {
  return !!query.query || (!!query.filter && query.filter !== BoardQuickFilterValues.ALL);
}

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

      const fetchedItems: TSummary[] = [];
      let cursor = query.cursor;
      let next_cursor: string | undefined;
      let selectedItems: CardBoardItemView[] = [];
      const fillFilteredPage = shouldFillFilteredCardSearchPage(query);

      for (let page = 0; page < MAX_FILTERED_CARD_SEARCH_PAGES; page++) {
        const result = await client.query({
          table_name: phosCoreTableName(),
          index_name: PHOS_BOARD_GSI,
          partition_key,
          key_type: 'GSI',
          limit: query.limit,
          cursor,
        });
        fetchedItems.push(...result.items);
        next_cursor = result.next_cursor;
        selectedItems = selectBoardItems(
          fetchedItems.map((item) => mapper.toCardBoardItem(item)),
          {
            quickFilter: query.filter ?? BoardQuickFilterValues.ALL,
            query: query.query,
            sortKey: query.sort ?? BoardSortKeyValues.VISIT_TIME,
          },
        );
        if (selectedItems.length >= query.limit || !next_cursor || !fillFilteredPage) break;
        cursor = next_cursor;
      }

      return {
        items: selectedItems.slice(0, query.limit),
        next_cursor,
        server_time: new Date().toISOString(),
      };
    },

    async getCardDetail(ctx: TenantContext, card_id: string): Promise<CardDetailResponse | null> {
      const partition_key = tenantPk(ctx);
      assertTenantPk(ctx, partition_key);

      const item = await client.get({
        table_name: phosCoreTableName(),
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
