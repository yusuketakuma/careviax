import { describe, expect, it, vi } from 'vitest';
import {
  UserRole,
  VisitArrivalOutcome,
  VisitStatus,
  VisitStep,
  type VisitModeView,
} from '@/phos/contracts/phos_contracts';
import type { TenantContext } from './tenant-context';
import {
  createVisitModeLifecycleRepository,
  type IdempotentVisitStepLookup,
  type VisitModeLifecycleStore,
} from './visit-mode-lifecycle-repository';

const ctx: TenantContext = {
  tenant_id: 'tenant_abc123',
  user_id: 'user_1',
  role: UserRole.PHARMACIST,
  request_id: 'req_1',
  correlation_id: 'corr_1',
  scopes: ['phos/visit-mode.write'],
};

const allComplete = Object.fromEntries(
  Object.values(VisitStep).map((step) => [step, true]),
) as Record<VisitStep, boolean>;

function visit(overrides: Partial<VisitModeView> = {}): VisitModeView {
  return {
    packet_id: 'packet_1',
    server_version: 3,
    patient_name: '患者 山田太郎',
    facility: '青空ホーム',
    room: '101',
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
      ...allComplete,
      [VisitStep.COMPLETE_CHECK]: false,
    },
    last_opened_step: VisitStep.EVIDENCE_UPLOAD,
    evidence_sync: {
      blocking_unsynced_count: 0,
      non_blocking_unsynced_count: 0,
    },
    online: true,
    ...overrides,
  };
}

function store(overrides: Partial<VisitModeLifecycleStore> = {}): VisitModeLifecycleStore {
  return {
    getIdempotentVisitStep: vi.fn(
      async (): Promise<IdempotentVisitStepLookup> => ({ status: 'MISS' }),
    ),
    loadVisitMode: vi.fn(async () => visit()),
    commitVisitStep: vi.fn(async (_ctx, input) => input.response),
    ...overrides,
  };
}

describe('createVisitModeLifecycleRepository', () => {
  it('replays matching idempotent visit step responses without loading the packet', async () => {
    const response = visit({ server_version: 4 });
    const fakeStore = store({
      getIdempotentVisitStep: vi.fn(async () => ({ status: 'MATCH' as const, response })),
    });
    const repository = createVisitModeLifecycleRepository(fakeStore);

    await expect(
      repository.updateVisitStep(ctx, 'packet_1', VisitStep.EVIDENCE_UPLOAD, {
        idempotency_key: 'idem_1',
        client_version: 3,
      }),
    ).resolves.toEqual(response);

    expect(fakeStore.loadVisitMode).not.toHaveBeenCalled();
    expect(fakeStore.commitVisitStep).not.toHaveBeenCalled();
  });

  it('rejects stale client_version before committing', async () => {
    const fakeStore = store({ loadVisitMode: vi.fn(async () => visit({ server_version: 4 })) });
    const repository = createVisitModeLifecycleRepository(fakeStore);

    await expect(
      repository.updateVisitStep(ctx, 'packet_1', VisitStep.EVIDENCE_UPLOAD, {
        idempotency_key: 'idem_1',
        client_version: 3,
      }),
    ).rejects.toMatchObject({
      status: 409,
      error_code: 'STALE_VERSION',
      details: { client_version: 3, server_version: 4 },
    });
    expect(fakeStore.commitVisitStep).not.toHaveBeenCalled();
  });

  it('applies ARRIVAL_CONFIRM outcomes to server visit_status', async () => {
    const fakeStore = store({
      loadVisitMode: vi.fn(async () => visit({ visit_status: VisitStatus.SCHEDULED })),
    });
    const repository = createVisitModeLifecycleRepository(fakeStore);

    await expect(
      repository.updateVisitStep(ctx, 'packet_1', VisitStep.ARRIVAL_CONFIRM, {
        idempotency_key: 'idem_arrival',
        client_version: 3,
        payload: { arrival_outcome: VisitArrivalOutcome.PRESENT },
      }),
    ).resolves.toMatchObject({
      server_version: 4,
      visit_status: VisitStatus.IN_PROGRESS,
      step_completed: { [VisitStep.ARRIVAL_CONFIRM]: true },
    });
  });

  it('rejects CANCELED arrival without a reason in the lifecycle layer', async () => {
    const repository = createVisitModeLifecycleRepository(store());

    await expect(
      repository.updateVisitStep(ctx, 'packet_1', VisitStep.ARRIVAL_CONFIRM, {
        idempotency_key: 'idem_cancel',
        client_version: 3,
        payload: { arrival_outcome: VisitArrivalOutcome.CANCELED },
      }),
    ).rejects.toMatchObject({
      status: 422,
      error_code: 'ACTION_GUARD_FAILED',
      details: { reason: 'missing_cancel_reason' },
    });
  });

  it('completes the visit only when required steps are complete and blocking sync is clear', async () => {
    const repository = createVisitModeLifecycleRepository(store());

    await expect(
      repository.updateVisitStep(ctx, 'packet_1', VisitStep.COMPLETE_CHECK, {
        idempotency_key: 'idem_complete',
        client_version: 3,
      }),
    ).resolves.toMatchObject({
      visit_status: VisitStatus.COMPLETED,
      step_completed: { [VisitStep.COMPLETE_CHECK]: true },
    });
  });

  it('rejects completion when blocking sync remains', async () => {
    const fakeStore = store({
      loadVisitMode: vi.fn(async () =>
        visit({ evidence_sync: { blocking_unsynced_count: 1, non_blocking_unsynced_count: 0 } }),
      ),
    });
    const repository = createVisitModeLifecycleRepository(fakeStore);

    await expect(
      repository.updateVisitStep(ctx, 'packet_1', VisitStep.COMPLETE_CHECK, {
        idempotency_key: 'idem_complete',
        client_version: 3,
      }),
    ).rejects.toMatchObject({
      status: 422,
      error_code: 'ACTION_GUARD_FAILED',
      details: { blocking_unsynced_count: 1 },
    });
    expect(fakeStore.commitVisitStep).not.toHaveBeenCalled();
  });
});
