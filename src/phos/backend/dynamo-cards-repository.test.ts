import { describe, expect, it, vi } from 'vitest';
import {
  ActionCode,
  BoardQuickFilter,
  BoardSortKey,
  ButtonState,
  CardType,
  CurrentStep,
  DisplayStatus,
  UserRole,
} from '@/phos/contracts/phos_contracts';
import {
  createDynamoCardsRepository,
  PHOS_BOARD_GSI,
  PHOS_CORE_TABLE,
} from './dynamo-cards-repository';
import type { DynamoCardsClient, DynamoCardsMapper } from './dynamo-cards-repository';
import type { TenantContext } from './tenant-context';

type SummaryItem = { id: string; patient: string };
type DetailItem = SummaryItem & { version: number };

const ctx: TenantContext = {
  tenant_id: 'tenant_abc123',
  user_id: 'user_1',
  role: UserRole.PHARMACIST,
  request_id: 'req_1',
  correlation_id: 'corr_1',
  scopes: ['phos/cards.read'],
};

const mapper: DynamoCardsMapper<SummaryItem, DetailItem> = {
  toCardBoardItem: (item) => ({
    card: {
      card_id: item.id,
      card_type: CardType.PRESCRIPTION,
      patient_name: item.patient,
      current_step: CurrentStep.DIFF_REVIEW,
      display_status: DisplayStatus.READY,
      server_version: 1,
      tags: [],
    },
    next_action: {
      code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
      kind: 'STEP_CHANGING',
      label_key: 'action.confirm_prescription_diff',
      enabled: true,
      offline_allowed: false,
      priority: 'PRIMARY',
      required_role: [UserRole.PHARMACIST],
      target_endpoint: '/cards/card_1/actions',
      ui_state: ButtonState.ACTIONABLE,
      can_user_handle: true,
    },
  }),
  toCardDetail: (item) => ({
    card: {
      card_id: item.id,
      card_type: CardType.PRESCRIPTION,
      patient_name: item.patient,
      current_step: CurrentStep.DIFF_REVIEW,
      display_status: DisplayStatus.READY,
      server_version: item.version,
      tags: [],
    },
    visible_tabs: ['OVERVIEW'],
    permissions: {
      can_read: true,
      can_write: true,
      allowed_actions: [ActionCode.CONFIRM_PRESCRIPTION_DIFF],
    },
    next_action: {
      code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
      kind: 'STEP_CHANGING',
      label_key: 'action.confirm_prescription_diff',
      enabled: true,
      offline_allowed: false,
      priority: 'PRIMARY',
      required_role: [UserRole.PHARMACIST],
      target_endpoint: '/cards/card_1/actions',
      ui_state: ButtonState.ACTIONABLE,
      can_user_handle: true,
    },
    blockers: [],
    source_refs: [],
    server_version: item.version,
  }),
};

function client(): DynamoCardsClient<SummaryItem, DetailItem> {
  return {
    query: vi.fn(async () => ({
      items: [{ id: 'card_1', patient: 'Test Patient' }],
      next_cursor: 'cursor_2',
    })),
    get: vi.fn(async () => ({ id: 'card_1', patient: 'Test Patient', version: 3 })),
  };
}

describe('createDynamoCardsRepository', () => {
  it('searches cards through tenant-prefixed board GSI Query', async () => {
    const fakeClient = client();
    const repository = createDynamoCardsRepository(fakeClient, mapper);

    const result = await repository.searchCards(ctx, { limit: 25, cursor: 'cursor_1' });

    expect(fakeClient.query).toHaveBeenCalledWith({
      table_name: PHOS_CORE_TABLE,
      index_name: PHOS_BOARD_GSI,
      partition_key: 'TENANT#tenant_abc123#BOARD',
      key_type: 'GSI',
      limit: 25,
      cursor: 'cursor_1',
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.next_action.code).toBe(ActionCode.CONFIRM_PRESCRIPTION_DIFF);
    expect(result.next_cursor).toBe('cursor_2');
    expect(result.server_time).toEqual(expect.any(String));
  });

  it('applies bounded query filters and sort after mapping board items', async () => {
    const fakeClient = client();
    vi.mocked(fakeClient.query).mockResolvedValueOnce({
      items: [
        { id: 'late', patient: '患者 佐藤' },
        { id: 'early', patient: '患者 山田' },
      ],
    });
    const repository = createDynamoCardsRepository(fakeClient, {
      ...mapper,
      toCardBoardItem: (summary) => ({
        ...mapper.toCardBoardItem(summary),
        card: {
          ...mapper.toCardBoardItem(summary).card,
          visit_time: summary.id === 'early' ? '09:00' : '11:00',
          quick_filter_keys:
            summary.id === 'early' ? [BoardQuickFilter.TODAY] : [BoardQuickFilter.URGENT],
          search_texts: summary.id === 'early' ? ['薬剤A', '山田医師'] : ['薬剤B'],
        },
      }),
    });

    const result = await repository.searchCards(ctx, {
      query: '山田医師',
      filter: BoardQuickFilter.TODAY,
      sort: BoardSortKey.VISIT_TIME,
      limit: 25,
    });

    expect(result.items.map((entry) => entry.card.card_id)).toEqual(['early']);
  });

  it('gets card detail through tenant PK and card SK', async () => {
    const fakeClient = client();
    const repository = createDynamoCardsRepository(fakeClient, mapper);

    const result = await repository.getCardDetail(ctx, 'card_1');

    expect(fakeClient.get).toHaveBeenCalledWith({
      table_name: PHOS_CORE_TABLE,
      partition_key: 'TENANT#tenant_abc123',
      sort_key: 'CARD#card_1',
    });
    expect(result?.card.card_id).toBe('card_1');
    expect(result?.server_version).toBe(3);
  });

  it('returns null when the card does not exist', async () => {
    const fakeClient = client();
    vi.mocked(fakeClient.get).mockResolvedValueOnce(null);
    const repository = createDynamoCardsRepository(fakeClient, mapper);

    await expect(repository.getCardDetail(ctx, 'missing')).resolves.toBeNull();
  });
});
