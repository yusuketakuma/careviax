import { describe, expect, it, vi } from 'vitest';
import {
  ActionCode,
  ActionKind,
  BlockerSeverity,
  ButtonState,
  CardType,
  CurrentStep,
  DisplayStatus,
  HandoffStatus,
  HandoffUrgency,
  UserRole,
} from '@/phos/contracts/phos_contracts';
import type { HandoffMutationResponse, HandoffView } from '@/phos/contracts/phos_contracts';
import {
  createDynamoHandoffLifecycleStore,
  type DynamoHandoffStoreClient,
  type DynamoHandoffStoreMapper,
} from './dynamo-handoff-lifecycle-store';
import { PHOS_CORE_TABLE, PHOS_HANDOFF_QUEUE_GSI } from './dynamo-cards-repository';
import type { TenantContext } from './tenant-context';

type HandoffItem = { id: string; status: HandoffStatus; version: number };
type CardContextItem = { card_id: string; patient_name: string; version: number };
type IdempotencyItem = {
  actor?: string;
  fingerprint: string;
  saved?: HandoffMutationResponse;
};

const ctx: TenantContext = {
  tenant_id: 'tenant_abc123',
  user_id: 'user_pharmacist',
  role: UserRole.PHARMACIST,
  request_id: 'req_1',
  correlation_id: 'corr_1',
  scopes: ['phos/handoffs.read', 'phos/handoffs.write'],
};

function handoff(overrides: Partial<HandoffView> = {}): HandoffView {
  return {
    handoff_id: 'handoff_1',
    card_id: 'card_1',
    status: HandoffStatus.OPEN,
    reason_code: 'DIFF_REVIEW',
    summary: '薬剤師確認が必要です。',
    source_refs: [{ kind: 'PRESCRIPTION', ref_id: 'rx_1', label: '処方箋 1' }],
    requested_action: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
    urgency: HandoffUrgency.HIGH,
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

function mutationResponse(next: HandoffView): HandoffMutationResponse {
  return {
    handoff: next,
    side_effects:
      next.status === HandoffStatus.RESOLVED
        ? [{ type: 'BLOCKER_RESOLVED', blocker_code: 'MISSING_EVIDENCE' }]
        : [],
    server_version: next.server_version,
  };
}

const mapper: DynamoHandoffStoreMapper<HandoffItem | CardContextItem, IdempotencyItem> = {
  toHandoffView: (item) =>
    'id' in item
      ? handoff({ handoff_id: item.id, status: item.status, server_version: item.version })
      : handoff(),
  toCreateCardContext: (item) => ({
    card_id: 'card_id' in item ? item.card_id : 'card_1',
    patient_name: 'patient_name' in item ? item.patient_name : '患者 山田太郎',
    server_version: item.version,
    pharmacist_assignee_user_id: 'user_pharmacist',
  }),
  toHandoffCardState: (item) => ({
    state: {
      card: {
        card_id: 'card_id' in item ? item.card_id : 'card_1',
        card_type: CardType.PRESCRIPTION,
        patient_name: 'patient_name' in item ? item.patient_name : '患者 山田太郎',
        current_step: CurrentStep.DIFF_REVIEW,
        display_status: DisplayStatus.BLOCKED,
        server_version: item.version,
        tags: [],
      },
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
      blockers: [
        {
          blocker_code: 'MISSING_EVIDENCE',
          severity: BlockerSeverity.ERROR,
          owner_role: UserRole.PHARMACIST,
          message_key: 'blocker.missing_evidence',
          active: true,
        },
      ],
      unresolved_claim_candidate_count: 0,
    },
    display_context: {
      canceled_at: null,
      has_open_rejected_audit: false,
      has_active_in_progress_task: false,
      primary_action_authorized: true,
    },
  }),
  toIdempotencyRecord: (item) => ({
    actor_user_id: item.actor,
    request_fingerprint: item.fingerprint,
    response: item.saved,
  }),
  toCreateResponse: ({ ctx: tenantCtx, command, card_context, handoff_id, created_at }) =>
    mutationResponse(
      handoff({
        handoff_id,
        card_id: command.card_id,
        status: HandoffStatus.OPEN,
        reason_code: command.reason_code,
        summary: command.summary,
        source_refs: command.source_refs,
        urgency: command.urgency,
        related_blocker_code: command.related_blocker_code,
        created_by_user_id: tenantCtx.user_id,
        assignee_user_id:
          command.assignee_user_id ?? card_context.pharmacist_assignee_user_id ?? tenantCtx.user_id,
        patient_name: card_context.patient_name,
        created_at,
        updated_at: created_at,
      }),
    ),
};

function client(
  overrides: Partial<DynamoHandoffStoreClient<HandoffItem | CardContextItem, IdempotencyItem>> = {},
): DynamoHandoffStoreClient<HandoffItem | CardContextItem, IdempotencyItem> {
  return {
    queryHandoffs: vi.fn(async () => ({
      items: [{ id: 'handoff_1', status: HandoffStatus.OPEN, version: 1 }],
    })),
    getHandoff: vi.fn(async () => ({ id: 'handoff_1', status: HandoffStatus.OPEN, version: 1 })),
    getCreateCardContext: vi.fn(async () => ({
      card_id: 'card_1',
      patient_name: '患者 山田太郎',
      version: 1,
    })),
    getHandoffCardState: vi.fn(async () => ({
      card_id: 'card_1',
      patient_name: '患者 山田太郎',
      version: 3,
    })),
    getIdempotency: vi.fn(async () => null),
    transactCreateHandoff: vi.fn(async () => {}),
    transactCommitHandoffTransition: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('createDynamoHandoffLifecycleStore', () => {
  it('queries handoff queue through tenant-scoped assignee GSI without scans', async () => {
    const fakeClient = client();
    const store = createDynamoHandoffLifecycleStore(fakeClient, mapper, {
      now: () => new Date('2026-06-09T00:00:00.000Z'),
    });

    const result = await store.searchHandoffs(ctx, {
      status: HandoffStatus.OPEN,
      assignee: 'ME',
      limit: 25,
    });

    expect(fakeClient.queryHandoffs).toHaveBeenCalledWith({
      table_name: PHOS_CORE_TABLE,
      index_name: PHOS_HANDOFF_QUEUE_GSI,
      partition_key: 'TENANT#tenant_abc123#HANDOFF_ASSIGNEE#user_pharmacist',
      key_type: 'GSI',
      sort_key_begins_with: 'STATUS#OPEN#',
      limit: 25,
      cursor: undefined,
    });
    expect(result.items).toHaveLength(1);
  });

  it('returns saved handoff idempotency responses only for the original actor', async () => {
    const saved = mutationResponse(handoff({ status: HandoffStatus.RESOLVED, server_version: 2 }));
    const sameActorClient = client({
      getIdempotency: vi.fn(async () => ({ actor: 'user_pharmacist', fingerprint: 'fp_1', saved })),
    });
    const sameActorStore = createDynamoHandoffLifecycleStore(sameActorClient, mapper);

    const result = await sameActorStore.getIdempotentMutation(
      ctx,
      'RESOLVE_HANDOFF:handoff_1',
      'idem_1',
      'fp_1',
    );

    expect(sameActorClient.getIdempotency).toHaveBeenCalledWith({
      table_name: PHOS_CORE_TABLE,
      partition_key: 'TENANT#tenant_abc123',
      sort_key: 'HANDOFF_IDEMPOTENCY#RESOLVE_HANDOFF:handoff_1#idem_1',
    });
    expect(result).toEqual({ status: 'MATCH', response: saved });

    const otherActorStore = createDynamoHandoffLifecycleStore(
      client({
        getIdempotency: vi.fn(async () => ({ actor: 'user_other', fingerprint: 'fp_1', saved })),
      }),
      mapper,
    );
    await expect(
      otherActorStore.getIdempotentMutation(ctx, 'RESOLVE_HANDOFF:handoff_1', 'idem_1', 'fp_1'),
    ).resolves.toEqual({ status: 'CONFLICT', existing_request_fingerprint: 'fp_1' });

    const legacyStore = createDynamoHandoffLifecycleStore(
      client({
        getIdempotency: vi.fn(async () => ({ fingerprint: 'fp_1', saved })),
      }),
      mapper,
    );
    await expect(
      legacyStore.getIdempotentMutation(ctx, 'RESOLVE_HANDOFF:handoff_1', 'idem_1', 'fp_1'),
    ).resolves.toEqual({ status: 'CONFLICT', existing_request_fingerprint: 'fp_1' });
  });

  it('builds a tenant-scoped create transaction contract', async () => {
    const fakeClient = client();
    const store = createDynamoHandoffLifecycleStore(fakeClient, mapper, {
      createHandoffId: () => 'handoff_created',
      now: () => new Date('2026-06-09T00:00:00.000Z'),
    });

    const response = await store.commitCreateHandoff(
      ctx,
      {
        card_id: 'card_1',
        reason_code: 'DIFF_REVIEW',
        summary: '薬剤師確認が必要です。',
        source_refs: [{ kind: 'PRESCRIPTION', ref_id: 'rx_1', label: '処方箋 1' }],
        urgency: HandoffUrgency.HIGH,
        related_blocker_code: 'MISSING_EVIDENCE',
        idempotency_key: 'idem_create',
        client_version: 1,
      },
      {
        card_id: 'card_1',
        patient_name: '患者 山田太郎',
        server_version: 1,
        pharmacist_assignee_user_id: 'user_pharmacist',
      },
      'fp_create',
    );

    expect(fakeClient.transactCreateHandoff).toHaveBeenCalledWith({
      table_name: PHOS_CORE_TABLE,
      partition_key: 'TENANT#tenant_abc123',
      card_sort_key: 'CARD#card_1',
      expected_card_server_version: 1,
      handoff_sort_key: 'HANDOFF#handoff_created',
      queue_gsi_pk: 'TENANT#tenant_abc123#HANDOFF_ASSIGNEE#user_pharmacist',
      idempotency_sort_key: 'HANDOFF_IDEMPOTENCY#CREATE_HANDOFF:card_1#idem_create',
      idempotency_key: 'idem_create',
      actor_user_id: 'user_pharmacist',
      request_fingerprint: 'fp_create',
      command: expect.objectContaining({ card_id: 'card_1' }),
      response,
      audit_event: expect.objectContaining({
        event_id: 'HANDOFF_CREATED#idem_create',
        event_type: 'HANDOFF_CREATED',
        card_id: 'card_1',
        action_code: undefined,
        actor_user_id: 'user_pharmacist',
        request_id: 'req_1',
        correlation_id: 'corr_1',
        before_json: null,
        after_json: expect.objectContaining({
          handoff_id: 'handoff_created',
          status: HandoffStatus.OPEN,
          source_ref_count: 1,
        }),
      }),
    });
  });

  it('derives production create handoff ids from the idempotency scope', async () => {
    const fakeClient = client();
    const store = createDynamoHandoffLifecycleStore(fakeClient, mapper, {
      now: () => new Date('2026-06-09T00:00:00.000Z'),
    });
    const command = {
      card_id: 'card_1',
      reason_code: 'DIFF_REVIEW',
      summary: '薬剤師確認が必要です。',
      source_refs: [{ kind: 'PRESCRIPTION' as const, ref_id: 'rx_1', label: '処方箋 1' }],
      urgency: HandoffUrgency.HIGH,
      related_blocker_code: 'MISSING_EVIDENCE',
      idempotency_key: 'idem_create',
      client_version: 1,
    };

    const first = await store.commitCreateHandoff(
      ctx,
      command,
      {
        card_id: 'card_1',
        patient_name: '患者 山田太郎',
        server_version: 1,
        pharmacist_assignee_user_id: 'user_pharmacist',
      },
      'fp_create',
    );
    const second = await store.commitCreateHandoff(
      ctx,
      command,
      {
        card_id: 'card_1',
        patient_name: '患者 山田太郎',
        server_version: 1,
        pharmacist_assignee_user_id: 'user_pharmacist',
      },
      'fp_create',
    );

    expect(first.handoff.handoff_id).toMatch(/^handoff_[A-Za-z0-9_-]{32}$/);
    expect(second.handoff.handoff_id).toBe(first.handoff.handoff_id);
    expect(fakeClient.transactCreateHandoff).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        handoff_sort_key: `HANDOFF#${first.handoff.handoff_id}`,
        response: expect.objectContaining({
          handoff: expect.objectContaining({ handoff_id: first.handoff.handoff_id }),
        }),
      }),
    );
  });

  it('builds a conditional transition transaction with related blocker resolution', async () => {
    const fakeClient = client();
    const store = createDynamoHandoffLifecycleStore(fakeClient, mapper);
    const previous = handoff();
    const response = mutationResponse(
      handoff({
        status: HandoffStatus.RESOLVED,
        resolved_action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        server_version: 2,
      }),
    );

    await store.commitHandoffTransition(ctx, {
      handoff_id: 'handoff_1',
      mutation_key: 'RESOLVE_HANDOFF:handoff_1',
      command: {
        resolved_action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        idempotency_key: 'idem_resolve',
        client_version: 1,
      },
      request_fingerprint: 'fp_resolve',
      previous_handoff: previous,
      response,
      card_aggregate_update: {
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
          required_role: [UserRole.PHARMACIST],
          target_endpoint: '/cards/card_1/actions',
          ui_state: ButtonState.ACTIONABLE,
          can_user_handle: true,
        },
        server_version: 4,
      },
    });

    expect(fakeClient.transactCommitHandoffTransition).toHaveBeenCalledWith({
      table_name: PHOS_CORE_TABLE,
      partition_key: 'TENANT#tenant_abc123',
      handoff_sort_key: 'HANDOFF#handoff_1',
      queue_gsi_pk: 'TENANT#tenant_abc123#HANDOFF_ASSIGNEE#user_pharmacist',
      idempotency_sort_key: 'HANDOFF_IDEMPOTENCY#RESOLVE_HANDOFF:handoff_1#idem_resolve',
      idempotency_key: 'idem_resolve',
      actor_user_id: 'user_pharmacist',
      expected_server_version: 1,
      expected_assignee_user_id: 'user_pharmacist',
      request_fingerprint: 'fp_resolve',
      response,
      audit_event: expect.objectContaining({
        event_id: 'HANDOFF_RESOLVED#idem_resolve',
        event_type: 'HANDOFF_RESOLVED',
        card_id: 'card_1',
        action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        actor_user_id: 'user_pharmacist',
        request_id: 'req_1',
        correlation_id: 'corr_1',
        before_json: expect.objectContaining({
          handoff_id: 'handoff_1',
          status: HandoffStatus.OPEN,
          source_ref_count: 1,
        }),
        after_json: expect.objectContaining({
          handoff_id: 'handoff_1',
          status: HandoffStatus.RESOLVED,
          source_ref_count: 1,
        }),
      }),
      blocker_resolution: { card_id: 'card_1', blocker_code: 'MISSING_EVIDENCE' },
      card_aggregate_update: {
        card_sort_key: 'CARD#card_1',
        expected_card_server_version: 3,
        update: expect.objectContaining({ server_version: 4 }),
      },
    });
  });
});
