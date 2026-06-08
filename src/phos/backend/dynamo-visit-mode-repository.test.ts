import { describe, expect, it, vi } from 'vitest';
import {
  UserRole,
  VisitStatus,
  VisitStep,
  type VisitModeView,
} from '@/phos/contracts/phos_contracts';
import { toDynamoAttributeValue } from './dynamodb-attribute-values';
import { createDynamoVisitModeRepository } from './dynamo-visit-mode-repository';
import type { DynamoVisitModeClient } from './dynamo-visit-mode-repository';
import type { TenantContext } from './tenant-context';

const ctx: TenantContext = {
  tenant_id: 'tenant_abc123',
  user_id: 'user_1',
  role: UserRole.PHARMACIST,
  request_id: 'req_1',
  correlation_id: 'corr_1',
  scopes: ['phos/visit-mode.write'],
};

function visit(overrides: Partial<VisitModeView> = {}): VisitModeView {
  return {
    packet_id: 'packet_1',
    server_version: 3,
    patient_name: '患者 山田太郎',
    visit_status: VisitStatus.IN_PROGRESS,
    applicable_steps: [VisitStep.ARRIVAL_CONFIRM],
    required_steps: [VisitStep.ARRIVAL_CONFIRM],
    step_completed: Object.fromEntries(
      Object.values(VisitStep).map((step) => [step, false]),
    ) as Record<VisitStep, boolean>,
    last_opened_step: VisitStep.ARRIVAL_CONFIRM,
    evidence_sync: { blocking_unsynced_count: 0, non_blocking_unsynced_count: 0 },
    online: true,
    ...overrides,
  };
}

function client(overrides: Partial<DynamoVisitModeClient> = {}): DynamoVisitModeClient {
  return {
    getVisitPacket: vi.fn(async () => ({ visit_mode: toDynamoAttributeValue(visit()) })),
    getIdempotency: vi.fn(async () => null),
    transactCommitVisitStep: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('createDynamoVisitModeRepository', () => {
  it('loads a tenant-scoped VisitModeView without scanning', async () => {
    const fakeClient = client();
    const store = createDynamoVisitModeRepository(fakeClient);

    await expect(store.loadVisitMode(ctx, 'packet_1')).resolves.toEqual(visit());

    expect(fakeClient.getVisitPacket).toHaveBeenCalledWith({
      table_name: 'phos_core',
      partition_key: 'TENANT#tenant_abc123',
      sort_key: 'VISIT_PACKET#packet_1',
    });
  });

  it('replays a matching idempotency record', async () => {
    const response = visit({ server_version: 4 });
    const fakeClient = client({
      getIdempotency: vi.fn(async () => ({
        request_fingerprint: { S: 'fingerprint_1' },
        response: { S: JSON.stringify(response) },
      })),
    });
    const store = createDynamoVisitModeRepository(fakeClient);

    await expect(
      store.getIdempotentVisitStep(
        ctx,
        'VISIT_STEP:packet_1:COMPLETE_CHECK',
        'idem_1',
        'fingerprint_1',
      ),
    ).resolves.toEqual({ status: 'MATCH', response });
  });

  it('commits visit packet and idempotency records in one transaction contract', async () => {
    const fakeClient = client();
    const store = createDynamoVisitModeRepository(fakeClient, {
      now: () => new Date('2026-06-09T00:00:00.000Z'),
    });
    const response = visit({ server_version: 4 });

    await expect(
      store.commitVisitStep(ctx, {
        packet_id: 'packet_1',
        step: VisitStep.COMPLETE_CHECK,
        mutation_key: 'VISIT_STEP:packet_1:COMPLETE_CHECK',
        command: { idempotency_key: 'idem_1', client_version: 3 },
        request_fingerprint: 'fingerprint_1',
        previous_visit: visit(),
        response,
      }),
    ).resolves.toEqual(response);

    expect(fakeClient.transactCommitVisitStep).toHaveBeenCalledWith(
      expect.objectContaining({
        table_name: 'phos_core',
        partition_key: 'TENANT#tenant_abc123',
        visit_packet_sort_key: 'VISIT_PACKET#packet_1',
        idempotency_sort_key: 'VISIT_STEP_IDEMPOTENCY#packet_1#COMPLETE_CHECK#idem_1',
        expected_server_version: 3,
        response,
      }),
    );
  });
});
