import { describe, expect, it, vi } from 'vitest';
import {
  UserRole,
  VisitArrivalOutcome,
  VisitStatus,
  VisitStep,
  type VisitModeView,
} from '@/phos/contracts/phos_contracts';
import { createGetVisitModeHandler, createUpdateVisitStepHandler } from './visit-mode-handlers';
import type { PhosLambdaResponse } from './error-response';
import type { PhosVisitModeRepository } from './visit-mode-repository';
import type { TenantContext } from './tenant-context';

function ctx(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    tenant_id: 'tenant_abc123',
    user_id: 'user_1',
    role: UserRole.PHARMACIST,
    request_id: 'req_1',
    correlation_id: 'corr_1',
    scopes: ['phos/visit-mode.read', 'phos/visit-mode.write'],
    ...overrides,
  };
}

function visit(overrides: Partial<VisitModeView> = {}): VisitModeView {
  return {
    packet_id: 'packet_1',
    server_version: 3,
    patient_name: '患者 山田太郎',
    visit_status: VisitStatus.IN_PROGRESS,
    applicable_steps: [VisitStep.ARRIVAL_CONFIRM, VisitStep.COMPLETE_CHECK],
    required_steps: [VisitStep.ARRIVAL_CONFIRM, VisitStep.COMPLETE_CHECK],
    step_completed: Object.fromEntries(
      Object.values(VisitStep).map((step) => [step, false]),
    ) as Record<VisitStep, boolean>,
    last_opened_step: VisitStep.ARRIVAL_CONFIRM,
    evidence_sync: { blocking_unsynced_count: 0, non_blocking_unsynced_count: 0 },
    online: true,
    ...overrides,
  };
}

function repository(overrides: Partial<PhosVisitModeRepository> = {}): PhosVisitModeRepository {
  return {
    getVisitMode: vi.fn(async () => visit()),
    updateVisitStep: vi.fn(async () => visit({ server_version: 4 })),
    ...overrides,
  };
}

describe('PH-OS visit-mode handlers', () => {
  it('loads VisitModeView for authorized visit users', async () => {
    const repo = repository();
    const handler = createGetVisitModeHandler(repo);

    await expect(
      handler({
        ctx: ctx(),
        body: undefined,
        event: {
          routeKey: 'GET /visit-packets/{packet_id}/visit-mode',
          pathParameters: { packet_id: 'packet_1' },
        },
      }),
    ).resolves.toEqual(visit());

    expect(repo.getVisitMode).toHaveBeenCalledWith(ctx(), 'packet_1');
  });

  it('rejects missing visit read scope', async () => {
    const handler = createGetVisitModeHandler(repository());

    const response = (await handler({
      ctx: ctx({ scopes: [] }),
      body: undefined,
      event: { pathParameters: { packet_id: 'packet_1' } },
    })) as PhosLambdaResponse;

    expect(response).toMatchObject({ statusCode: 403 });
    expect(JSON.parse(response.body)).toMatchObject({
      error_code: 'FORBIDDEN',
      details: { missing_scopes: ['phos/visit-mode.read'] },
    });
  });

  it('updates ARRIVAL_CONFIRM with validated arrival outcome and version', async () => {
    const repo = repository();
    const handler = createUpdateVisitStepHandler(repo);

    await expect(
      handler({
        ctx: ctx(),
        body: {
          idempotency_key: 'idem_1',
          client_version: 3,
          payload: { arrival_outcome: VisitArrivalOutcome.PRESENT },
        },
        event: {
          routeKey: 'POST /visit-packets/{packet_id}/visit-steps/{step}',
          pathParameters: { packet_id: 'packet_1', step: VisitStep.ARRIVAL_CONFIRM },
        },
      }),
    ).resolves.toEqual(visit({ server_version: 4 }));

    expect(repo.updateVisitStep).toHaveBeenCalledWith(
      ctx(),
      'packet_1',
      VisitStep.ARRIVAL_CONFIRM,
      {
        idempotency_key: 'idem_1',
        client_version: 3,
        payload: { arrival_outcome: VisitArrivalOutcome.PRESENT },
      },
    );
  });

  it('rejects CANCELED arrival without a reason', async () => {
    const repo = repository();
    const handler = createUpdateVisitStepHandler(repo);

    const response = (await handler({
      ctx: ctx(),
      body: {
        idempotency_key: 'idem_1',
        client_version: 3,
        payload: { arrival_outcome: VisitArrivalOutcome.CANCELED },
      },
      event: { pathParameters: { packet_id: 'packet_1', step: VisitStep.ARRIVAL_CONFIRM } },
    })) as PhosLambdaResponse;

    expect(response).toMatchObject({ statusCode: 400 });
    expect(JSON.parse(response.body)).toMatchObject({
      error_code: 'VALIDATION_ERROR',
      details: { reason: 'required_for_canceled' },
    });
    expect(repo.updateVisitStep).not.toHaveBeenCalled();
  });

  it('rejects invalid step and missing idempotency before repository mutation', async () => {
    const repo = repository();
    const handler = createUpdateVisitStepHandler(repo);

    const response = (await handler({
      ctx: ctx(),
      body: { client_version: 3 },
      event: { pathParameters: { packet_id: 'packet_1', step: 'BAD_STEP' } },
    })) as PhosLambdaResponse;

    expect(response).toMatchObject({ statusCode: 400 });
    expect(JSON.parse(response.body)).toMatchObject({
      error_code: 'VALIDATION_ERROR',
      details: { field: 'step' },
    });
    expect(repo.updateVisitStep).not.toHaveBeenCalled();
  });

  it('rejects empty evidence keys before repository mutation', async () => {
    const repo = repository();
    const handler = createUpdateVisitStepHandler(repo);

    const response = (await handler({
      ctx: ctx(),
      body: {
        idempotency_key: 'idem_1',
        client_version: 3,
        payload: { evidence_key: '   ' },
      },
      event: { pathParameters: { packet_id: 'packet_1', step: VisitStep.EVIDENCE_UPLOAD } },
    })) as PhosLambdaResponse;

    expect(response).toMatchObject({ statusCode: 400 });
    expect(JSON.parse(response.body)).toMatchObject({
      error_code: 'VALIDATION_ERROR',
      details: { field: 'payload.evidence_key' },
    });
    expect(repo.updateVisitStep).not.toHaveBeenCalled();
  });
});
