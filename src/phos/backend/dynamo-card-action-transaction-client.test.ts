import { TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import {
  ActionCode,
  ActionKind,
  BlockerSeverity,
  ButtonState,
  CardType,
  CurrentStep,
  DisplayStatus,
  ReportDeliveryStatus,
  UserRole,
} from '@/phos/contracts/phos_contracts';
import type {
  ActionResponse,
  BlockerView,
  ReportDeliveryView,
} from '@/phos/contracts/phos_contracts';
import { ACTION_TRANSITION_MATRIX } from '@/phos/domain/actions/actionTransitionMatrix';
import type { DynamoActionCommitTransaction } from './dynamo-card-action-store';
import {
  buildDynamoActionCommitTransactWriteItems,
  createDynamoCardActionTransactionClient,
} from './dynamo-card-action-transaction-client';

function blocker(): BlockerView {
  return {
    blocker_code: 'MISSING_EVIDENCE',
    severity: BlockerSeverity.ERROR,
    owner_role: UserRole.PHARMACIST,
    message_key: 'blocker.missing_evidence',
    active: true,
  };
}

function response(overrides: Partial<ActionResponse> = {}): ActionResponse {
  const card = {
    card_id: 'card_1',
    card_type: CardType.PRESCRIPTION,
    patient_name: 'Test Patient',
    current_step: CurrentStep.DISPENSING,
    display_status: DisplayStatus.IN_PROGRESS,
    server_version: 4,
    tags: [],
  };
  return {
    card,
    next_action: {
      code: ActionCode.START_DISPENSING,
      kind: ActionKind.INTRA_STEP,
      label_key: 'action.start_dispensing',
      enabled: true,
      offline_allowed: false,
      priority: 'PRIMARY',
      required_role: [UserRole.PHARMACIST],
      target_endpoint: '/cards/card_1/actions',
      ui_state: ButtonState.ACTIONABLE,
      can_user_handle: true,
    },
    display_status: card.display_status,
    blockers: [],
    side_effects: [],
    server_version: card.server_version,
    ...overrides,
  };
}

function reportDelivery(): ReportDeliveryView {
  return {
    delivery_id: 'delivery_1',
    card_id: 'card_1',
    report_id: 'report_1',
    patient_name: 'Test Patient',
    target_label: '居宅介護支援事業所',
    sent_at: '2026-06-09T00:00:00.000Z',
    stale_minutes: 90,
    status: ReportDeliveryStatus.WAITING_REPLY,
    delivery_method: 'FAX',
    server_version: 1,
    source_refs: [{ kind: 'EVIDENCE_FILE', ref_id: 'report_1', label: '報告書' }],
  };
}

function transaction(
  overrides: Partial<DynamoActionCommitTransaction> = {},
): DynamoActionCommitTransaction {
  return {
    table_name: 'phos_core',
    partition_key: 'TENANT#tenant_abc123',
    card_sort_key: 'CARD#card_1',
    idempotency_sort_key: 'CARD_ACTION_IDEMPOTENCY#card_1#idem_1',
    blocker_puts: [],
    blocker_resolutions: [],
    report_delivery_puts: [],
    audit_event: {
      event_id: 'CONFIRM_PRESCRIPTION_DIFF#idem_1',
      event_type: 'CARD_ACTION_EXECUTED',
      action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
      actor_user_id: 'user_1',
      request_id: 'req_1',
      correlation_id: 'corr_1',
      before_card: {
        ...response().card,
        current_step: CurrentStep.DIFF_REVIEW,
        server_version: 3,
      },
      after_card: response().card,
    },
    expected_server_version: 3,
    request_fingerprint: 'fp_1',
    command: {
      action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
      idempotency_key: 'idem_1',
      client_version: 3,
    },
    transition: ACTION_TRANSITION_MATRIX[ActionCode.CONFIRM_PRESCRIPTION_DIFF],
    projected_response: response(),
    ...overrides,
  };
}

describe('Dynamo card action transaction client', () => {
  it('builds a conditional card update and saved idempotency response in one transaction', () => {
    const items = buildDynamoActionCommitTransactWriteItems(
      transaction(),
      '2026-06-09T00:00:00.000Z',
    );

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      Update: {
        TableName: 'phos_core',
        Key: {
          PK: { S: 'TENANT#tenant_abc123' },
          SK: { S: 'CARD#card_1' },
        },
        ConditionExpression: '#server_version = :expected_server_version',
        ExpressionAttributeValues: {
          ':expected_server_version': { N: '3' },
          ':server_version': { N: '4' },
          ':current_step': { S: CurrentStep.DISPENSING },
          ':display_status': { S: DisplayStatus.IN_PROGRESS },
          ':action_code': { S: ActionCode.CONFIRM_PRESCRIPTION_DIFF },
        },
      },
    });
    expect(items[1]).toMatchObject({
      Put: {
        TableName: 'phos_core',
        Item: {
          PK: { S: 'TENANT#tenant_abc123' },
          SK: {
            S: 'CARD_EVENT#card_1#2026-06-09T00:00:00.000Z#CONFIRM_PRESCRIPTION_DIFF#idem_1',
          },
          entity_type: { S: 'CARD_EVENT' },
          event_type: { S: 'CARD_ACTION_EXECUTED' },
          action_code: { S: ActionCode.CONFIRM_PRESCRIPTION_DIFF },
          actor_user_id: { S: 'user_1' },
          request_id: { S: 'req_1' },
          correlation_id: { S: 'corr_1' },
        },
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      },
    });
    expect(items[2]).toMatchObject({
      Put: {
        TableName: 'phos_core',
        Item: {
          PK: { S: 'TENANT#tenant_abc123' },
          SK: { S: 'CARD_ACTION_IDEMPOTENCY#card_1#idem_1' },
          entity_type: { S: 'CARD_ACTION_IDEMPOTENCY' },
          request_fingerprint: { S: 'fp_1' },
          response_json: { S: JSON.stringify(response()) },
        },
        ConditionExpression:
          'attribute_not_exists(PK) OR request_fingerprint = :request_fingerprint',
      },
    });
  });

  it('includes blocker writes and resolutions in the same tenant-scoped transaction', () => {
    const missingEvidence = blocker();
    const items = buildDynamoActionCommitTransactWriteItems(
      transaction({
        projected_response: response({
          card: {
            ...response().card,
            current_step: CurrentStep.DIFF_REVIEW,
            display_status: DisplayStatus.BLOCKED,
          },
          display_status: DisplayStatus.BLOCKED,
          blockers: [missingEvidence],
          side_effects: [
            {
              type: 'BLOCKER_CREATED',
              blocker_code: 'MISSING_EVIDENCE',
              severity: BlockerSeverity.ERROR,
            },
          ],
        }),
        blocker_puts: [
          { sort_key: 'CARD_BLOCKER#card_1#MISSING_EVIDENCE', blocker: missingEvidence },
        ],
        blocker_resolutions: [
          { sort_key: 'CARD_BLOCKER#card_1#OLD_BLOCKER', blocker_code: 'OLD_BLOCKER' },
        ],
      }),
      '2026-06-09T00:00:00.000Z',
    );

    expect(items).toHaveLength(5);
    expect(items[1]).toMatchObject({
      Put: {
        TableName: 'phos_core',
        Item: {
          PK: { S: 'TENANT#tenant_abc123' },
          SK: { S: 'CARD_BLOCKER#card_1#MISSING_EVIDENCE' },
          entity_type: { S: 'CARD_BLOCKER' },
          blocker_code: { S: 'MISSING_EVIDENCE' },
          active: { BOOL: true },
        },
      },
    });
    expect(items[2]).toMatchObject({
      Update: {
        TableName: 'phos_core',
        Key: {
          PK: { S: 'TENANT#tenant_abc123' },
          SK: { S: 'CARD_BLOCKER#card_1#OLD_BLOCKER' },
        },
        ConditionExpression: 'attribute_exists(PK)',
      },
    });
  });

  it('includes report delivery queue writes in the same card action transaction', () => {
    const delivery = reportDelivery();
    const projectedResponse = response({
      side_effects: [{ type: 'REPORT_QUEUED', delivery_id: delivery.delivery_id }],
    });
    const items = buildDynamoActionCommitTransactWriteItems(
      transaction({
        idempotency_sort_key: 'CARD_ACTION_IDEMPOTENCY#card_1#idem_send_report',
        command: {
          action_code: ActionCode.SEND_REPORT,
          idempotency_key: 'idem_send_report',
          client_version: 3,
        },
        transition: ACTION_TRANSITION_MATRIX[ActionCode.SEND_REPORT],
        projected_response: projectedResponse,
        report_delivery_puts: [
          {
            sort_key: 'REPORT_DELIVERY#delivery_1',
            status_gsi_pk: 'TENANT#tenant_abc123#REPORT_DELIVERY_STATUS#WAITING_REPLY',
            status_gsi_sk: 'STALE#00000090#SENT#2026-06-09T00:00:00.000Z#DELIVERY#delivery_1',
            delivery,
          },
        ],
      }),
      '2026-06-09T00:00:00.000Z',
    );

    expect(items).toHaveLength(4);
    expect(items[1]).toMatchObject({
      Put: {
        TableName: 'phos_core',
        Item: {
          PK: { S: 'TENANT#tenant_abc123' },
          SK: { S: 'REPORT_DELIVERY#delivery_1' },
          entity_type: { S: 'REPORT_DELIVERY' },
          card_id: { S: 'card_1' },
          report_id: { S: 'report_1' },
          delivery_id: { S: 'delivery_1' },
          status: { S: ReportDeliveryStatus.WAITING_REPLY },
          GSI6PK: { S: 'TENANT#tenant_abc123#REPORT_DELIVERY_STATUS#WAITING_REPLY' },
          GSI6SK: {
            S: 'STALE#00000090#SENT#2026-06-09T00:00:00.000Z#DELIVERY#delivery_1',
          },
        },
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      },
    });
    expect(items[3]).toMatchObject({
      Put: {
        Item: {
          SK: { S: 'CARD_ACTION_IDEMPOTENCY#card_1#idem_send_report' },
          response_json: { S: JSON.stringify(projectedResponse) },
        },
      },
    });
  });

  it('adds an unresolved claim candidate zero condition for claim review commits', () => {
    const items = buildDynamoActionCommitTransactWriteItems(
      transaction({
        command: {
          action_code: ActionCode.REVIEW_CLAIM_CANDIDATES,
          idempotency_key: 'idem_claim_review',
          client_version: 3,
        },
        transition: ACTION_TRANSITION_MATRIX[ActionCode.REVIEW_CLAIM_CANDIDATES],
        projected_response: response({
          card: {
            ...response().card,
            current_step: CurrentStep.CLOSING,
            display_status: DisplayStatus.READY,
          },
          display_status: DisplayStatus.READY,
          side_effects: [{ type: 'CLAIM_RECALCULATED', card_id: 'card_1' }],
        }),
        claim_review_guard: { unresolved_claim_candidate_count: 0 },
      }),
      '2026-06-09T00:00:00.000Z',
    );

    expect(items[0]).toMatchObject({
      Update: {
        ConditionExpression:
          '#server_version = :expected_server_version AND attribute_exists(#unresolved_claim_candidate_count) AND #unresolved_claim_candidate_count = :zero_unresolved_claim_candidate_count',
        ExpressionAttributeNames: {
          '#unresolved_claim_candidate_count': 'unresolved_claim_candidate_count',
        },
        ExpressionAttributeValues: {
          ':zero_unresolved_claim_candidate_count': { N: '0' },
        },
      },
    });
  });

  it('sends TransactWriteItemsCommand through the provided DynamoDB client', async () => {
    const send = vi.fn(async (sentCommand: TransactWriteItemsCommand) => {
      expect(sentCommand).toBeDefined();
      return {};
    });
    const client = createDynamoCardActionTransactionClient({
      client: { send },
      now: () => new Date('2026-06-09T00:00:00.000Z'),
    });

    await client.transactCommitAction(transaction());

    expect(send).toHaveBeenCalledOnce();
    const command = send.mock.calls[0]?.[0];
    if (!command) throw new Error('Expected TransactWriteItemsCommand');
    expect(command).toBeInstanceOf(TransactWriteItemsCommand);
    expect(command.input.TransactItems).toHaveLength(3);
  });
});
