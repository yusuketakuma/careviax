import { TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import {
  ActionCode,
  ActionKind,
  ButtonState,
  CardType,
  CurrentStep,
  DisplayStatus,
  HandoffStatus,
  HandoffUrgency,
} from '@/phos/contracts/phos_contracts';
import type { HandoffMutationResponse, HandoffView } from '@/phos/contracts/phos_contracts';
import type {
  DynamoHandoffCreateTransaction,
  DynamoHandoffTransitionTransaction,
} from './dynamo-handoff-lifecycle-store';
import {
  buildDynamoHandoffCreateTransactWriteItems,
  buildDynamoHandoffTransitionTransactWriteItems,
  createDynamoHandoffTransactionClient,
} from './dynamo-handoff-transaction-client';

function handoff(overrides: Partial<HandoffView> = {}): HandoffView {
  return {
    handoff_id: 'handoff_1',
    card_id: 'card_1',
    status: HandoffStatus.OPEN,
    reason_code: 'DIFF_REVIEW',
    summary: '薬剤師確認が必要です。',
    source_refs: [{ kind: 'PRESCRIPTION', ref_id: 'rx_1', label: '処方箋 1' }],
    requested_action: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
    urgency: HandoffUrgency.URGENT,
    related_blocker_code: 'MISSING_EVIDENCE',
    created_by_user_id: 'user_clerk',
    assignee_user_id: 'user_pharmacist',
    created_at: '2026-06-09T00:00:00.000Z',
    updated_at: '2026-06-09T00:00:00.000Z',
    server_version: 1,
    patient_name: '患者 山田太郎',
    age_minutes: 12,
    ...overrides,
  };
}

function response(next: HandoffView = handoff()): HandoffMutationResponse {
  return {
    handoff: next,
    side_effects:
      next.status === HandoffStatus.RESOLVED
        ? [{ type: 'BLOCKER_RESOLVED', blocker_code: 'MISSING_EVIDENCE' }]
        : [],
    server_version: next.server_version,
  };
}

function createTransaction(
  overrides: Partial<DynamoHandoffCreateTransaction> = {},
): DynamoHandoffCreateTransaction {
  return {
    table_name: 'phos_core',
    partition_key: 'TENANT#tenant_abc123',
    card_sort_key: 'CARD#card_1',
    expected_card_server_version: 1,
    handoff_sort_key: 'HANDOFF#handoff_1',
    queue_gsi_pk: 'TENANT#tenant_abc123#HANDOFF_ASSIGNEE#user_pharmacist',
    idempotency_sort_key: 'HANDOFF_IDEMPOTENCY#CREATE_HANDOFF:card_1#idem_create',
    idempotency_key: 'idem_create',
    request_fingerprint: 'fp_create',
    command: {
      card_id: 'card_1',
      reason_code: 'DIFF_REVIEW',
      summary: '薬剤師確認が必要です。',
      source_refs: [{ kind: 'PRESCRIPTION', ref_id: 'rx_1', label: '処方箋 1' }],
      urgency: HandoffUrgency.URGENT,
      requested_action: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
      related_blocker_code: 'MISSING_EVIDENCE',
      idempotency_key: 'idem_create',
      client_version: 1,
    },
    response: response(),
    audit_event: {
      event_id: 'HANDOFF_CREATED#idem_create',
      event_type: 'HANDOFF_CREATED',
      card_id: 'card_1',
      action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
      actor_user_id: 'user_clerk',
      request_id: 'req_1',
      correlation_id: 'corr_1',
      before_json: null,
      after_json: {
        handoff_id: 'handoff_1',
        card_id: 'card_1',
        status: HandoffStatus.OPEN,
        server_version: 1,
      },
      subject_json: { handoff_id: 'handoff_1' },
    },
    ...overrides,
  };
}

function transitionTransaction(
  overrides: Partial<DynamoHandoffTransitionTransaction> = {},
): DynamoHandoffTransitionTransaction {
  return {
    table_name: 'phos_core',
    partition_key: 'TENANT#tenant_abc123',
    handoff_sort_key: 'HANDOFF#handoff_1',
    queue_gsi_pk: 'TENANT#tenant_abc123#HANDOFF_ASSIGNEE#user_pharmacist',
    idempotency_sort_key: 'HANDOFF_IDEMPOTENCY#RESOLVE_HANDOFF:handoff_1#idem_resolve',
    idempotency_key: 'idem_resolve',
    expected_server_version: 1,
    request_fingerprint: 'fp_resolve',
    response: response(
      handoff({
        status: HandoffStatus.RESOLVED,
        resolved_action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        server_version: 2,
      }),
    ),
    audit_event: {
      event_id: 'HANDOFF_RESOLVED#idem_resolve',
      event_type: 'HANDOFF_RESOLVED',
      card_id: 'card_1',
      action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
      actor_user_id: 'user_pharmacist',
      request_id: 'req_1',
      correlation_id: 'corr_1',
      before_json: {
        handoff_id: 'handoff_1',
        card_id: 'card_1',
        status: HandoffStatus.OPEN,
        server_version: 1,
      },
      after_json: {
        handoff_id: 'handoff_1',
        card_id: 'card_1',
        status: HandoffStatus.RESOLVED,
        server_version: 2,
      },
      subject_json: { handoff_id: 'handoff_1' },
    },
    blocker_resolution: { card_id: 'card_1', blocker_code: 'MISSING_EVIDENCE' },
    card_aggregate_update: {
      card_sort_key: 'CARD#card_1',
      expected_card_server_version: 3,
      update: {
        card: {
          card_id: 'card_1',
          card_type: CardType.PRESCRIPTION,
          patient_name: '患者 山田太郎',
          current_step: CurrentStep.DIFF_REVIEW,
          display_status: DisplayStatus.READY,
          server_version: 4,
          tags: [],
        },
        blockers: [],
        next_action: {
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
        },
        server_version: 4,
      },
    },
    ...overrides,
  };
}

describe('Dynamo handoff transaction client', () => {
  it('builds a create transaction with queue GSI and saved idempotency response', () => {
    const items = buildDynamoHandoffCreateTransactWriteItems(
      createTransaction(),
      '2026-06-09T00:00:00.000Z',
    );

    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({
      ConditionCheck: {
        TableName: 'phos_core',
        Key: {
          PK: { S: 'TENANT#tenant_abc123' },
          SK: { S: 'CARD#card_1' },
        },
        ConditionExpression: '#server_version = :expected_card_server_version',
        ExpressionAttributeValues: {
          ':expected_card_server_version': { N: '1' },
        },
      },
    });
    expect(items[1]).toMatchObject({
      Put: {
        TableName: 'phos_core',
        Item: {
          PK: { S: 'TENANT#tenant_abc123' },
          SK: { S: 'HANDOFF#handoff_1' },
          entity_type: { S: 'HANDOFF' },
          GSI1PK: { S: 'TENANT#tenant_abc123#HANDOFF_ASSIGNEE#user_pharmacist' },
          GSI1SK: {
            S: 'STATUS#OPEN#URGENCY#0#CREATED#2026-06-09T00:00:00.000Z#HANDOFF#handoff_1',
          },
          status: { S: HandoffStatus.OPEN },
          urgency_rank: { N: '0' },
          server_version: { N: '1' },
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    });
    expect(items[2]).toMatchObject({
      Put: {
        Item: {
          PK: { S: 'TENANT#tenant_abc123' },
          SK: {
            S: 'CARD_EVENT#card_1#2026-06-09T00:00:00.000Z#HANDOFF_CREATED#idem_create',
          },
          entity_type: { S: 'CARD_EVENT' },
          event_type: { S: 'HANDOFF_CREATED' },
          actor_user_id: { S: 'user_clerk' },
          request_id: { S: 'req_1' },
          correlation_id: { S: 'corr_1' },
          before_json: { NULL: true },
        },
      },
    });
    expect(JSON.stringify(items[2])).not.toContain('患者 山田太郎');
    expect(JSON.stringify(items[2])).not.toContain('薬剤師確認が必要です。');
    expect(items[3]).toMatchObject({
      Put: {
        Item: {
          SK: { S: 'HANDOFF_IDEMPOTENCY#CREATE_HANDOFF:card_1#idem_create' },
          entity_type: { S: 'HANDOFF_IDEMPOTENCY' },
          idempotency_key: { S: 'idem_create' },
          request_fingerprint: { S: 'fp_create' },
          response_json: { S: JSON.stringify(response()) },
        },
      },
    });
  });

  it('builds a conditional transition and resolves the related blocker in one transaction', () => {
    const items = buildDynamoHandoffTransitionTransactWriteItems(
      transitionTransaction(),
      '2026-06-09T00:00:00.000Z',
    );

    expect(items).toHaveLength(5);
    expect(items[0]).toMatchObject({
      Update: {
        TableName: 'phos_core',
        Key: {
          PK: { S: 'TENANT#tenant_abc123' },
          SK: { S: 'HANDOFF#handoff_1' },
        },
        ConditionExpression: '#server_version = :expected_server_version',
        ExpressionAttributeValues: {
          ':expected_server_version': { N: '1' },
          ':server_version': { N: '2' },
          ':status': { S: HandoffStatus.RESOLVED },
          ':gsi1sk': {
            S: 'STATUS#RESOLVED#URGENCY#0#CREATED#2026-06-09T00:00:00.000Z#HANDOFF#handoff_1',
          },
        },
      },
    });
    expect(items[1]).toMatchObject({
      Update: {
        TableName: 'phos_core',
        Key: {
          PK: { S: 'TENANT#tenant_abc123' },
          SK: { S: 'CARD_BLOCKER#card_1#MISSING_EVIDENCE' },
        },
        ConditionExpression: 'attribute_exists(PK)',
      },
    });
    expect(items[2]).toMatchObject({
      Update: {
        TableName: 'phos_core',
        Key: {
          PK: { S: 'TENANT#tenant_abc123' },
          SK: { S: 'CARD#card_1' },
        },
        ConditionExpression: '#server_version = :expected_card_server_version',
        ExpressionAttributeValues: {
          ':expected_card_server_version': { N: '3' },
          ':card_server_version': { N: '4' },
          ':card_display_status': { S: DisplayStatus.READY },
        },
      },
    });
    expect(items[3]).toMatchObject({
      Put: {
        Item: {
          SK: {
            S: 'CARD_EVENT#card_1#2026-06-09T00:00:00.000Z#HANDOFF_RESOLVED#idem_resolve',
          },
          entity_type: { S: 'CARD_EVENT' },
          event_type: { S: 'HANDOFF_RESOLVED' },
          action_code: { S: ActionCode.CONFIRM_PRESCRIPTION_DIFF },
          actor_user_id: { S: 'user_pharmacist' },
          before_json: {
            M: expect.objectContaining({
              status: { S: HandoffStatus.OPEN },
              server_version: { N: '1' },
            }),
          },
          after_json: {
            M: expect.objectContaining({
              status: { S: HandoffStatus.RESOLVED },
              server_version: { N: '2' },
            }),
          },
        },
      },
    });
    expect(items[4]).toMatchObject({
      Put: {
        Item: {
          SK: { S: 'HANDOFF_IDEMPOTENCY#RESOLVE_HANDOFF:handoff_1#idem_resolve' },
          idempotency_key: { S: 'idem_resolve' },
        },
      },
    });
  });

  it('sends TransactWriteItemsCommand through the provided DynamoDB client', async () => {
    const send = vi.fn(async (sentCommand: TransactWriteItemsCommand) => {
      expect(sentCommand).toBeDefined();
      return {};
    });
    const client = createDynamoHandoffTransactionClient({
      client: { send },
      now: () => new Date('2026-06-09T00:00:00.000Z'),
    });

    await client.transactCreateHandoff(createTransaction());
    await client.transactCommitHandoffTransition(
      transitionTransaction({ blocker_resolution: undefined, card_aggregate_update: undefined }),
    );

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(TransactWriteItemsCommand);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(TransactWriteItemsCommand);
    const transitionCommand = send.mock.calls[1]?.[0] as TransactWriteItemsCommand | undefined;
    expect(transitionCommand?.input.TransactItems).toHaveLength(3);
  });
});
