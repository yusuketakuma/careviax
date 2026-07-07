import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { allocateDisplayIdMock } = vi.hoisted(() => ({
  allocateDisplayIdMock: vi.fn(),
}));

vi.mock('@/lib/db/display-id', () => ({
  allocateDisplayId: allocateDisplayIdMock,
}));

import {
  applyInboundSignalToMedicationStock,
  type ApplyInboundMedicationStockSignalDb,
} from './apply-inbound-medication-stock-signal';

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
    .join(',')}}`;
}

function buildRequestFingerprint(input: {
  signalId: string;
  targetStockItemId: string;
  quantity: number;
  unit: string;
  eventAt: string | null;
}) {
  return `medication-stock-apply-request:v1:${createHash('sha256')
    .update(
      stableStringify({
        signal_id: input.signalId,
        target_stock_item_id: input.targetStockItemId,
        observation: {
          kind: 'observed_absolute',
          quantity: input.quantity,
          unit: input.unit,
          event_at: input.eventAt,
        },
      }),
    )
    .digest('hex')}`;
}

function createDb() {
  return {
    $queryRaw: vi.fn(),
    inboundCommunicationSignal: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    patient: {
      findFirst: vi.fn(),
    },
    careCase: {
      findMany: vi.fn(),
    },
    patientMedicationStockItem: {
      findFirst: vi.fn(),
    },
    externalMedicationStockObservation: {
      create: vi.fn(),
      update: vi.fn(),
    },
    medicationStockEvent: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    medicationStockSnapshot: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
    task: {
      updateMany: vi.fn(),
    },
  };
}

function mockAcceptedSignal() {
  return {
    id: 'signal_1',
    inbound_event_id: 'event_1',
    patient_id: 'patient_1',
    case_id: 'case_1',
    signal_domain: 'medication_stock',
    signal_type: 'observed_quantity',
    source_confidence: 'manual',
    extracted_medication_name: '湿布',
    review_status: 'accepted',
    action_status: 'not_linked',
    inbound_event: {
      id: 'event_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      sender_role: 'nurse',
      occurred_at: new Date('2026-07-07T07:20:00.000Z'),
      received_at: new Date('2026-07-07T07:21:00.000Z'),
    },
  };
}

function setupHappyPath(db: ReturnType<typeof createDb>) {
  db.inboundCommunicationSignal.findFirst.mockResolvedValue(mockAcceptedSignal());
  db.patient.findFirst.mockResolvedValue({
    id: 'patient_1',
    cases: [{ id: 'case_1' }],
  });
  db.patientMedicationStockItem.findFirst.mockResolvedValue({
    id: 'stock_item_1',
    patient_id: 'patient_1',
    case_id: 'case_1',
    unit: 'sheet',
    default_usage_amount_per_day: '1',
    medication_category: 'topical',
  });
  db.medicationStockEvent.findFirst.mockResolvedValue(null);
  db.inboundCommunicationSignal.updateMany.mockResolvedValue({ count: 1 });
  db.externalMedicationStockObservation.create.mockResolvedValue({ id: 'external_observation_1' });
  db.medicationStockEvent.create.mockResolvedValue({ id: 'stock_event_1' });
  db.externalMedicationStockObservation.update.mockResolvedValue({ id: 'external_observation_1' });
  db.medicationStockEvent.findMany.mockResolvedValue([
    {
      id: 'stock_event_1',
      event_at: new Date('2026-07-07T07:20:00.000Z'),
      created_at: new Date('2026-07-07T07:20:10.000Z'),
      quantity_kind: 'observed_absolute',
      quantity_delta: null,
      observed_quantity: '4',
      unit: 'sheet',
    },
  ]);
  db.medicationStockSnapshot.upsert.mockResolvedValue({
    current_quantity: '4',
    stock_risk_level: 'watch',
    calculated_at: new Date('2026-07-07T07:30:00.000Z'),
  });
  db.task.updateMany.mockResolvedValue({ count: 1 });
  allocateDisplayIdMock
    .mockResolvedValueOnce('emso0000000001')
    .mockResolvedValueOnce('msev0000000001')
    .mockResolvedValueOnce('mss0000000001');
}

describe('applyInboundSignalToMedicationStock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-07T07:30:00.000Z'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies an accepted observed quantity signal as an append-only event and snapshot update', async () => {
    const db = createDb();
    setupHappyPath(db);

    const result = await applyInboundSignalToMedicationStock(
      db as unknown as ApplyInboundMedicationStockSignalDb,
      {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
        signalId: 'signal_1',
        targetStockItemId: 'stock_item_1',
        idempotencyKey: 'apply-1',
        observation: {
          kind: 'observed_absolute',
          quantity: 4,
          unit: 'sheet',
          eventAt: new Date('2026-07-07T07:20:00.000Z'),
        },
      },
    );

    expect(result).toMatchObject({
      kind: 'applied',
      data: {
        signal_id: 'signal_1',
        stock_item_id: 'stock_item_1',
        stock_event_id: 'stock_event_1',
        external_observation_id: 'external_observation_1',
        action_status: 'linked_to_stock_event',
        snapshot: {
          current_quantity: 4,
          stock_risk_level: 'watch',
        },
        review_task_closure_count: 1,
        idempotent_replay: false,
      },
    });
    expect(db.inboundCommunicationSignal.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'signal_1',
        org_id: 'org_1',
        review_status: 'accepted',
        action_status: 'not_linked',
      },
      data: {
        action_status: 'linked_to_stock_event',
      },
    });
    expect(db.externalMedicationStockObservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          display_id: 'emso0000000001',
          patient_id: 'patient_1',
          inbound_signal_id: 'signal_1',
          matched_stock_item_id: 'stock_item_1',
          extracted_quantity: expect.anything(),
          extracted_unit: 'sheet',
          review_state: 'applied',
        }),
      }),
    );
    expect(db.medicationStockEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          display_id: 'msev0000000001',
          event_type: 'external_observation_apply',
          quantity_kind: 'observed_absolute',
          observed_quantity: expect.anything(),
          source_entity_type: 'inbound_signal',
          source_signal_id: 'signal_1',
          external_observation_id: 'external_observation_1',
        }),
      }),
    );
    expect(db.medicationStockSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id_stock_item_id: {
            org_id: 'org_1',
            stock_item_id: 'stock_item_1',
          },
        },
        create: expect.objectContaining({
          display_id: 'mss0000000001',
          current_quantity: expect.anything(),
          stock_risk_level: 'watch',
        }),
      }),
    );
    expect(db.task.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          dedupe_key: { startsWith: 'inbound:signal_1:' },
          status: { in: ['pending', 'in_progress'] },
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain('湿布');
    expect(JSON.stringify(result)).not.toContain('apply-1');
  });

  it('rejects non-pharmacist roles before DB reads', async () => {
    const db = createDb();

    const result = await applyInboundSignalToMedicationStock(
      db as unknown as ApplyInboundMedicationStockSignalDb,
      {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'clerk',
        signalId: 'signal_1',
        targetStockItemId: 'stock_item_1',
        idempotencyKey: 'apply-1',
        observation: {
          kind: 'observed_absolute',
          quantity: 4,
          unit: 'sheet',
        },
      },
    );

    expect(result).toEqual({
      kind: 'forbidden',
      message: '残数台帳への反映権限がありません',
    });
    expect(db.inboundCommunicationSignal.findFirst).not.toHaveBeenCalled();
  });

  it('rejects accepted text-only stock signals in the first slice', async () => {
    const db = createDb();
    setupHappyPath(db);
    db.inboundCommunicationSignal.findFirst.mockResolvedValueOnce({
      ...mockAcceptedSignal(),
      signal_type: 'low_stock_text',
    });

    const result = await applyInboundSignalToMedicationStock(
      db as unknown as ApplyInboundMedicationStockSignalDb,
      {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
        signalId: 'signal_1',
        targetStockItemId: 'stock_item_1',
        idempotencyKey: 'apply-1',
        observation: {
          kind: 'observed_absolute',
          quantity: 4,
          unit: 'sheet',
        },
      },
    );

    expect(result).toMatchObject({ kind: 'invalid_state' });
    expect(db.medicationStockEvent.create).not.toHaveBeenCalled();
  });

  it('rejects unit mismatch before linking the signal', async () => {
    const db = createDb();
    setupHappyPath(db);

    const result = await applyInboundSignalToMedicationStock(
      db as unknown as ApplyInboundMedicationStockSignalDb,
      {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
        signalId: 'signal_1',
        targetStockItemId: 'stock_item_1',
        idempotencyKey: 'apply-1',
        observation: {
          kind: 'observed_absolute',
          quantity: 4,
          unit: 'tablet',
        },
      },
    );

    expect(result).toEqual({
      kind: 'validation_error',
      message: '残数単位が残数管理対象薬剤と一致しません',
    });
    expect(db.inboundCommunicationSignal.updateMany).not.toHaveBeenCalled();
    expect(db.medicationStockEvent.create).not.toHaveBeenCalled();
  });

  it('detects idempotency conflicts without returning raw keys', async () => {
    const db = createDb();
    setupHappyPath(db);
    db.medicationStockEvent.findFirst.mockResolvedValueOnce({
      id: 'stock_event_existing',
      stock_item_id: 'stock_item_1',
      source_signal_id: 'signal_1',
      external_observation_id: 'external_observation_1',
      request_fingerprint_hash: 'different',
    });

    const result = await applyInboundSignalToMedicationStock(
      db as unknown as ApplyInboundMedicationStockSignalDb,
      {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
        signalId: 'signal_1',
        targetStockItemId: 'stock_item_1',
        idempotencyKey: 'apply-secret-key',
        observation: {
          kind: 'observed_absolute',
          quantity: 4,
          unit: 'sheet',
          eventAt: new Date('2026-07-07T07:20:00.000Z'),
        },
      },
    );

    expect(result).toEqual({
      kind: 'conflict',
      message: '同じ冪等キーで異なる反映内容が指定されています',
    });
    expect(JSON.stringify(result)).not.toContain('apply-secret-key');
    expect(db.medicationStockEvent.create).not.toHaveBeenCalled();
  });

  it('replays a matching idempotent application without appending another event', async () => {
    const db = createDb();
    setupHappyPath(db);
    const requestFingerprint = buildRequestFingerprint({
      signalId: 'signal_1',
      targetStockItemId: 'stock_item_1',
      quantity: 4,
      unit: 'sheet',
      eventAt: '2026-07-07T07:20:00.000Z',
    });
    db.inboundCommunicationSignal.findFirst.mockResolvedValueOnce({
      ...mockAcceptedSignal(),
      action_status: 'linked_to_stock_event',
    });
    db.medicationStockEvent.findFirst.mockResolvedValueOnce({
      id: 'stock_event_existing',
      stock_item_id: 'stock_item_1',
      source_signal_id: 'signal_1',
      external_observation_id: 'external_observation_1',
      request_fingerprint_hash: requestFingerprint,
    });
    db.medicationStockSnapshot.findFirst.mockResolvedValueOnce({
      current_quantity: '4',
      stock_risk_level: 'watch',
      calculated_at: new Date('2026-07-07T07:22:00.000Z'),
    });

    const result = await applyInboundSignalToMedicationStock(
      db as unknown as ApplyInboundMedicationStockSignalDb,
      {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
        signalId: 'signal_1',
        targetStockItemId: 'stock_item_1',
        idempotencyKey: 'apply-1',
        observation: {
          kind: 'observed_absolute',
          quantity: 4,
          unit: 'sheet',
          eventAt: new Date('2026-07-07T07:20:00.000Z'),
        },
      },
    );

    expect(result).toMatchObject({
      kind: 'applied',
      data: {
        stock_event_id: 'stock_event_existing',
        idempotent_replay: true,
      },
    });
    expect(db.medicationStockEvent.create).not.toHaveBeenCalled();
    expect(db.externalMedicationStockObservation.create).not.toHaveBeenCalled();
  });
});
