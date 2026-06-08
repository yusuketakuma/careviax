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
  CardSummaryView,
  ReportDeliveryView,
} from '@/phos/contracts/phos_contracts';
import { ACTION_TRANSITION_MATRIX } from '@/phos/domain/actions/actionTransitionMatrix';
import {
  createDynamoCardActionExecutionStore,
  type DynamoCardActionStoreClient,
  type DynamoCardActionStoreMapper,
} from './dynamo-card-action-store';
import { PHOS_CORE_TABLE } from './dynamo-cards-repository';
import type { CardActionExecutionState } from './card-action-executor';
import type { TenantContext } from './tenant-context';

type StateItem = { id: string; version: number };
type IdempotencyItem = { fingerprint: string; saved?: ActionResponse };

const ctx: TenantContext = {
  tenant_id: 'tenant_abc123',
  user_id: 'user_1',
  role: UserRole.PHARMACIST,
  request_id: 'req_1',
  correlation_id: 'corr_1',
  scopes: ['phos/cards.write'],
};

function card(overrides: Partial<CardSummaryView> = {}): CardSummaryView {
  return {
    card_id: 'card_1',
    card_type: CardType.PRESCRIPTION,
    patient_name: 'Test Patient',
    current_step: CurrentStep.DIFF_REVIEW,
    display_status: DisplayStatus.READY,
    server_version: 3,
    tags: [],
    ...overrides,
  };
}

function actionResponse(): ActionResponse {
  const updatedCard = card({
    current_step: CurrentStep.DISPENSING,
    display_status: DisplayStatus.IN_PROGRESS,
    server_version: 4,
  });
  return {
    card: updatedCard,
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
    display_status: updatedCard.display_status,
    blockers: [],
    side_effects: [],
    server_version: updatedCard.server_version,
  };
}

function blocker(overrides: Partial<BlockerView> = {}): BlockerView {
  return {
    blocker_code: 'MISSING_EVIDENCE',
    severity: BlockerSeverity.ERROR,
    owner_role: UserRole.PHARMACIST,
    message_key: 'blocker.missing_evidence',
    active: true,
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

const mapper: DynamoCardActionStoreMapper<StateItem, IdempotencyItem> = {
  toActionState: (item): CardActionExecutionState => ({
    card: card({ card_id: item.id, server_version: item.version }),
    next_action: {
      code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
      kind: ActionKind.STEP_CHANGING,
      label_key: 'action.confirm_prescription_diff',
      enabled: true,
      offline_allowed: false,
      priority: 'PRIMARY',
      required_role: [UserRole.PHARMACIST],
      target_endpoint: `/cards/${item.id}/actions`,
      ui_state: ButtonState.ACTIONABLE,
      can_user_handle: true,
    },
    blockers: [],
    unresolved_claim_candidate_count: 0,
    allowed_actions: [ActionCode.CONFIRM_PRESCRIPTION_DIFF],
  }),
  toIdempotencyRecord: (item) => ({
    request_fingerprint: item.fingerprint,
    response: item.saved,
  }),
  toCommitProjection: () => ({
    server_version: 4,
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
    display_context: {
      canceled_at: null,
      has_open_rejected_audit: false,
      has_active_in_progress_task: true,
      primary_action_authorized: true,
    },
  }),
};

function client(
  overrides: Partial<DynamoCardActionStoreClient<StateItem, IdempotencyItem>> = {},
): DynamoCardActionStoreClient<StateItem, IdempotencyItem> {
  return {
    getActionState: vi.fn(async () => ({ id: 'card_1', version: 3 })),
    getIdempotency: vi.fn(async () => null),
    transactCommitAction: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('createDynamoCardActionExecutionStore', () => {
  it('looks up idempotency records under the tenant PK and action ledger SK', async () => {
    const saved = actionResponse();
    const fakeClient = client({
      getIdempotency: vi.fn(async () => ({ fingerprint: 'fp_1', saved })),
    });
    const store = createDynamoCardActionExecutionStore(fakeClient, mapper);

    const result = await store.getIdempotentAction(ctx, 'card_1', 'idem_1', 'fp_1');

    expect(fakeClient.getIdempotency).toHaveBeenCalledWith({
      table_name: PHOS_CORE_TABLE,
      partition_key: 'TENANT#tenant_abc123',
      sort_key: 'CARD_ACTION_IDEMPOTENCY#card_1#idem_1',
    });
    expect(result).toEqual({ status: 'MATCH', response: saved });
  });

  it('treats the same idempotency key with a different request fingerprint as conflict', async () => {
    const fakeClient = client({
      getIdempotency: vi.fn(async () => ({ fingerprint: 'previous' })),
    });
    const store = createDynamoCardActionExecutionStore(fakeClient, mapper);

    await expect(store.getIdempotentAction(ctx, 'card_1', 'idem_1', 'new')).resolves.toEqual({
      status: 'CONFLICT',
      existing_request_fingerprint: 'previous',
    });
  });

  it('loads card action state through tenant PK and card SK', async () => {
    const fakeClient = client();
    const store = createDynamoCardActionExecutionStore(fakeClient, mapper);

    const result = await store.loadActionState(ctx, 'card_1');

    expect(fakeClient.getActionState).toHaveBeenCalledWith({
      table_name: PHOS_CORE_TABLE,
      partition_key: 'TENANT#tenant_abc123',
      sort_key: 'CARD#card_1',
    });
    expect(result?.card.server_version).toBe(3);
  });

  it('commits action updates as a tenant-scoped conditional transaction contract', async () => {
    const fakeClient = client();
    const store = createDynamoCardActionExecutionStore(fakeClient, mapper);
    const previousState = mapper.toActionState({ id: 'card_1', version: 3 });

    const result = await store.commitAction(ctx, {
      card_id: 'card_1',
      command: {
        action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        idempotency_key: 'idem_1',
        client_version: 3,
      },
      request_fingerprint: 'fp_1',
      previous_state: previousState,
      transition: ACTION_TRANSITION_MATRIX[ActionCode.CONFIRM_PRESCRIPTION_DIFF],
    });

    expect(fakeClient.transactCommitAction).toHaveBeenCalledWith({
      table_name: PHOS_CORE_TABLE,
      partition_key: 'TENANT#tenant_abc123',
      card_sort_key: 'CARD#card_1',
      idempotency_sort_key: 'CARD_ACTION_IDEMPOTENCY#card_1#idem_1',
      blocker_puts: [],
      blocker_resolutions: [],
      report_delivery_puts: [],
      expected_server_version: 3,
      request_fingerprint: 'fp_1',
      command: {
        action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        idempotency_key: 'idem_1',
        client_version: 3,
      },
      transition: ACTION_TRANSITION_MATRIX[ActionCode.CONFIRM_PRESCRIPTION_DIFF],
      projected_response: result,
    });
    expect(result).toMatchObject({
      card: { current_step: CurrentStep.DISPENSING, display_status: DisplayStatus.IN_PROGRESS },
      display_status: DisplayStatus.IN_PROGRESS,
      server_version: 4,
    });
  });

  it('includes blocker writes and the saved blocked ActionResponse in one transaction contract', async () => {
    const missingEvidence = blocker();
    const fakeClient = client();
    const blockedMapper: DynamoCardActionStoreMapper<StateItem, IdempotencyItem> = {
      ...mapper,
      toCommitProjection: () => ({
        server_version: 4,
        current_step_override: CurrentStep.DIFF_REVIEW,
        next_action: {
          code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
          kind: ActionKind.STEP_CHANGING,
          label_key: 'action.confirm_prescription_diff',
          enabled: true,
          offline_allowed: false,
          priority: 'PRIMARY',
          required_role: [UserRole.PHARMACIST],
          target_endpoint: '/cards/card_1/actions',
          ui_state: ButtonState.RESOLVABLE_BLOCK,
          can_user_handle: true,
        },
        blocker_changes: { created: [missingEvidence] },
        display_context: {
          canceled_at: null,
          has_open_rejected_audit: false,
          has_active_in_progress_task: false,
          primary_action_authorized: true,
        },
      }),
    };
    const store = createDynamoCardActionExecutionStore(fakeClient, blockedMapper);
    const previousState = mapper.toActionState({ id: 'card_1', version: 3 });

    const result = await store.commitAction(ctx, {
      card_id: 'card_1',
      command: {
        action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        idempotency_key: 'idem_2',
        client_version: 3,
      },
      request_fingerprint: 'fp_2',
      previous_state: previousState,
      transition: ACTION_TRANSITION_MATRIX[ActionCode.CONFIRM_PRESCRIPTION_DIFF],
    });

    expect(result.display_status).toBe(DisplayStatus.BLOCKED);
    expect(fakeClient.transactCommitAction).toHaveBeenCalledWith(
      expect.objectContaining({
        blocker_puts: [
          {
            sort_key: 'CARD_BLOCKER#card_1#MISSING_EVIDENCE',
            blocker: missingEvidence,
          },
        ],
        blocker_resolutions: [],
        report_delivery_puts: [],
        projected_response: result,
      }),
    );
  });

  it('maps SEND_REPORT delivery queue projections to tenant-scoped report delivery keys', async () => {
    const delivery = reportDelivery();
    const fakeClient = client();
    const sendReportMapper: DynamoCardActionStoreMapper<StateItem, IdempotencyItem> = {
      ...mapper,
      toCommitProjection: () => ({
        server_version: 4,
        current_step_override: CurrentStep.CLAIM_REVIEW,
        next_action: {
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
        },
        report_delivery_puts: [delivery],
        side_effects: [{ type: 'REPORT_QUEUED', delivery_id: delivery.delivery_id }],
        display_context: {
          canceled_at: null,
          has_open_rejected_audit: false,
          has_active_in_progress_task: false,
          primary_action_authorized: true,
        },
      }),
    };
    const store = createDynamoCardActionExecutionStore(fakeClient, sendReportMapper);
    const previousState = mapper.toActionState({ id: 'card_1', version: 3 });

    const result = await store.commitAction(ctx, {
      card_id: 'card_1',
      command: {
        action_code: ActionCode.SEND_REPORT,
        idempotency_key: 'idem_send_report',
        client_version: 3,
      },
      request_fingerprint: 'fp_send_report',
      previous_state: previousState,
      transition: ACTION_TRANSITION_MATRIX[ActionCode.SEND_REPORT],
    });

    expect(result.side_effects).toEqual([{ type: 'REPORT_QUEUED', delivery_id: 'delivery_1' }]);
    expect(fakeClient.transactCommitAction).toHaveBeenCalledWith(
      expect.objectContaining({
        report_delivery_puts: [
          {
            sort_key: 'REPORT_DELIVERY#delivery_1',
            status_gsi_pk: 'TENANT#tenant_abc123#REPORT_DELIVERY_STATUS#WAITING_REPLY',
            status_gsi_sk: 'STALE#00000090#SENT#2026-06-09T00:00:00.000Z#DELIVERY#delivery_1',
            delivery,
          },
        ],
        projected_response: result,
      }),
    );
  });

  it('adds an atomic zero-unresolved guard for REVIEW_CLAIM_CANDIDATES commits only', async () => {
    const fakeClient = client();
    const claimReviewMapper: DynamoCardActionStoreMapper<StateItem, IdempotencyItem> = {
      ...mapper,
      toActionState: (item): CardActionExecutionState => ({
        ...mapper.toActionState(item),
        card: card({
          card_id: item.id,
          current_step: CurrentStep.CLAIM_REVIEW,
          server_version: item.version,
        }),
        next_action: {
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
        },
        unresolved_claim_candidate_count: 0,
        allowed_actions: [ActionCode.REVIEW_CLAIM_CANDIDATES],
      }),
      toCommitProjection: () => ({
        server_version: 4,
        current_step_override: CurrentStep.CLOSING,
        next_action: {
          code: ActionCode.CLOSE_CARD,
          kind: ActionKind.STEP_CHANGING,
          label_key: 'action.close_card',
          enabled: true,
          offline_allowed: false,
          priority: 'PRIMARY',
          required_role: [UserRole.PHARMACIST],
          target_endpoint: '/cards/card_1/actions',
          ui_state: ButtonState.ACTIONABLE,
          can_user_handle: true,
        },
        side_effects: [{ type: 'CLAIM_RECALCULATED', card_id: 'card_1' }],
        display_context: {
          canceled_at: null,
          has_open_rejected_audit: false,
          has_active_in_progress_task: false,
          primary_action_authorized: true,
        },
      }),
    };
    const store = createDynamoCardActionExecutionStore(fakeClient, claimReviewMapper);
    const previousState = claimReviewMapper.toActionState({ id: 'card_1', version: 3 });

    const result = await store.commitAction(ctx, {
      card_id: 'card_1',
      command: {
        action_code: ActionCode.REVIEW_CLAIM_CANDIDATES,
        idempotency_key: 'idem_claim_review',
        client_version: 3,
      },
      request_fingerprint: 'fp_claim_review',
      previous_state: previousState,
      transition: ACTION_TRANSITION_MATRIX[ActionCode.REVIEW_CLAIM_CANDIDATES],
    });

    expect(result.card.current_step).toBe(CurrentStep.CLOSING);
    expect(fakeClient.transactCommitAction).toHaveBeenCalledWith(
      expect.objectContaining({
        claim_review_guard: { unresolved_claim_candidate_count: 0 },
      }),
    );
  });
});
