// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ActionCode,
  BlockerSeverity,
  ButtonState,
  CapacityScope,
  CapacityStatus,
  CardType,
  CurrentStep,
  DisplayStatus,
  HandoffStatus,
  HandoffUrgency,
  ReportDeliveryStatus,
  UserRole,
  VisitArrivalOutcome,
  VisitStatus,
  VisitStep,
  type ActionRequest,
  type ActionResponse,
  type BlockerView,
  type CapacityResponse,
  type CardBoardItemView,
  type CardDetailResponse,
  type CardSummaryView,
  type HandoffSearchQuery,
  type HandoffSearchResponse,
  type HandoffView,
  type NextActionView,
  type ReportDeliverySearchResponse,
  type ReportDeliveryView,
  type VisitModeView,
} from '@/phos/contracts/phos_contracts';
import { ACTION_TRANSITION_MATRIX } from '@/phos/domain/actions/actionTransitionMatrix';
import { resolveButtonState } from '@/phos/domain/actions/resolveButtonState';
import {
  createCardActionExecutorRepository,
  type CardActionExecutionState,
  type CardActionExecutionStore,
  type IdempotentActionLookup,
} from '@/phos/backend/card-action-executor';
import {
  createHandoffLifecycleRepository,
  type HandoffLifecycleStore,
  type IdempotentHandoffLookup,
} from '@/phos/backend/handoff-lifecycle-repository';
import {
  createReportDeliveryLifecycleRepository,
  type IdempotentReportDeliveryLookup,
  type ReportDeliveryLifecycleStore,
} from '@/phos/backend/report-delivery-lifecycle-repository';
import type { ReportDeliverySearchQuery } from '@/phos/backend/report-deliveries-repository';
import {
  createVisitModeLifecycleRepository,
  type IdempotentVisitStepLookup,
  type VisitModeLifecycleStore,
} from '@/phos/backend/visit-mode-lifecycle-repository';
import type { HandoffCardAggregateSource } from '@/phos/backend/handoff-card-aggregate-projection';
import type { PhosApiClient } from '@/phos/api/types';
import type { TenantContext } from '@/phos/backend/tenant-context';
import { BoardClient } from '@/phos/ui/board/BoardClient';

const sessionMock = vi.hoisted(() => ({
  value: {
    phosRole: 'PHARMACIST',
    user: { name: '薬剤師A' },
  } as {
    phosRole?: UserRole;
    cognitoGroups?: unknown;
    user?: { name?: string | null };
  } | null,
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: sessionMock.value,
    status: sessionMock.value ? 'authenticated' : 'unauthenticated',
  }),
}));

const pharmacistCtx: TenantContext = {
  tenant_id: 'tenant_abc123',
  user_id: 'user_pharmacist',
  role: UserRole.PHARMACIST,
  request_id: 'req_1',
  correlation_id: 'corr_1',
  scopes: ['phos/cards.write', 'phos/handoffs.write', 'phos/report-deliveries.write'],
};

const clerkCtx: TenantContext = {
  ...pharmacistCtx,
  user_id: 'user_clerk',
  role: UserRole.PHARMACY_CLERK,
};

function card(overrides: Partial<CardSummaryView> = {}): CardSummaryView {
  return {
    card_id: 'card_1',
    card_type: CardType.PRESCRIPTION,
    patient_name: '患者 山田太郎',
    current_step: CurrentStep.INTAKE,
    display_status: DisplayStatus.READY,
    server_version: 1,
    tags: [],
    ...overrides,
  };
}

function nextAction(code: ActionCode): NextActionView {
  const transition = ACTION_TRANSITION_MATRIX[code];
  const required_role =
    'required_role' in transition ? transition.required_role : [UserRole.PHARMACIST];
  return {
    code,
    kind: transition.kind,
    label_key: `action.${code.toLowerCase()}`,
    enabled: true,
    offline_allowed: false,
    priority: 'PRIMARY',
    required_role,
    target_endpoint: 'POST /cards/{card_id}/actions',
    ui_state: ButtonState.ACTIONABLE,
    can_user_handle: true,
    ...('reason_required' in transition && transition.reason_required
      ? { reason_required: true }
      : {}),
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

function visitMode(overrides: Partial<VisitModeView> = {}): VisitModeView {
  return {
    packet_id: 'packet_1',
    assignee_user_id: 'user_pharmacist',
    server_version: 1,
    patient_name: '患者 山田太郎',
    visit_status: VisitStatus.IN_PROGRESS,
    applicable_steps: [
      VisitStep.ARRIVAL_CONFIRM,
      VisitStep.EVIDENCE_UPLOAD,
      VisitStep.COMPLETE_CHECK,
    ],
    required_steps: [
      VisitStep.ARRIVAL_CONFIRM,
      VisitStep.EVIDENCE_UPLOAD,
      VisitStep.COMPLETE_CHECK,
    ],
    step_completed: {
      ...(Object.fromEntries(Object.values(VisitStep).map((step) => [step, true])) as Record<
        VisitStep,
        boolean
      >),
    },
    last_opened_step: VisitStep.EVIDENCE_UPLOAD,
    evidence_sync: { blocking_unsynced_count: 0, non_blocking_unsynced_count: 0 },
    online: true,
    blockers: [],
    ...overrides,
  };
}

function displayStatusForStep(step: CurrentStep, fallback: DisplayStatus): DisplayStatus {
  if (step === CurrentStep.CLOSED) return DisplayStatus.CLOSED;
  return fallback;
}

function createActionHarness(initialCard: CardSummaryView = card()) {
  let state: CardActionExecutionState = {
    card: initialCard,
    next_action: nextAction(ActionCode.REGISTER_PRESCRIPTION),
    blockers: [],
    visit_mode: visitMode(),
    unresolved_claim_candidate_count: 0,
    allowed_actions: Object.values(ActionCode),
  };
  const reportDeliveries: ReportDeliveryView[] = [];

  const store: CardActionExecutionStore = {
    getIdempotentAction: vi.fn(async (): Promise<IdempotentActionLookup> => ({ status: 'MISS' })),
    loadActionState: vi.fn(async () => state),
    commitAction: vi.fn(async (_ctx, input) => {
      const transition = input.transition;
      const previous = state.card;
      const nextVersion = previous.server_version + 1;
      const nextStep = Object.values(CurrentStep).includes(transition.to as CurrentStep)
        ? (transition.to as CurrentStep)
        : previous.current_step;
      const display_status =
        input.command.action_code === ActionCode.REJECT_SET_AUDIT
          ? DisplayStatus.REJECTED
          : input.command.action_code === ActionCode.CANCEL_CARD
            ? DisplayStatus.CANCELED
            : displayStatusForStep(nextStep, DisplayStatus.READY);
      const nextCard = {
        ...previous,
        current_step: nextStep,
        display_status,
        server_version: nextVersion,
      };
      const side_effects: ActionResponse['side_effects'] =
        input.command.action_code === ActionCode.SEND_REPORT
          ? [{ type: 'REPORT_QUEUED', delivery_id: 'delivery_1' }]
          : [];

      if (input.command.action_code === ActionCode.SEND_REPORT) {
        reportDeliveries.push(reportDelivery({ card_id: previous.card_id }));
      }

      state = {
        ...state,
        card: nextCard,
        next_action: nextAction(input.command.action_code),
        blockers: input.command.action_code === ActionCode.REJECT_SET_AUDIT ? [] : state.blockers,
        visit_mode:
          input.command.action_code === ActionCode.COMPLETE_VISIT
            ? visitMode({ visit_status: VisitStatus.COMPLETED, server_version: nextVersion })
            : state.visit_mode,
      };

      return {
        card: nextCard,
        next_action: state.next_action,
        display_status,
        blockers: state.blockers,
        side_effects,
        server_version: nextVersion,
      };
    }),
  };

  return {
    repository: createCardActionExecutorRepository(store),
    store,
    reportDeliveries,
    get state() {
      return state;
    },
    set state(next: CardActionExecutionState) {
      state = next;
    },
  };
}

async function executeActionSequence(
  harness: ReturnType<typeof createActionHarness>,
  actions: readonly ActionCode[],
) {
  for (const action_code of actions) {
    await harness.repository.executeCardAction(pharmacistCtx, 'card_1', {
      action_code,
      idempotency_key: `idem_${action_code}_${harness.state.card.server_version}`,
      client_version: harness.state.card.server_version,
      ...('reason_required' in ACTION_TRANSITION_MATRIX[action_code] &&
      ACTION_TRANSITION_MATRIX[action_code].reason_required
        ? { reason_code: 'PHOTO_INSUFFICIENT' }
        : {}),
    });
  }
}

function handoff(overrides: Partial<HandoffView> = {}): HandoffView {
  return {
    handoff_id: 'handoff_1',
    card_id: 'card_1',
    status: HandoffStatus.OPEN,
    reason_code: 'DIFF_REVIEW',
    summary: '送付先不足のため薬剤師判断が必要です。',
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
    age_minutes: 5,
    ...overrides,
  };
}

function createHandoffHarness() {
  let handoffs: HandoffView[] = [];
  const store: HandoffLifecycleStore = {
    searchHandoffs: vi.fn(
      async (_ctx, query: HandoffSearchQuery): Promise<HandoffSearchResponse> => {
        return {
          items: handoffs.filter((item) => !query.status || item.status === query.status),
          server_time: '2026-06-09T00:00:00.000Z',
        };
      },
    ),
    getIdempotentMutation: vi.fn(
      async (): Promise<IdempotentHandoffLookup> => ({ status: 'MISS' }),
    ),
    loadHandoff: vi.fn(
      async (_ctx, handoff_id) => handoffs.find((item) => item.handoff_id === handoff_id) ?? null,
    ),
    loadCreateCardContext: vi.fn(async (_ctx, card_id) => ({
      card_id,
      patient_name: '患者 山田太郎',
      server_version: 1,
      pharmacist_assignee_user_id: 'user_pharmacist',
    })),
    loadHandoffCardState: vi.fn(
      async (): Promise<HandoffCardAggregateSource> => ({
        state: {
          card: card({ current_step: CurrentStep.DIFF_REVIEW, server_version: 1 }),
          next_action: nextAction(ActionCode.CONFIRM_PRESCRIPTION_DIFF),
          blockers: [blocker()],
          unresolved_claim_candidate_count: 0,
          allowed_actions: Object.values(ActionCode),
        },
        display_context: {
          canceled_at: null,
          has_open_rejected_audit: false,
          has_active_in_progress_task: false,
          primary_action_authorized: true,
        },
      }),
    ),
    commitCreateHandoff: vi.fn(async (_ctx, command, card_context) => {
      const created = handoff({
        card_id: command.card_id,
        reason_code: command.reason_code,
        summary: command.summary,
        source_refs: command.source_refs,
        requested_action: command.requested_action,
        urgency: command.urgency,
        related_blocker_code: command.related_blocker_code,
        patient_name: card_context.patient_name,
      });
      handoffs = [created, ...handoffs];
      return { handoff: created, side_effects: [], server_version: created.server_version };
    }),
    commitHandoffTransition: vi.fn(async (_ctx, input) => {
      handoffs = handoffs.map((item) =>
        item.handoff_id === input.handoff_id ? input.response.handoff : item,
      );
      return input.response;
    }),
  };
  return {
    repository: createHandoffLifecycleRepository(store, {
      now: () => new Date('2026-06-09T00:10:00.000Z'),
    }),
    get handoffs() {
      return handoffs;
    },
  };
}

function reportDelivery(overrides: Partial<ReportDeliveryView> = {}): ReportDeliveryView {
  return {
    delivery_id: 'delivery_1',
    card_id: 'card_1',
    report_id: 'report_1',
    patient_name: '患者 山田太郎',
    target_label: '青空ホーム',
    status: ReportDeliveryStatus.WAITING_REPLY,
    delivery_method: 'FAX',
    sent_at: '2026-06-09T00:00:00.000Z',
    stale_minutes: 0,
    source_refs: [{ kind: 'CARE_PLAN', ref_id: 'report_1', label: '報告書 1' }],
    server_version: 1,
    ...overrides,
  };
}

function createReportDeliveryHarness(seed: ReportDeliveryView[]) {
  let deliveries = seed;
  const store: ReportDeliveryLifecycleStore = {
    searchReportDeliveries: vi.fn(
      async (_ctx, query: ReportDeliverySearchQuery): Promise<ReportDeliverySearchResponse> => ({
        items: deliveries.filter((item) => item.status === query.status),
        server_time: '2026-06-09T00:00:00.000Z',
      }),
    ),
    getIdempotentMutation: vi.fn(
      async (): Promise<IdempotentReportDeliveryLookup> => ({ status: 'MISS' }),
    ),
    loadReportDelivery: vi.fn(
      async (_ctx, delivery_id) =>
        deliveries.find((item) => item.delivery_id === delivery_id) ?? null,
    ),
    commitReportDeliveryTransition: vi.fn(async (_ctx, input) => {
      deliveries = deliveries.map((item) =>
        item.delivery_id === input.delivery_id ? input.response.delivery : item,
      );
      return input.response;
    }),
  };
  return {
    repository: createReportDeliveryLifecycleRepository(store, {
      now: () => new Date('2026-06-09T00:20:00.000Z'),
    }),
  };
}

function createVisitHarness(seed: VisitModeView) {
  let visit = seed;
  const store: VisitModeLifecycleStore = {
    getIdempotentVisitStep: vi.fn(
      async (): Promise<IdempotentVisitStepLookup> => ({ status: 'MISS' }),
    ),
    loadVisitMode: vi.fn(async () => visit),
    verifyEvidenceUpload: vi.fn(async () => ({
      evidence_id: 'evidence_1',
      card_id: visit.card_id ?? 'card_1',
      s3_key: `tenants/tenant_abc123/evidence/${visit.card_id ?? 'card_1'}/evidence_1.jpg`,
    })),
    commitVisitStep: vi.fn(async (_ctx, input) => {
      visit = input.response;
      return input.response;
    }),
  };
  return createVisitModeLifecycleRepository(store);
}

function capacityResponse(): CapacityResponse {
  return {
    date: '2026-06-09',
    scope: CapacityScope.PHARMACY,
    status: CapacityStatus.TIGHT,
    total_planned_minutes: 420,
    total_available_minutes: 480,
    utilization_percent: 88,
    work_buckets: [],
    staff_loads: [],
    bottlenecks: [],
    server_time: '2026-06-09T00:00:00.000Z',
  };
}

function boardItem(): CardBoardItemView {
  const summary = card({
    current_step: CurrentStep.DIFF_REVIEW,
    display_status: DisplayStatus.READY,
    server_version: 1,
  });
  return { card: summary, next_action: nextAction(ActionCode.CONFIRM_PRESCRIPTION_DIFF) };
}

function boardClient(): PhosApiClient {
  const item = boardItem();
  const detail: CardDetailResponse = {
    card: item.card,
    visible_tabs: ['OVERVIEW'],
    permissions: {
      can_read: true,
      can_write: true,
      allowed_actions: [ActionCode.CONFIRM_PRESCRIPTION_DIFF],
    },
    next_action: item.next_action,
    blockers: [],
    source_refs: [],
    server_version: item.card.server_version,
  };
  return {
    getCards: vi.fn(async () => ({ items: [item], server_time: '2026-06-09T00:00:00.000Z' })),
    getCapacity: vi.fn(async () => capacityResponse()),
    getClaimCandidates: vi.fn(async () => ({ items: [], server_time: '2026-06-09T00:00:00.000Z' })),
    excludeClaimCandidate: vi.fn(async () => {
      throw new Error('unused');
    }),
    getFeeRules: vi.fn(async () => ({ items: [], server_time: '2026-06-09T00:00:00.000Z' })),
    getCardDetail: vi.fn(async () => detail),
    executeCardAction: vi.fn(async () => ({
      card: item.card,
      next_action: item.next_action,
      display_status: item.card.display_status,
      blockers: [],
      side_effects: [],
      server_version: item.card.server_version,
    })),
    getVisitMode: vi.fn(async () => visitMode()),
    updateVisitStep: vi.fn(async () => visitMode()),
    presignEvidenceUpload: vi.fn(async () => ({
      request_id: 'req_1',
      evidence_id: 'evidence_1',
      s3_key: 'tenants/tenant_abc123/evidence/card_1/evidence_1.jpg',
      upload_url: 'https://example.com/upload',
      method: 'PUT' as const,
      headers: {},
      expires_in_seconds: 300,
      max_size_bytes: 10_000_000,
    })),
    getHandoffs: vi.fn(async () => ({ items: [], server_time: '2026-06-09T00:00:00.000Z' })),
    getReportDeliveries: vi.fn(async () => ({
      items: [],
      server_time: '2026-06-09T00:00:00.000Z',
    })),
    registerReportReply: vi.fn(async () => {
      throw new Error('unused');
    }),
    markReportActionDone: vi.fn(async () => {
      throw new Error('unused');
    }),
    createHandoff: vi.fn(async () => {
      throw new Error('unused');
    }),
    openHandoff: vi.fn(async () => {
      throw new Error('unused');
    }),
    resolveHandoff: vi.fn(async () => {
      throw new Error('unused');
    }),
    returnHandoff: vi.fn(async () => {
      throw new Error('unused');
    }),
  } satisfies PhosApiClient;
}

describe('PH-OS final review executable E2E coverage', () => {
  it('E2E-01 advances a normal prescription card from REGISTER to CLOSED', async () => {
    const harness = createActionHarness();
    await executeActionSequence(harness, [
      ActionCode.REGISTER_PRESCRIPTION,
      ActionCode.CONFIRM_PRESCRIPTION_DIFF,
      ActionCode.COMPLETE_DISPENSING,
      ActionCode.APPROVE_DISPENSING_AUDIT,
      ActionCode.CREATE_SET_INSTRUCTION,
      ActionCode.COMPLETE_SET,
      ActionCode.APPROVE_SET_AUDIT,
      ActionCode.SCHEDULE_VISIT_PACKET,
      ActionCode.CONFIRM_VISIT_READY,
      ActionCode.START_VISIT,
      ActionCode.COMPLETE_VISIT,
      ActionCode.APPROVE_REPORT,
      ActionCode.SEND_REPORT,
      ActionCode.REVIEW_CLAIM_CANDIDATES,
      ActionCode.CLOSE_CARD,
    ]);

    expect(harness.state.card).toMatchObject({
      current_step: CurrentStep.CLOSED,
      display_status: DisplayStatus.CLOSED,
    });
  });

  it('E2E-02 returns a rejected set audit to re-setting with a required reason', async () => {
    const harness = createActionHarness(
      card({ current_step: CurrentStep.SET_AUDIT, display_status: DisplayStatus.READY }),
    );
    harness.state = {
      ...harness.state,
      next_action: nextAction(ActionCode.REJECT_SET_AUDIT),
      allowed_actions: [ActionCode.REJECT_SET_AUDIT],
    };

    await expect(
      harness.repository.executeCardAction(pharmacistCtx, 'card_1', {
        action_code: ActionCode.REJECT_SET_AUDIT,
        idempotency_key: 'idem_reject_set',
        client_version: 1,
        reason_code: 'PHOTO_INSUFFICIENT',
      }),
    ).resolves.toMatchObject({
      card: { current_step: CurrentStep.SETTING, display_status: DisplayStatus.REJECTED },
    });
  });

  it('E2E-03 lets a clerk resolve destination prep by creating a pharmacist handoff', async () => {
    const harness = createHandoffHarness();
    const created = await harness.repository.createHandoff(clerkCtx, {
      card_id: 'card_1',
      reason_code: 'DESTINATION_MISSING',
      summary: '送付先不足のため薬剤師判断が必要です。',
      source_refs: [{ kind: 'PRESCRIPTION', ref_id: 'rx_1', label: '処方箋 1' }],
      requested_action: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
      urgency: HandoffUrgency.HIGH,
      related_blocker_code: 'MISSING_EVIDENCE',
      idempotency_key: 'idem_handoff_create',
      client_version: 1,
    });
    const queue = await harness.repository.searchHandoffs(pharmacistCtx, {
      status: HandoffStatus.OPEN,
      assignee: 'ME',
      limit: 50,
    });

    expect(created.handoff).toMatchObject({
      status: HandoffStatus.OPEN,
      reason_code: 'DESTINATION_MISSING',
    });
    expect(queue.items).toHaveLength(1);
  });

  it('E2E-04 removes a resolved handoff from the pharmacist queue and emits blocker resolution', async () => {
    const harness = createHandoffHarness();
    await harness.repository.createHandoff(clerkCtx, {
      card_id: 'card_1',
      reason_code: 'DESTINATION_MISSING',
      summary: '送付先不足のため薬剤師判断が必要です。',
      source_refs: [{ kind: 'PRESCRIPTION', ref_id: 'rx_1', label: '処方箋 1' }],
      requested_action: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
      urgency: HandoffUrgency.HIGH,
      related_blocker_code: 'MISSING_EVIDENCE',
      idempotency_key: 'idem_handoff_create',
      client_version: 1,
    });

    const resolved = await harness.repository.resolveHandoff(pharmacistCtx, 'handoff_1', {
      resolved_action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
      idempotency_key: 'idem_handoff_resolve',
      client_version: 1,
    });
    const openQueue = await harness.repository.searchHandoffs(pharmacistCtx, {
      status: HandoffStatus.OPEN,
      assignee: 'ME',
      limit: 50,
    });

    expect(resolved).toMatchObject({
      handoff: { status: HandoffStatus.RESOLVED },
      side_effects: [{ type: 'BLOCKER_RESOLVED', blocker_code: 'MISSING_EVIDENCE' }],
    });
    expect(openQueue.items).toHaveLength(0);
  });

  it('E2E-05 creates a follow-up blocker when VisitMode arrival is absent', async () => {
    const repository = createVisitHarness(visitMode({ visit_status: VisitStatus.SCHEDULED }));

    await expect(
      repository.updateVisitStep(pharmacistCtx, 'packet_1', VisitStep.ARRIVAL_CONFIRM, {
        idempotency_key: 'idem_absent',
        client_version: 1,
        payload: { arrival_outcome: VisitArrivalOutcome.ABSENT },
      }),
    ).resolves.toMatchObject({
      visit_status: VisitStatus.POST_VISIT_PENDING,
      blockers: [{ blocker_code: 'VISIT_ABSENT_FOLLOWUP', active: true }],
    });
  });

  it('E2E-06 blocks VisitMode completion while mandatory evidence remains unsynced', async () => {
    const repository = createVisitHarness(
      visitMode({ evidence_sync: { blocking_unsynced_count: 1, non_blocking_unsynced_count: 0 } }),
    );

    await expect(
      repository.updateVisitStep(pharmacistCtx, 'packet_1', VisitStep.COMPLETE_CHECK, {
        idempotency_key: 'idem_complete',
        client_version: 1,
      }),
    ).rejects.toMatchObject({
      status: 422,
      error_code: 'ACTION_GUARD_FAILED',
      details: { blocking_unsynced_count: 1 },
    });
  });

  it('E2E-07 manages WAITING_REPLY report delivery as a detached workflow after SEND_REPORT', async () => {
    const actionHarness = createActionHarness(
      card({ current_step: CurrentStep.REPORT_SEND, server_version: 1 }),
    );
    actionHarness.state = {
      ...actionHarness.state,
      next_action: nextAction(ActionCode.SEND_REPORT),
      allowed_actions: [ActionCode.SEND_REPORT],
    };
    await actionHarness.repository.executeCardAction(pharmacistCtx, 'card_1', {
      action_code: ActionCode.SEND_REPORT,
      idempotency_key: 'idem_send_report',
      client_version: 1,
    });
    const reportHarness = createReportDeliveryHarness(actionHarness.reportDeliveries);
    const waiting = await reportHarness.repository.searchReportDeliveries(pharmacistCtx, {
      status: ReportDeliveryStatus.WAITING_REPLY,
      limit: 50,
    });
    const actionRequired = await reportHarness.repository.registerReportReply(
      pharmacistCtx,
      'delivery_1',
      {
        result_status: ReportDeliveryStatus.ACTION_REQUIRED,
        reply_summary: '追加説明が必要です。',
        action_required_note: '医師へ確認してください。',
        idempotency_key: 'idem_reply',
        client_version: 1,
      },
    );

    expect(waiting.items).toHaveLength(1);
    expect(actionRequired.delivery.status).toBe(ReportDeliveryStatus.ACTION_REQUIRED);
  });

  it('E2E-08 returns 409 stale-version conflicts without committing or overwriting a draft', async () => {
    const draft: ActionRequest = {
      action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
      idempotency_key: 'idem_conflict',
      client_version: 1,
      payload: { note: '編集中の下書き' },
    };
    const commitAction = vi.fn();
    const repository = createCardActionExecutorRepository({
      getIdempotentAction: vi.fn(async (): Promise<IdempotentActionLookup> => ({ status: 'MISS' })),
      loadActionState: vi.fn(async () => ({
        card: card({ current_step: CurrentStep.DIFF_REVIEW, server_version: 2 }),
        next_action: nextAction(ActionCode.CONFIRM_PRESCRIPTION_DIFF),
        blockers: [],
        unresolved_claim_candidate_count: 0,
        allowed_actions: [ActionCode.CONFIRM_PRESCRIPTION_DIFF],
      })),
      commitAction,
    });

    await expect(
      repository.executeCardAction(pharmacistCtx, 'card_1', draft),
    ).rejects.toMatchObject({
      status: 409,
      error_code: 'STALE_VERSION',
    });
    expect(commitAction).not.toHaveBeenCalled();
    expect(draft.payload).toEqual({ note: '編集中の下書き' });
  });

  it('E2E-09 resolves offline-disallowed actions to OFFLINE_BLOCKED', () => {
    const action = nextAction(ActionCode.CONFIRM_PRESCRIPTION_DIFF);

    expect(
      resolveButtonState({
        card: { display_status: DisplayStatus.READY, current_step: CurrentStep.DIFF_REVIEW },
        nextAction: { ...action, offline_allowed: false },
        isOffline: true,
        canUserHandleBlocker: false,
        noPermission: false,
      }),
    ).toBe(ButtonState.OFFLINE_BLOCKED);
  });

  it('E2E-10 displays CapacityBar only for manager-grade users', async () => {
    const managerClient = boardClient();
    sessionMock.value = {
      phosRole: UserRole.MANAGER,
      user: { name: '管理薬剤師A' },
    };
    const { unmount } = render(<BoardClient client={managerClient} initialItems={[boardItem()]} />);

    await waitFor(() => expect(managerClient.getCapacity).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: 'Capacity' })).not.toBeNull();
    unmount();

    const clerkClient = boardClient();
    sessionMock.value = {
      phosRole: UserRole.PHARMACY_CLERK,
      user: { name: '事務員A' },
    };
    render(<BoardClient client={clerkClient} initialItems={[boardItem()]} />);
    await waitFor(() => expect(clerkClient.getHandoffs).toHaveBeenCalled());

    expect(clerkClient.getCapacity).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Capacity' })).toBeNull();
  });

  it('E2E-11 preserves the browser UI flow from Board to Workspace, SourceDrawer, focus return, and Space primary action', async () => {
    const apiClient = boardClient();

    render(<BoardClient client={apiClient} initialItems={[boardItem()]} />);

    const sourceCard = screen.getByRole('button', { name: /患者 山田太郎/ });
    fireEvent.click(sourceCard);

    await waitFor(() => expect(apiClient.getCardDetail).toHaveBeenCalledWith('card_1'));
    expect(screen.getByRole('dialog', { name: /患者 山田太郎/ })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: '算定' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '参照情報を開く' }));
    const drawer = screen.getByRole('dialog', { name: '参照情報' });
    expect(within(drawer).getByText('参照情報はありません。')).toBeTruthy();

    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '参照情報を開く' })),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(document.activeElement).toBe(sourceCard));

    fireEvent.keyDown(sourceCard, { key: ' ' });
    await waitFor(() => expect(apiClient.executeCardAction).toHaveBeenCalledTimes(1));
    expect(apiClient.executeCardAction).toHaveBeenCalledWith(
      'card_1',
      expect.objectContaining({
        action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        client_version: 1,
      }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
