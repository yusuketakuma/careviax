import { createHash } from 'node:crypto';

import { Prisma, type MedicationStockUnit, type MemberRole } from '@prisma/client';

import { canWriteVisitRecordForSchedule } from '@/lib/auth/visit-schedule-access';
import { allocateDisplayId } from '@/lib/db/display-id';
import type { DateKey } from '../domain/stockout-forecast';
import { decimalToNumber, recalculateMedicationStockSnapshot } from './stock-snapshot';

export type VisitMedicationStockObservationKind =
  | 'observed_absolute'
  | 'usage_delta'
  | 'usage_frequency'
  | 'not_observed'
  | 'refill_request';

export type VisitMedicationStockObservationInput = {
  clientObservationId: string;
  stockItemId: string;
  kind: VisitMedicationStockObservationKind;
  unit: string;
  eventAt?: Date;
  quantity?: number;
  usedQuantity?: number;
  usageQuantity?: number;
  usagePeriodDays?: number;
  lastUsedAt?: Date;
  lastUsedPrecision?: 'exact_datetime' | 'date_only' | 'unknown';
  unobservedReasonCode?:
    | 'patient_refused'
    | 'caregiver_unavailable'
    | 'storage_inaccessible'
    | 'medication_not_present'
    | 'identity_uncertain'
    | 'visit_time_limited'
    | 'safety_priority'
    | 'other_institution_unconfirmed'
    | 'unknown';
  sourceConfidence?:
    | 'structured_exact'
    | 'structured_partial'
    | 'text_parsed_high'
    | 'text_parsed_low'
    | 'manual'
    | 'unknown';
  sourceContextCode?:
    | 'pharmacist_direct_observation'
    | 'patient_report'
    | 'caregiver_report'
    | 'facility_staff_report'
    | 'record_review'
    | 'unknown';
  confirmationLevel?:
    | 'counted_by_pharmacist'
    | 'photo_verified'
    | 'patient_reported'
    | 'caregiver_reported'
    | 'other_professional_reported'
    | 'other_institution_record'
    | 'unknown';
};

export type ApplyVisitMedicationStockObservationsArgs = {
  orgId: string;
  userId: string;
  role: MemberRole;
  visitRecordId: string;
  idempotencyKey: string;
  observedAt?: Date;
  observations: VisitMedicationStockObservationInput[];
};

export type ApplyVisitMedicationStockObservationsSuccess = {
  kind: 'applied';
  data: {
    visit_record_id: string;
    observations: Array<{
      client_observation_id: string;
      stock_item_id: string;
      stock_event_id: string;
      observation_context_id: string;
      event_type: 'visit_observation';
      observation_kind: VisitMedicationStockObservationKind;
      quantity_kind: 'delta' | 'observed_absolute' | 'usage_rate' | 'no_quantity';
      snapshot: {
        current_quantity: number | null;
        stock_risk_level: 'ok' | 'watch' | 'shortage_expected' | 'urgent' | 'unknown';
        calculated_at: string;
      };
      idempotent_replay: boolean;
    }>;
  };
  meta: {
    generated_at: string;
    applied_count: number;
    replay_count: number;
  };
};

export type ApplyVisitMedicationStockObservationsFailure = {
  kind: 'not_found' | 'forbidden' | 'conflict' | 'validation_error';
  message: string;
};

export type ApplyVisitMedicationStockObservationsResult =
  | ApplyVisitMedicationStockObservationsSuccess
  | ApplyVisitMedicationStockObservationsFailure;

export type ApplyVisitMedicationStockObservationsDb = Pick<
  Prisma.TransactionClient,
  | 'visitRecord'
  | 'visitSchedule'
  | 'patientMedicationStockItem'
  | 'medicationStockEvent'
  | 'medicationStockObservationContext'
  | 'medicationStockSnapshot'
>;

type VisitRecordRow = {
  id: string;
  patient_id: string;
  visit_date: Date | null;
  schedule: {
    case_id: string | null;
    pharmacist_id: string | null;
    case_: {
      primary_pharmacist_id: string | null;
      backup_pharmacist_id: string | null;
    } | null;
  } | null;
};

type StockItemRow = {
  id: string;
  patient_id: string;
  case_id: string | null;
  unit: MedicationStockUnit;
  default_usage_amount_per_day: Prisma.Decimal | number | string | null;
  medication_category: string;
};

type ExistingStockEventRow = {
  id: string;
  stock_item_id: string;
  source_entity_type: string;
  source_entity_id: string | null;
  idempotency_key_hash: string;
  request_fingerprint_hash: string;
};

type ExistingObservationContextRow = {
  id: string;
  stock_event_id: string;
  visit_record_id: string | null;
  observation_kind: string;
  idempotency_key_hash: string;
  request_fingerprint_hash: string;
};

const VISIT_STOCK_WRITE_ROLES: ReadonlySet<MemberRole> = new Set(['owner', 'admin', 'pharmacist']);

const MAX_OBSERVATIONS_PER_REQUEST = 50;
const ACTIVE_NEXT_VISIT_SCHEDULE_STATUSES = [
  'planned',
  'in_preparation',
  'ready',
  'departed',
  'in_progress',
] as const;

function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
    .join(',')}}`;
}

function normalizeUnit(unit: string) {
  return unit.normalize('NFKC').trim();
}

function toDateKeyJst(value: Date): DateKey {
  const formatter = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(value).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}` as DateKey;
}

function dateKeyToDbDate(value: DateKey) {
  return new Date(`${value}T00:00:00.000Z`);
}

async function resolveNextVisitDateKeyForStockForecast(args: {
  db: ApplyVisitMedicationStockObservationsDb;
  orgId: string;
  caseId: string | null;
  baseDateKeyJst: DateKey;
}) {
  if (!args.caseId) return null;

  const nextSchedule = (await args.db.visitSchedule.findFirst({
    where: {
      org_id: args.orgId,
      case_id: args.caseId,
      scheduled_date: { gt: dateKeyToDbDate(args.baseDateKeyJst) },
      schedule_status: { in: [...ACTIVE_NEXT_VISIT_SCHEDULE_STATUSES] },
    },
    orderBy: [{ scheduled_date: 'asc' }, { route_order: 'asc' }, { id: 'asc' }],
    select: {
      scheduled_date: true,
    },
  })) as { scheduled_date: Date } | null;

  return nextSchedule ? toDateKeyJst(nextSchedule.scheduled_date) : null;
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
  observation: NormalizedObservation;
}) {
  return `visit-medication-stock-observation-request:v1:${sha256Hex(
    stableStringify({
      visit_record_id: args.visitRecordId,
      stock_item_id: args.stockItemId,
      observation: {
        client_observation_id: args.observation.clientObservationId,
        kind: args.observation.kind,
        unit: args.observation.unit,
        event_at: args.observation.eventAt.toISOString(),
        observed_date_key_jst: args.observation.observedDateKeyJst,
        quantity: args.observation.quantity ?? null,
        used_quantity: args.observation.usedQuantity ?? null,
        usage_quantity: args.observation.usageQuantity ?? null,
        usage_period_days: args.observation.usagePeriodDays ?? null,
        last_used_at: args.observation.lastUsedAt?.toISOString() ?? null,
        last_used_date_key_jst: args.observation.lastUsedDateKeyJst ?? null,
        last_used_precision: args.observation.lastUsedPrecision ?? null,
        unobserved_reason_code: args.observation.unobservedReasonCode ?? null,
        source_confidence: args.observation.sourceConfidence,
        source_context_code: args.observation.sourceContextCode,
        confirmation_level: args.observation.confirmationLevel,
      },
    }),
  )}`;
}

function validateObservationInput(input: VisitMedicationStockObservationInput) {
  if (!input.clientObservationId.trim()) return 'client_observation_idは必須です';
  if (!input.stockItemId.trim()) return 'stock_item_idは必須です';
  if (!input.unit.trim()) return '単位は必須です';

  switch (input.kind) {
    case 'observed_absolute':
      return Number.isFinite(input.quantity) && input.quantity != null && input.quantity >= 0
        ? null
        : '残数は0以上で指定してください';
    case 'usage_delta':
      return Number.isFinite(input.usedQuantity) &&
        input.usedQuantity != null &&
        input.usedQuantity > 0
        ? null
        : '使用量は0より大きい値で指定してください';
    case 'usage_frequency':
      if (
        !Number.isFinite(input.usageQuantity) ||
        input.usageQuantity == null ||
        input.usageQuantity <= 0
      ) {
        return '使用量は0より大きい値で指定してください';
      }
      if (
        !Number.isInteger(input.usagePeriodDays) ||
        input.usagePeriodDays == null ||
        input.usagePeriodDays < 1 ||
        input.usagePeriodDays > 366
      ) {
        return '使用期間日数が不正です';
      }
      return null;
    case 'not_observed':
      return input.unobservedReasonCode ? null : '未確認理由を指定してください';
    case 'refill_request':
      return null;
  }
}

type NormalizedObservation = {
  clientObservationId: string;
  stockItemId: string;
  kind: VisitMedicationStockObservationKind;
  unit: string;
  eventAt: Date;
  observedDateKeyJst: string;
  quantity?: number;
  usedQuantity?: number;
  usageQuantity?: number;
  usagePeriodDays?: number;
  lastUsedAt?: Date;
  lastUsedDateKeyJst?: string;
  lastUsedPrecision?: 'exact_datetime' | 'date_only' | 'unknown';
  unobservedReasonCode?: VisitMedicationStockObservationInput['unobservedReasonCode'];
  sourceConfidence: NonNullable<VisitMedicationStockObservationInput['sourceConfidence']>;
  sourceContextCode: NonNullable<VisitMedicationStockObservationInput['sourceContextCode']>;
  confirmationLevel: NonNullable<VisitMedicationStockObservationInput['confirmationLevel']>;
  idempotencyKeyHash: string;
  requestFingerprintHash: string;
};

function buildStockEventFields(observation: NormalizedObservation) {
  switch (observation.kind) {
    case 'observed_absolute':
      return {
        quantity_kind: 'observed_absolute' as const,
        quantity_delta: null,
        observed_quantity: new Prisma.Decimal(observation.quantity ?? 0),
        usage_quantity: null,
        usage_period_days: null,
      };
    case 'usage_delta':
      return {
        quantity_kind: 'delta' as const,
        quantity_delta: new Prisma.Decimal(-(observation.usedQuantity ?? 0)),
        observed_quantity: null,
        usage_quantity: null,
        usage_period_days: null,
      };
    case 'usage_frequency':
      return {
        quantity_kind: 'usage_rate' as const,
        quantity_delta: null,
        observed_quantity: null,
        usage_quantity: new Prisma.Decimal(observation.usageQuantity ?? 0),
        usage_period_days: observation.usagePeriodDays ?? null,
      };
    case 'not_observed':
    case 'refill_request':
      return {
        quantity_kind: 'no_quantity' as const,
        quantity_delta: null,
        observed_quantity: null,
        usage_quantity: null,
        usage_period_days: null,
      };
  }
}

function snapshotDto(snapshot: {
  current_quantity: Prisma.Decimal | number | string | null;
  stock_risk_level: 'ok' | 'watch' | 'shortage_expected' | 'urgent' | 'unknown';
  calculated_at: Date;
}) {
  return {
    current_quantity: decimalToNumber(snapshot.current_quantity),
    stock_risk_level: snapshot.stock_risk_level,
    calculated_at: snapshot.calculated_at.toISOString(),
  };
}

function validateSameRequestDuplicates(observations: VisitMedicationStockObservationInput[]) {
  const seen = new Set<string>();
  for (const observation of observations) {
    const key = observation.clientObservationId;
    if (seen.has(key)) return '同じ観測IDがリクエスト内で重複しています';
    seen.add(key);
  }
  return null;
}

function normalizeObservation(args: {
  input: VisitMedicationStockObservationInput;
  orgId: string;
  visitRecordId: string;
  defaultEventAt: Date;
  idempotencyKey: string;
  stockItemUnit: string;
  now: Date;
}): NormalizedObservation | string {
  const inputValidation = validateObservationInput(args.input);
  if (inputValidation) return inputValidation;

  const unit = normalizeUnit(args.input.unit);
  if (unit !== args.stockItemUnit) return '残数単位が残数管理対象薬剤と一致しません';

  const eventAt = args.input.eventAt ?? args.defaultEventAt;
  if (!Number.isFinite(eventAt.getTime())) return '観測日時が不正です';
  if (eventAt.getTime() > args.now.getTime() + 5 * 60 * 1000) {
    return '未来日の観測は登録できません';
  }
  if (
    args.input.lastUsedAt &&
    args.input.lastUsedAt.getTime() > args.now.getTime() + 5 * 60 * 1000
  ) {
    return '未来日の最終使用日時は登録できません';
  }

  const base = {
    clientObservationId: args.input.clientObservationId.trim(),
    stockItemId: args.input.stockItemId,
    kind: args.input.kind,
    unit,
    eventAt,
    observedDateKeyJst: toDateKeyJst(eventAt),
    lastUsedAt: args.input.lastUsedAt,
    lastUsedDateKeyJst: args.input.lastUsedAt ? toDateKeyJst(args.input.lastUsedAt) : undefined,
    lastUsedPrecision: args.input.lastUsedAt
      ? (args.input.lastUsedPrecision ?? 'exact_datetime')
      : undefined,
    unobservedReasonCode: args.input.unobservedReasonCode,
    sourceConfidence: args.input.sourceConfidence ?? 'manual',
    sourceContextCode: args.input.sourceContextCode ?? 'pharmacist_direct_observation',
    confirmationLevel: args.input.confirmationLevel ?? 'counted_by_pharmacist',
  } satisfies Omit<NormalizedObservation, 'idempotencyKeyHash' | 'requestFingerprintHash'>;

  const normalized = {
    ...base,
    ...(args.input.quantity !== undefined ? { quantity: args.input.quantity } : {}),
    ...(args.input.usedQuantity !== undefined ? { usedQuantity: args.input.usedQuantity } : {}),
    ...(args.input.usageQuantity !== undefined ? { usageQuantity: args.input.usageQuantity } : {}),
    ...(args.input.usagePeriodDays !== undefined
      ? { usagePeriodDays: args.input.usagePeriodDays }
      : {}),
    idempotencyKeyHash: '',
    requestFingerprintHash: '',
  } satisfies NormalizedObservation;
  normalized.idempotencyKeyHash = buildIdempotencyKeyHash({
    orgId: args.orgId,
    visitRecordId: args.visitRecordId,
    clientObservationId: normalized.clientObservationId,
    idempotencyKey: args.idempotencyKey,
  });
  normalized.requestFingerprintHash = buildRequestFingerprint({
    visitRecordId: args.visitRecordId,
    stockItemId: args.input.stockItemId,
    observation: normalized,
  });
  return normalized;
}

async function readExistingReplayRows(args: {
  db: ApplyVisitMedicationStockObservationsDb;
  orgId: string;
  hashes: string[];
}) {
  const [events, contexts] = await Promise.all([
    args.db.medicationStockEvent.findMany({
      where: {
        org_id: args.orgId,
        idempotency_key_hash: { in: args.hashes },
      },
      select: {
        id: true,
        stock_item_id: true,
        source_entity_type: true,
        source_entity_id: true,
        idempotency_key_hash: true,
        request_fingerprint_hash: true,
      },
    }),
    args.db.medicationStockObservationContext.findMany({
      where: {
        org_id: args.orgId,
        idempotency_key_hash: { in: args.hashes },
      },
      select: {
        id: true,
        stock_event_id: true,
        visit_record_id: true,
        observation_kind: true,
        idempotency_key_hash: true,
        request_fingerprint_hash: true,
      },
    }),
  ]);
  return {
    eventByHash: new Map(
      (events as ExistingStockEventRow[]).map((event) => [event.idempotency_key_hash, event]),
    ),
    contextByHash: new Map(
      (contexts as ExistingObservationContextRow[]).map((context) => [
        context.idempotency_key_hash,
        context,
      ]),
    ),
  };
}

export async function applyVisitMedicationStockObservations(
  db: ApplyVisitMedicationStockObservationsDb,
  args: ApplyVisitMedicationStockObservationsArgs,
): Promise<ApplyVisitMedicationStockObservationsResult> {
  if (!VISIT_STOCK_WRITE_ROLES.has(args.role)) {
    return { kind: 'forbidden', message: '残数台帳への記録権限がありません' };
  }
  if (args.observations.length < 1 || args.observations.length > MAX_OBSERVATIONS_PER_REQUEST) {
    return { kind: 'validation_error', message: '観測は1件以上50件以下で指定してください' };
  }
  const duplicateMessage = validateSameRequestDuplicates(args.observations);
  if (duplicateMessage) return { kind: 'validation_error', message: duplicateMessage };

  const visitRecord = (await db.visitRecord.findFirst({
    where: {
      id: args.visitRecordId,
      org_id: args.orgId,
    },
    select: {
      id: true,
      patient_id: true,
      visit_date: true,
      schedule: {
        select: {
          case_id: true,
          pharmacist_id: true,
          case_: {
            select: {
              primary_pharmacist_id: true,
              backup_pharmacist_id: true,
            },
          },
        },
      },
    },
  })) as VisitRecordRow | null;
  if (!visitRecord) return { kind: 'not_found', message: '訪問記録が見つかりません' };
  if (!visitRecord.schedule || !canWriteVisitRecordForSchedule(args, visitRecord.schedule)) {
    return { kind: 'forbidden', message: 'この訪問記録に残数を記録する権限がありません' };
  }

  const visitCaseId = visitRecord.schedule.case_id;
  const stockIds = Array.from(new Set(args.observations.map((item) => item.stockItemId)));
  const stockItems = (await db.patientMedicationStockItem.findMany({
    where: {
      org_id: args.orgId,
      id: { in: stockIds },
      patient_id: visitRecord.patient_id,
      active: true,
      OR: visitCaseId ? [{ case_id: null }, { case_id: visitCaseId }] : [{ case_id: null }],
    },
    select: {
      id: true,
      patient_id: true,
      case_id: true,
      unit: true,
      default_usage_amount_per_day: true,
      medication_category: true,
    },
  })) as StockItemRow[];
  const stockItemById = new Map(stockItems.map((item) => [item.id, item]));
  if (stockItemById.size !== stockIds.length) {
    return { kind: 'not_found', message: '残数管理対象薬剤が見つかりません' };
  }

  const now = new Date();
  const defaultEventAt = args.observedAt ?? visitRecord.visit_date ?? now;
  const stockForecastBaseDateKeyJst = toDateKeyJst(defaultEventAt);
  const normalizedObservations: NormalizedObservation[] = [];
  for (const input of args.observations) {
    const stockItem = stockItemById.get(input.stockItemId);
    if (!stockItem) return { kind: 'not_found', message: '残数管理対象薬剤が見つかりません' };
    const normalized = normalizeObservation({
      input,
      orgId: args.orgId,
      visitRecordId: visitRecord.id,
      defaultEventAt,
      idempotencyKey: args.idempotencyKey,
      stockItemUnit: stockItem.unit,
      now,
    });
    if (typeof normalized === 'string') {
      return { kind: 'validation_error', message: normalized };
    }
    normalizedObservations.push(normalized);
  }

  const idempotencyHashes = normalizedObservations.map((item) => item.idempotencyKeyHash);
  const { eventByHash, contextByHash } = await readExistingReplayRows({
    db,
    orgId: args.orgId,
    hashes: idempotencyHashes,
  });

  const responseObservations: ApplyVisitMedicationStockObservationsSuccess['data']['observations'] =
    [];
  const observationsToCreate: NormalizedObservation[] = [];

  for (const observation of normalizedObservations) {
    const event = eventByHash.get(observation.idempotencyKeyHash);
    const context = contextByHash.get(observation.idempotencyKeyHash);
    if (!event && !context) {
      observationsToCreate.push(observation);
      continue;
    }
    if (!event || !context) {
      return { kind: 'conflict', message: '残数観測の冪等性情報が不整合です' };
    }
    if (
      event.stock_item_id !== observation.stockItemId ||
      event.source_entity_type !== 'visit_record' ||
      event.source_entity_id !== visitRecord.id ||
      event.request_fingerprint_hash !== observation.requestFingerprintHash ||
      context.stock_event_id !== event.id ||
      context.visit_record_id !== visitRecord.id ||
      context.observation_kind !== observation.kind ||
      context.request_fingerprint_hash !== observation.requestFingerprintHash
    ) {
      return { kind: 'conflict', message: '同じ冪等キーで異なる残数観測が指定されています' };
    }

    const snapshot = await db.medicationStockSnapshot.findFirst({
      where: {
        org_id: args.orgId,
        stock_item_id: observation.stockItemId,
      },
      select: {
        current_quantity: true,
        stock_risk_level: true,
        calculated_at: true,
      },
    });
    responseObservations.push({
      client_observation_id: observation.clientObservationId,
      stock_item_id: observation.stockItemId,
      stock_event_id: event.id,
      observation_context_id: context.id,
      event_type: 'visit_observation',
      observation_kind: observation.kind,
      quantity_kind: buildStockEventFields(observation).quantity_kind,
      snapshot: snapshot
        ? snapshotDto(snapshot)
        : {
            current_quantity: null,
            stock_risk_level: 'unknown',
            calculated_at: now.toISOString(),
          },
      idempotent_replay: true,
    });
  }

  const nextVisitDateKey =
    observationsToCreate.length > 0
      ? await resolveNextVisitDateKeyForStockForecast({
          db,
          orgId: args.orgId,
          caseId: visitCaseId,
          baseDateKeyJst: stockForecastBaseDateKeyJst,
        })
      : null;

  for (const observation of observationsToCreate) {
    const stockItem = stockItemById.get(observation.stockItemId);
    if (!stockItem) return { kind: 'not_found', message: '残数管理対象薬剤が見つかりません' };
    const stockEventFields = buildStockEventFields(observation);
    const stockEvent = await db.medicationStockEvent.create({
      data: {
        org_id: args.orgId,
        display_id: await allocateDisplayId(
          db as Prisma.TransactionClient,
          'MedicationStockEvent',
          args.orgId,
        ),
        patient_id: visitRecord.patient_id,
        case_id: stockItem.case_id ?? visitCaseId,
        stock_item_id: observation.stockItemId,
        event_type: 'visit_observation',
        event_at: observation.eventAt,
        recorded_at: now,
        recorded_by: args.userId,
        quantity_kind: stockEventFields.quantity_kind,
        quantity_delta: stockEventFields.quantity_delta,
        observed_quantity: stockEventFields.observed_quantity,
        usage_quantity: stockEventFields.usage_quantity,
        usage_period_days: stockEventFields.usage_period_days,
        unit: stockItem.unit,
        source_entity_type: 'visit_record',
        source_entity_id: visitRecord.id,
        source_signal_id: null,
        external_observation_id: null,
        idempotency_key_hash: observation.idempotencyKeyHash,
        request_fingerprint_hash: observation.requestFingerprintHash,
      },
      select: { id: true },
    });
    const context = await db.medicationStockObservationContext.create({
      data: {
        org_id: args.orgId,
        display_id: await allocateDisplayId(
          db as Prisma.TransactionClient,
          'MedicationStockObservationContext',
          args.orgId,
        ),
        stock_event_id: stockEvent.id,
        context_kind: 'visit_observation',
        observation_kind: observation.kind,
        visit_record_id: visitRecord.id,
        observed_date_key_jst: observation.observedDateKeyJst,
        last_used_at: observation.lastUsedAt ?? null,
        last_used_date_key_jst: observation.lastUsedDateKeyJst ?? null,
        last_used_precision: observation.lastUsedPrecision ?? null,
        unobserved_reason_code: observation.unobservedReasonCode ?? null,
        source_confidence: observation.sourceConfidence,
        source_context_code: observation.sourceContextCode,
        confirmation_level: observation.confirmationLevel,
        idempotency_key_hash: observation.idempotencyKeyHash,
        request_fingerprint_hash: observation.requestFingerprintHash,
      },
      select: { id: true },
    });
    const snapshot = await recalculateMedicationStockSnapshot({
      db,
      orgId: args.orgId,
      stockItem,
      eventId: stockEvent.id,
      asOf: now,
      nextVisitDateKey,
    });
    responseObservations.push({
      client_observation_id: observation.clientObservationId,
      stock_item_id: observation.stockItemId,
      stock_event_id: stockEvent.id,
      observation_context_id: context.id,
      event_type: 'visit_observation',
      observation_kind: observation.kind,
      quantity_kind: stockEventFields.quantity_kind,
      snapshot,
      idempotent_replay: false,
    });
  }

  return {
    kind: 'applied',
    data: {
      visit_record_id: visitRecord.id,
      observations: responseObservations.sort(
        (left, right) =>
          normalizedObservations.findIndex(
            (item) => item.clientObservationId === left.client_observation_id,
          ) -
          normalizedObservations.findIndex(
            (item) => item.clientObservationId === right.client_observation_id,
          ),
      ),
    },
    meta: {
      generated_at: now.toISOString(),
      applied_count: observationsToCreate.length,
      replay_count: responseObservations.length - observationsToCreate.length,
    },
  };
}
