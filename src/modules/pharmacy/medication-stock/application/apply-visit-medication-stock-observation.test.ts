import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { allocateDisplayIdMock, upsertOperationalTaskMock } = vi.hoisted(() => ({
  allocateDisplayIdMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
}));

vi.mock('@/lib/db/display-id', () => ({
  allocateDisplayId: allocateDisplayIdMock,
}));

vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
}));

import {
  applyVisitMedicationStockObservations,
  type ApplyVisitMedicationStockObservationsDb,
  type VisitMedicationStockObservationKind,
} from './apply-visit-medication-stock-observation';

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
    .join(',')}}`;
}

function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function toDateKeyJst(value: Date) {
  const formatter = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(value).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function buildIdempotencyKeyHash(args: {
  orgId: string;
  visitRecordId: string;
  clientObservationId: string;
  idempotencyKey: string;
}) {
  return `visit-medication-stock-observation:v1:${sha256Hex(
    stableStringify({
      org_id: args.orgId,
      visit_record_id: args.visitRecordId,
      client_observation_id: args.clientObservationId,
      idempotency_key: args.idempotencyKey,
    }),
  )}`;
}

function buildRequestFingerprint(args: {
  visitRecordId: string;
  stockItemId: string;
  clientObservationId: string;
  kind: VisitMedicationStockObservationKind;
  unit: string;
  eventAt: Date;
}) {
  return `visit-medication-stock-observation-request:v1:${sha256Hex(
    stableStringify({
      visit_record_id: args.visitRecordId,
      stock_item_id: args.stockItemId,
      observation: {
        client_observation_id: args.clientObservationId,
        kind: args.kind,
        unit: args.unit,
        event_at: args.eventAt.toISOString(),
        observed_date_key_jst: toDateKeyJst(args.eventAt),
        quantity: args.kind === 'observed_absolute' ? 4 : null,
        used_quantity: null,
        usage_quantity: null,
        usage_period_days: null,
        last_used_at: null,
        last_used_date_key_jst: null,
        last_used_precision: null,
        unobserved_reason_code: null,
        source_confidence: 'manual',
        source_context_code: 'pharmacist_direct_observation',
        confirmation_level: 'counted_by_pharmacist',
      },
    }),
  )}`;
}

function createDb() {
  return {
    visitRecord: {
      findFirst: vi.fn(),
    },
    visitSchedule: {
      findFirst: vi.fn(),
    },
    patientMedicationStockItem: {
      findMany: vi.fn(),
    },
    medicationStockEvent: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    medicationStockObservationContext: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    medicationStockSnapshot: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
  };
}

function setupBaseDb(db: ReturnType<typeof createDb>) {
  db.visitRecord.findFirst.mockResolvedValue({
    id: 'visit_1',
    patient_id: 'patient_1',
    visit_date: new Date('2026-07-08T01:00:00.000Z'),
    schedule: {
      case_id: 'case_1',
      pharmacist_id: 'user_1',
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    },
  });
  db.patientMedicationStockItem.findMany.mockResolvedValue([
    {
      id: 'stock_item_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      unit: 'sheet',
      default_usage_amount_per_day: '1',
      medication_category: 'topical',
    },
  ]);
  db.medicationStockEvent.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
    {
      id: 'stock_event_1',
      event_at: new Date('2026-07-08T01:30:00.000Z'),
      created_at: new Date('2026-07-08T01:30:05.000Z'),
      quantity_kind: 'observed_absolute',
      quantity_delta: null,
      observed_quantity: '4',
      usage_quantity: null,
      usage_period_days: null,
      unit: 'sheet',
    },
  ]);
  db.medicationStockObservationContext.findMany.mockResolvedValue([]);
  db.medicationStockEvent.create.mockResolvedValue({ id: 'stock_event_1' });
  db.medicationStockObservationContext.create.mockResolvedValue({ id: 'context_1' });
  db.visitSchedule.findFirst.mockResolvedValue({
    scheduled_date: new Date('2026-07-15T00:00:00.000Z'),
  });
  db.medicationStockSnapshot.upsert.mockImplementation(async (args) => ({
    current_quantity: args.create.current_quantity,
    stock_risk_level: args.create.stock_risk_level,
    calculated_at: args.create.calculated_at,
  }));
  allocateDisplayIdMock
    .mockResolvedValueOnce('msev0000000001')
    .mockResolvedValueOnce('msoc0000000001')
    .mockResolvedValueOnce('mss0000000001');
}

describe('applyVisitMedicationStockObservations', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-08T01:40:00.000Z'));
    vi.clearAllMocks();
    allocateDisplayIdMock.mockReset();
    upsertOperationalTaskMock.mockReset();
    upsertOperationalTaskMock.mockResolvedValue({ id: 'task_1', display_id: 'task0000000001' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records a visit observed absolute quantity as an append-only event plus sidecar context', async () => {
    const db = createDb();
    setupBaseDb(db);

    const result = await applyVisitMedicationStockObservations(
      db as unknown as ApplyVisitMedicationStockObservationsDb,
      {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
        visitRecordId: 'visit_1',
        idempotencyKey: 'visit-submit-1',
        observations: [
          {
            clientObservationId: 'obs_1',
            stockItemId: 'stock_item_1',
            kind: 'observed_absolute',
            quantity: 4,
            unit: 'sheet',
            eventAt: new Date('2026-07-08T01:30:00.000Z'),
          },
        ],
      },
    );

    expect(result).toMatchObject({
      kind: 'applied',
      data: {
        visit_record_id: 'visit_1',
        observations: [
          {
            client_observation_id: 'obs_1',
            stock_item_id: 'stock_item_1',
            stock_event_id: 'stock_event_1',
            observation_context_id: 'context_1',
            event_type: 'visit_observation',
            observation_kind: 'observed_absolute',
            quantity_kind: 'observed_absolute',
            idempotent_replay: false,
          },
        ],
      },
      meta: {
        applied_count: 1,
        replay_count: 0,
      },
    });
    expect(db.medicationStockEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          display_id: 'msev0000000001',
          patient_id: 'patient_1',
          case_id: 'case_1',
          stock_item_id: 'stock_item_1',
          event_type: 'visit_observation',
          quantity_kind: 'observed_absolute',
          observed_quantity: expect.anything(),
          source_entity_type: 'visit_record',
          source_entity_id: 'visit_1',
        }),
      }),
    );
    expect(db.medicationStockObservationContext.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          display_id: 'msoc0000000001',
          stock_event_id: 'stock_event_1',
          context_kind: 'visit_observation',
          observation_kind: 'observed_absolute',
          visit_record_id: 'visit_1',
          observed_date_key_jst: '2026-07-08',
          source_context_code: 'pharmacist_direct_observation',
          confirmation_level: 'counted_by_pharmacist',
        }),
      }),
    );
    expect(db.visitSchedule.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          case_id: 'case_1',
          scheduled_date: { gt: new Date('2026-07-08T00:00:00.000Z') },
          schedule_status: {
            in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'],
          },
        }),
      }),
    );
    expect(db.medicationStockSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          stock_risk_level: 'shortage_expected',
        }),
      }),
    );
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        orgId: 'org_1',
        taskType: 'pharmacy.medication_stock_shortage_expected',
        title: '残数不足見込み',
        priority: 'urgent',
        assignedTo: 'user_1',
        dedupeKey: 'medication-stock:shortage-expected:stock-item:stock_item_1',
        relatedEntityType: 'patient',
        relatedEntityId: 'patient_1',
        metadata: {
          source: 'visit_medication_stock_observation',
          schema_version: 1,
          stock_item_id: 'stock_item_1',
          stock_event_id: 'stock_event_1',
          observation_context_id: 'context_1',
          visit_record_id: 'visit_1',
          case_id: 'case_1',
          stock_risk_level: 'shortage_expected',
          observation_kind: 'observed_absolute',
        },
      }),
    );
    const metadataText = JSON.stringify(upsertOperationalTaskMock.mock.calls[0][1].metadata);
    expect(metadataText).not.toContain('patient_name');
    expect(metadataText).not.toContain('drug_name');
    expect(metadataText).not.toContain('raw_reason');
    expect(metadataText).not.toContain('idempotency_key_hash');
    expect(metadataText).not.toContain('request_fingerprint_hash');
    expect(metadataText).not.toContain('sheet');
    expect(metadataText).not.toContain('quantity');
  });

  it('persists refill_request as a controlled visit observation kind instead of collapsing it', async () => {
    const db = createDb();
    setupBaseDb(db);
    db.medicationStockEvent.findMany
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    db.visitSchedule.findFirst.mockResolvedValue(null);
    db.medicationStockSnapshot.upsert.mockResolvedValue({
      current_quantity: null,
      stock_risk_level: 'unknown',
      calculated_at: new Date('2026-07-08T01:40:00.000Z'),
    });

    const result = await applyVisitMedicationStockObservations(
      db as unknown as ApplyVisitMedicationStockObservationsDb,
      {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
        visitRecordId: 'visit_1',
        idempotencyKey: 'visit-submit-2',
        observations: [
          {
            clientObservationId: 'obs_refill',
            stockItemId: 'stock_item_1',
            kind: 'refill_request',
            unit: 'sheet',
            eventAt: new Date('2026-07-08T01:30:00.000Z'),
          },
        ],
      },
    );

    expect(result).toMatchObject({
      kind: 'applied',
      data: {
        observations: [
          {
            observation_kind: 'refill_request',
            quantity_kind: 'no_quantity',
          },
        ],
      },
    });
    expect(db.medicationStockObservationContext.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          observation_kind: 'refill_request',
        }),
      }),
    );
    expect(db.medicationStockSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          stock_risk_level: 'unknown',
          risk_reason_code: 'forecast_missing_quantity',
        }),
      }),
    );
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate idempotency keys with a different clinical fingerprint', async () => {
    const db = createDb();
    setupBaseDb(db);
    const idempotencyHash = buildIdempotencyKeyHash({
      orgId: 'org_1',
      visitRecordId: 'visit_1',
      clientObservationId: 'obs_1',
      idempotencyKey: 'visit-submit-1',
    });
    db.medicationStockEvent.findMany.mockReset().mockResolvedValue([
      {
        id: 'stock_event_1',
        stock_item_id: 'stock_item_1',
        source_entity_type: 'visit_record',
        source_entity_id: 'visit_1',
        idempotency_key_hash: idempotencyHash,
        request_fingerprint_hash: 'different',
      },
    ]);
    db.medicationStockObservationContext.findMany.mockResolvedValue([
      {
        id: 'context_1',
        stock_event_id: 'stock_event_1',
        visit_record_id: 'visit_1',
        observation_kind: 'observed_absolute',
        idempotency_key_hash: idempotencyHash,
        request_fingerprint_hash: 'different',
      },
    ]);

    const result = await applyVisitMedicationStockObservations(
      db as unknown as ApplyVisitMedicationStockObservationsDb,
      {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
        visitRecordId: 'visit_1',
        idempotencyKey: 'visit-submit-1',
        observations: [
          {
            clientObservationId: 'obs_1',
            stockItemId: 'stock_item_1',
            kind: 'observed_absolute',
            quantity: 5,
            unit: 'sheet',
            eventAt: new Date('2026-07-08T01:30:00.000Z'),
          },
        ],
      },
    );

    expect(result).toEqual({
      kind: 'conflict',
      message: '同じ冪等キーで異なる残数観測が指定されています',
    });
    expect(db.medicationStockEvent.create).not.toHaveBeenCalled();
    expect(db.medicationStockObservationContext.create).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate client observation ids before loading visit data', async () => {
    const db = createDb();

    const result = await applyVisitMedicationStockObservations(
      db as unknown as ApplyVisitMedicationStockObservationsDb,
      {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
        visitRecordId: 'visit_1',
        idempotencyKey: 'visit-submit-1',
        observations: [
          {
            clientObservationId: 'obs_1',
            stockItemId: 'stock_item_1',
            kind: 'observed_absolute',
            quantity: 4,
            unit: 'sheet',
          },
          {
            clientObservationId: 'obs_1',
            stockItemId: 'stock_item_2',
            kind: 'observed_absolute',
            quantity: 2,
            unit: 'sheet',
          },
        ],
      },
    );

    expect(result).toEqual({
      kind: 'validation_error',
      message: '同じ観測IDがリクエスト内で重複しています',
    });
    expect(db.visitRecord.findFirst).not.toHaveBeenCalled();
  });

  it('returns an idempotent replay only when the event and context pair match', async () => {
    const db = createDb();
    setupBaseDb(db);
    const eventAt = new Date('2026-07-08T01:30:00.000Z');
    const idempotencyHash = buildIdempotencyKeyHash({
      orgId: 'org_1',
      visitRecordId: 'visit_1',
      clientObservationId: 'obs_1',
      idempotencyKey: 'visit-submit-1',
    });
    const requestFingerprintHash = buildRequestFingerprint({
      visitRecordId: 'visit_1',
      stockItemId: 'stock_item_1',
      clientObservationId: 'obs_1',
      kind: 'observed_absolute',
      unit: 'sheet',
      eventAt,
    });
    db.medicationStockEvent.findMany.mockReset().mockResolvedValue([
      {
        id: 'stock_event_1',
        stock_item_id: 'stock_item_1',
        source_entity_type: 'visit_record',
        source_entity_id: 'visit_1',
        idempotency_key_hash: idempotencyHash,
        request_fingerprint_hash: requestFingerprintHash,
      },
    ]);
    db.medicationStockObservationContext.findMany.mockResolvedValue([
      {
        id: 'context_1',
        stock_event_id: 'stock_event_1',
        visit_record_id: 'visit_1',
        observation_kind: 'observed_absolute',
        idempotency_key_hash: idempotencyHash,
        request_fingerprint_hash: requestFingerprintHash,
      },
    ]);
    db.medicationStockSnapshot.findFirst.mockResolvedValue({
      current_quantity: '4',
      stock_risk_level: 'watch',
      calculated_at: new Date('2026-07-08T01:40:00.000Z'),
    });

    const result = await applyVisitMedicationStockObservations(
      db as unknown as ApplyVisitMedicationStockObservationsDb,
      {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
        visitRecordId: 'visit_1',
        idempotencyKey: 'visit-submit-1',
        observations: [
          {
            clientObservationId: 'obs_1',
            stockItemId: 'stock_item_1',
            kind: 'observed_absolute',
            quantity: 4,
            unit: 'sheet',
            eventAt,
          },
        ],
      },
    );

    expect(result).toMatchObject({
      kind: 'applied',
      data: {
        observations: [
          {
            stock_event_id: 'stock_event_1',
            observation_context_id: 'context_1',
            idempotent_replay: true,
          },
        ],
      },
      meta: {
        applied_count: 0,
        replay_count: 1,
      },
    });
    expect(db.medicationStockEvent.create).not.toHaveBeenCalled();
    expect(db.medicationStockObservationContext.create).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('does not create a shortage task when the final same-item snapshot is no longer risky', async () => {
    const db = createDb();
    setupBaseDb(db);
    db.medicationStockEvent.findMany
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'stock_event_1',
          event_at: new Date('2026-07-08T01:30:00.000Z'),
          created_at: new Date('2026-07-08T01:30:05.000Z'),
          quantity_kind: 'observed_absolute',
          quantity_delta: null,
          observed_quantity: '1',
          usage_quantity: null,
          usage_period_days: null,
          unit: 'sheet',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'stock_event_2',
          event_at: new Date('2026-07-08T01:35:00.000Z'),
          created_at: new Date('2026-07-08T01:35:05.000Z'),
          quantity_kind: 'observed_absolute',
          quantity_delta: null,
          observed_quantity: '20',
          usage_quantity: null,
          usage_period_days: null,
          unit: 'sheet',
        },
      ]);
    db.medicationStockEvent.create
      .mockResolvedValueOnce({ id: 'stock_event_1' })
      .mockResolvedValueOnce({ id: 'stock_event_2' });
    db.medicationStockObservationContext.create
      .mockResolvedValueOnce({ id: 'context_1' })
      .mockResolvedValueOnce({ id: 'context_2' });
    db.medicationStockSnapshot.upsert
      .mockResolvedValueOnce({
        current_quantity: '1',
        stock_risk_level: 'shortage_expected',
        calculated_at: new Date('2026-07-08T01:40:00.000Z'),
      })
      .mockResolvedValueOnce({
        current_quantity: '20',
        stock_risk_level: 'ok',
        calculated_at: new Date('2026-07-08T01:40:00.000Z'),
      });

    const result = await applyVisitMedicationStockObservations(
      db as unknown as ApplyVisitMedicationStockObservationsDb,
      {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
        visitRecordId: 'visit_1',
        idempotencyKey: 'visit-submit-1',
        observations: [
          {
            clientObservationId: 'obs_1',
            stockItemId: 'stock_item_1',
            kind: 'observed_absolute',
            quantity: 1,
            unit: 'sheet',
            eventAt: new Date('2026-07-08T01:30:00.000Z'),
          },
          {
            clientObservationId: 'obs_2',
            stockItemId: 'stock_item_1',
            kind: 'observed_absolute',
            quantity: 20,
            unit: 'sheet',
            eventAt: new Date('2026-07-08T01:35:00.000Z'),
          },
        ],
      },
    );

    expect(result).toMatchObject({
      kind: 'applied',
      meta: {
        applied_count: 2,
        replay_count: 0,
      },
    });
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('creates one shortage task using the final same-item risky snapshot', async () => {
    const db = createDb();
    setupBaseDb(db);
    db.medicationStockEvent.findMany
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'stock_event_1',
          event_at: new Date('2026-07-08T01:30:00.000Z'),
          created_at: new Date('2026-07-08T01:30:05.000Z'),
          quantity_kind: 'observed_absolute',
          quantity_delta: null,
          observed_quantity: '20',
          usage_quantity: null,
          usage_period_days: null,
          unit: 'sheet',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'stock_event_2',
          event_at: new Date('2026-07-08T01:35:00.000Z'),
          created_at: new Date('2026-07-08T01:35:05.000Z'),
          quantity_kind: 'observed_absolute',
          quantity_delta: null,
          observed_quantity: '1',
          usage_quantity: null,
          usage_period_days: null,
          unit: 'sheet',
        },
      ]);
    db.medicationStockEvent.create
      .mockResolvedValueOnce({ id: 'stock_event_1' })
      .mockResolvedValueOnce({ id: 'stock_event_2' });
    db.medicationStockObservationContext.create
      .mockResolvedValueOnce({ id: 'context_1' })
      .mockResolvedValueOnce({ id: 'context_2' });
    db.medicationStockSnapshot.upsert
      .mockResolvedValueOnce({
        current_quantity: '20',
        stock_risk_level: 'ok',
        calculated_at: new Date('2026-07-08T01:40:00.000Z'),
      })
      .mockResolvedValueOnce({
        current_quantity: '1',
        stock_risk_level: 'urgent',
        calculated_at: new Date('2026-07-08T01:40:00.000Z'),
      });

    const result = await applyVisitMedicationStockObservations(
      db as unknown as ApplyVisitMedicationStockObservationsDb,
      {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
        visitRecordId: 'visit_1',
        idempotencyKey: 'visit-submit-1',
        observations: [
          {
            clientObservationId: 'obs_1',
            stockItemId: 'stock_item_1',
            kind: 'observed_absolute',
            quantity: 20,
            unit: 'sheet',
            eventAt: new Date('2026-07-08T01:30:00.000Z'),
          },
          {
            clientObservationId: 'obs_2',
            stockItemId: 'stock_item_1',
            kind: 'observed_absolute',
            quantity: 1,
            unit: 'sheet',
            eventAt: new Date('2026-07-08T01:35:00.000Z'),
          },
        ],
      },
    );

    expect(result).toMatchObject({
      kind: 'applied',
      meta: {
        applied_count: 2,
        replay_count: 0,
      },
    });
    expect(upsertOperationalTaskMock).toHaveBeenCalledTimes(1);
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        dedupeKey: 'medication-stock:shortage-expected:stock-item:stock_item_1',
        metadata: expect.objectContaining({
          stock_event_id: 'stock_event_2',
          observation_context_id: 'context_2',
          stock_risk_level: 'urgent',
          observation_kind: 'observed_absolute',
        }),
      }),
    );
  });

  it('fails closed instead of returning false success when shortage task fan-out fails', async () => {
    const db = createDb();
    setupBaseDb(db);
    upsertOperationalTaskMock.mockRejectedValueOnce(new Error('task storage unavailable'));

    await expect(
      applyVisitMedicationStockObservations(
        db as unknown as ApplyVisitMedicationStockObservationsDb,
        {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
          visitRecordId: 'visit_1',
          idempotencyKey: 'visit-submit-1',
          observations: [
            {
              clientObservationId: 'obs_1',
              stockItemId: 'stock_item_1',
              kind: 'observed_absolute',
              quantity: 4,
              unit: 'sheet',
              eventAt: new Date('2026-07-08T01:30:00.000Z'),
            },
          ],
        },
      ),
    ).rejects.toThrow('task storage unavailable');
  });

  it('fails closed for non-pharmacist stock writes and stock unit mismatches', async () => {
    const db = createDb();
    setupBaseDb(db);

    await expect(
      applyVisitMedicationStockObservations(
        db as unknown as ApplyVisitMedicationStockObservationsDb,
        {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist_trainee',
          visitRecordId: 'visit_1',
          idempotencyKey: 'visit-submit-1',
          observations: [
            {
              clientObservationId: 'obs_1',
              stockItemId: 'stock_item_1',
              kind: 'observed_absolute',
              quantity: 4,
              unit: 'sheet',
            },
          ],
        },
      ),
    ).resolves.toEqual({
      kind: 'forbidden',
      message: '残数台帳への記録権限がありません',
    });

    const mismatch = await applyVisitMedicationStockObservations(
      db as unknown as ApplyVisitMedicationStockObservationsDb,
      {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
        visitRecordId: 'visit_1',
        idempotencyKey: 'visit-submit-1',
        observations: [
          {
            clientObservationId: 'obs_1',
            stockItemId: 'stock_item_1',
            kind: 'observed_absolute',
            quantity: 4,
            unit: 'tablet',
          },
        ],
      },
    );

    expect(mismatch).toEqual({
      kind: 'validation_error',
      message: '残数単位が残数管理対象薬剤と一致しません',
    });
    expect(db.medicationStockEvent.create).not.toHaveBeenCalled();
  });
});
