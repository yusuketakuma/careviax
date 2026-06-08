import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActionCode,
  ActionKind,
  ButtonState,
  CardType,
  CurrentStep,
  DisplayStatus,
} from '@/phos/contracts/phos_contracts';
import type { PhosCardsRepository } from './cards-repository';
import type {
  CardDetailResponse,
  CardSummaryView,
  NextActionView,
} from '@/phos/contracts/phos_contracts';
import {
  createCardDetailLambdaHandler,
  createCardSearchLambdaHandler,
  createExecuteCardActionLambdaHandler,
} from './cards-lambda';
import type { PhosHttpEvent } from './lambda-handler';

const card: CardSummaryView = {
  card_id: 'card_1',
  card_type: CardType.PRESCRIPTION,
  patient_name: 'Test Patient',
  current_step: CurrentStep.DIFF_REVIEW,
  display_status: DisplayStatus.READY,
  server_version: 1,
  tags: [],
};

const next_action: NextActionView = {
  code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
  kind: ActionKind.STEP_CHANGING,
  label_key: 'action.confirm_prescription_diff',
  enabled: true,
  offline_allowed: false,
  priority: 'PRIMARY',
  required_role: [],
  target_endpoint: '/cards/card_1/actions',
  ui_state: ButtonState.ACTIONABLE,
  can_user_handle: true,
};

const detailResponse: CardDetailResponse = {
  card,
  visible_tabs: ['OVERVIEW'],
  permissions: {
    can_read: true,
    can_write: true,
    allowed_actions: [ActionCode.CONFIRM_PRESCRIPTION_DIFF],
  },
  next_action,
  blockers: [],
  source_refs: [],
  server_version: 1,
};

function repository(overrides: Partial<PhosCardsRepository> = {}): PhosCardsRepository {
  return {
    searchCards: vi.fn(async () => ({
      items: [{ card, next_action }],
      server_time: '2026-06-09T00:00:00.000Z',
    })),
    getCardDetail: vi.fn(async () => detailResponse),
    executeCardAction: vi.fn(async () => ({
      card: { ...card, current_step: CurrentStep.DISPENSING, server_version: 2 },
      next_action,
      display_status: DisplayStatus.READY,
      blockers: [],
      side_effects: [],
      server_version: 2,
    })),
    ...overrides,
  };
}

function event(overrides: Partial<PhosHttpEvent> = {}): PhosHttpEvent {
  return {
    routeKey: 'GET /cards',
    requestContext: {
      requestId: 'req_1',
      authorizer: {
        jwt: {
          claims: {
            token_use: 'access',
            tenant_id: 'tenant_abc123',
            sub: 'user_001',
            role: 'PHARMACIST',
            scope: 'phos/cards.read phos/cards.write',
          },
        },
      },
    },
    ...overrides,
  };
}

describe('PH-OS cards Lambda composition', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('wires GET /cards through tenant context into the repository', async () => {
    const repo = repository();
    const handler = createCardSearchLambdaHandler({ repository: repo });

    const response = await handler(event({ queryStringParameters: { limit: '25' } }));

    expect(response.statusCode).toBe(200);
    expect(repo.searchCards).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 'tenant_abc123', user_id: 'user_001' }),
      { limit: 25 },
    );
  });

  it('wires GET /cards/{card_id} through a composed Lambda export', async () => {
    const repo = repository();
    const handler = createCardDetailLambdaHandler({ repository: repo });

    const response = await handler(
      event({ routeKey: 'GET /cards/{card_id}', pathParameters: { card_id: 'card_1' } }),
    );

    expect(response.statusCode).toBe(200);
    expect(repo.getCardDetail).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 'tenant_abc123' }),
      'card_1',
    );
  });

  it('wires POST /cards/{card_id}/actions through a composed Lambda export', async () => {
    const repo = repository();
    const handler = createExecuteCardActionLambdaHandler({ repository: repo });

    const response = await handler(
      event({
        routeKey: 'POST /cards/{card_id}/actions',
        pathParameters: { card_id: 'card_1' },
        body: JSON.stringify({
          action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
          idempotency_key: 'idem_1',
          client_version: 1,
        }),
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(repo.executeCardAction).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 'tenant_abc123' }),
      'card_1',
      {
        action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        idempotency_key: 'idem_1',
        client_version: 1,
      },
    );
  });
});
