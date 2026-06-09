import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GetItemCommand,
  TransactWriteItemsCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import {
  ActionCode,
  ActionKind,
  ButtonState,
  CardType,
  CurrentStep,
  DisplayStatus,
  UserRole,
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
import { createInMemoryObservabilitySink } from './observability';
import { toDynamoAttributeValue } from './dynamodb-attribute-values';

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
    const observability = createInMemoryObservabilitySink();
    const handler = createExecuteCardActionLambdaHandler({ repository: repo, observability });

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
    expect(observability.metrics).toContainEqual(
      expect.objectContaining({
        name: 'ActionLatencyMs',
        action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
      }),
    );
  });

  it('fails claim review with ACTION_GUARD_FAILED when the Dynamo aggregate is missing', async () => {
    const claimReviewCard: CardSummaryView = {
      ...card,
      current_step: CurrentStep.CLAIM_REVIEW,
      server_version: 3,
    };
    const claimReviewAction: NextActionView = {
      code: ActionCode.REVIEW_CLAIM_CANDIDATES,
      kind: ActionKind.STEP_CHANGING,
      label_key: 'action.review_claim_candidates',
      enabled: true,
      offline_allowed: false,
      priority: 'PRIMARY',
      required_role: [UserRole.PHARMACIST],
      target_endpoint: '/cards/card_1/actions',
      ui_state: ButtonState.ACTIONABLE,
      can_user_handle: true,
    };
    const stateItem: Record<string, AttributeValue> = {
      card: toDynamoAttributeValue(claimReviewCard),
      next_action: toDynamoAttributeValue(claimReviewAction),
      blockers: toDynamoAttributeValue([]),
      allowed_actions: toDynamoAttributeValue([ActionCode.REVIEW_CLAIM_CANDIDATES]),
      server_version: { N: '3' },
    };
    const send = vi
      .fn()
      .mockImplementationOnce(async (command: GetItemCommand) => {
        expect(command).toBeInstanceOf(GetItemCommand);
        return {};
      })
      .mockImplementationOnce(async (command: GetItemCommand) => {
        expect(command).toBeInstanceOf(GetItemCommand);
        return { Item: stateItem };
      })
      .mockImplementationOnce(async (command: TransactWriteItemsCommand) => {
        throw new Error(`Unexpected commit: ${command.constructor.name}`);
      });
    const handler = createExecuteCardActionLambdaHandler({ dynamo_client: { send } });

    const response = await handler(
      event({
        routeKey: 'POST /cards/{card_id}/actions',
        pathParameters: { card_id: 'card_1' },
        body: JSON.stringify({
          action_code: ActionCode.REVIEW_CLAIM_CANDIDATES,
          idempotency_key: 'idem_claim_review',
          client_version: 3,
        }),
      }),
    );

    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.body)).toMatchObject({
      error_code: 'ACTION_GUARD_FAILED',
      details: {
        action_code: ActionCode.REVIEW_CLAIM_CANDIDATES,
        reason: 'invalid_unresolved_claim_candidate_count',
      },
    });
    expect(send).toHaveBeenCalledTimes(2);
  });
});
