import { createHash } from 'node:crypto';

import { Prisma, type MemberRole } from '@prisma/client';

import { allocateDisplayId } from '@/lib/db/display-id';
import { buildInboundCommunicationEventAssignmentWhere } from '@/server/services/communication-request-access';
import {
  buildAssignedCareCaseWhere,
  buildNullableCaseScope,
  buildPatientDetailWhere,
} from '@/server/services/patient-detail-scope';
import {
  forecastMedicationStockout,
  type DateKey,
  type MedicationUsePattern,
  type StockQuantity,
} from '../domain/stockout-forecast';

export type ApplyMedicationStockObservationInput =
  | {
      kind: 'observed_absolute';
      quantity: number;
      unit: string;
      eventAt?: Date;
    }
  | {
      kind: 'no_stock_observed';
      unit: string;
      eventAt?: Date;
    }
  | {
      kind: 'usage_delta';
      usedQuantity: number;
      unit: string;
      eventAt?: Date;
    }
  | {
      kind: 'usage_frequency';
      usageQuantity: number;
      usagePeriodDays: number;
      unit: string;
      eventAt?: Date;
    }
  | {
      kind: 'low_stock_text' | 'refill_request';
      unit: string;
      eventAt?: Date;
    };

export type ApplyInboundMedicationStockSignalArgs = {
  orgId: string;
  userId: string;
  role: MemberRole;
  signalId: string;
  targetStockItemId: string;
  idempotencyKey: string;
  observation: ApplyMedicationStockObservationInput;
};

export type ApplyInboundMedicationStockSignalSuccess = {
  kind: 'applied';
  data: {
    signal_id: string;
    inbound_event_id: string;
    stock_item_id: string;
    stock_event_id: string;
    external_observation_id: string | null;
    review_status: 'accepted';
    action_status: 'linked_to_stock_event';
    snapshot: {
      current_quantity: number | null;
      stock_risk_level: 'ok' | 'watch' | 'shortage_expected' | 'urgent' | 'unknown';
      calculated_at: string;
    };
    review_task_closure_count: number;
    idempotent_replay: boolean;
  };
};

export type ApplyInboundMedicationStockSignalFailure = {
  kind: 'not_found' | 'forbidden' | 'invalid_state' | 'conflict' | 'validation_error';
  message: string;
};

export type ApplyInboundMedicationStockSignalResult =
  | ApplyInboundMedicationStockSignalSuccess
  | ApplyInboundMedicationStockSignalFailure;

export type ApplyInboundMedicationStockSignalDb = Pick<
  Prisma.TransactionClient,
  | '$queryRaw'
  | 'externalMedicationStockObservation'
  | 'inboundCommunicationSignal'
  | 'medicationStockEvent'
  | 'medicationStockSnapshot'
  | 'patient'
  | 'careCase'
  | 'patientMedicationStockItem'
  | 'task'
>;

type SignalRow = {
  id: string;
  inbound_event_id: string;
  patient_id: string | null;
  case_id: string | null;
  signal_domain: string;
  signal_type: string;
  source_confidence: string;
  extracted_medication_name: string | null;
  review_status: string;
  action_status: string;
  inbound_event: {
    id: string;
    patient_id: string | null;
    case_id: string | null;
    sender_role: string;
    occurred_at: Date | null;
    received_at: Date;
  };
};

type StockItemRow = {
  id: string;
  patient_id: string;
  case_id: string | null;
  unit: string;
  default_usage_amount_per_day: Prisma.Decimal | number | string | null;
  medication_category: string;
};

type StockEventRow = {
  id: string;
  event_at: Date;
  created_at: Date;
  quantity_kind: string;
  quantity_delta: Prisma.Decimal | number | string | null;
  observed_quantity: Prisma.Decimal | number | string | null;
  usage_quantity: Prisma.Decimal | number | string | null;
  usage_period_days: number | null;
  unit: string;
};

type SnapshotResult = ApplyInboundMedicationStockSignalSuccess['data']['snapshot'];

const APPLY_STOCK_ROLES: ReadonlySet<MemberRole> = new Set(['owner', 'admin', 'pharmacist']);
const SNAPSHOT_VERSION = 'medication-stock-snapshot:v1';
const RISK_BUFFER_DAYS = 7;

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

function buildIdempotencyKeyHash(args: {
  orgId: string;
  signalId: string;
  idempotencyKey: string;
}) {
  return `medication-stock-apply:v1:${sha256Hex(
    stableStringify({
      org_id: args.orgId,
      signal_id: args.signalId,
      idempotency_key: args.idempotencyKey,
    }),
  )}`;
}

function buildObservationFingerprint(input: ApplyMedicationStockObservationInput) {
  const base = {
    kind: input.kind,
    unit: normalizeUnit(input.unit),
    event_at: input.eventAt?.toISOString() ?? null,
  };

  switch (input.kind) {
    case 'observed_absolute':
      return {
        ...base,
        quantity: input.quantity,
      };
    case 'no_stock_observed':
    case 'low_stock_text':
    case 'refill_request':
      return base;
    case 'usage_delta':
      return {
        ...base,
        used_quantity: input.usedQuantity,
      };
    case 'usage_frequency':
      return {
        ...base,
        usage_quantity: input.usageQuantity,
        usage_period_days: input.usagePeriodDays,
      };
  }
}

function buildRequestFingerprint(args: {
  signalId: string;
  targetStockItemId: string;
  observation: ApplyMedicationStockObservationInput;
}) {
  return `medication-stock-apply-request:v1:${sha256Hex(
    stableStringify({
      signal_id: args.signalId,
      target_stock_item_id: args.targetStockItemId,
      observation: buildObservationFingerprint(args.observation),
    }),
  )}`;
}

function normalizeUnit(unit: string) {
  return unit.normalize('NFKC').trim();
}

function decimalToNumber(value: Prisma.Decimal | number | string | null | undefined) {
  if (value == null) return null;
  const parsed = typeof value === 'number' ? value : Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

function toDateKey(value: Date): DateKey {
  return value.toISOString().slice(0, 10) as DateKey;
}

function dateKeyToDate(value: DateKey | null) {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function isMedicationStockApplyRole(role: MemberRole) {
  return APPLY_STOCK_ROLES.has(role);
}

function validateObservationInput(input: ApplyMedicationStockObservationInput) {
  switch (input.kind) {
    case 'observed_absolute':
      return Number.isFinite(input.quantity) && input.quantity >= 0
        ? null
        : '残数は0以上で指定してください';
    case 'usage_delta':
      return Number.isFinite(input.usedQuantity) && input.usedQuantity > 0
        ? null
        : '使用量は0より大きい値で指定してください';
    case 'usage_frequency':
      if (!Number.isFinite(input.usageQuantity) || input.usageQuantity <= 0) {
        return '使用量は0より大きい値で指定してください';
      }
      if (
        !Number.isInteger(input.usagePeriodDays) ||
        input.usagePeriodDays < 1 ||
        input.usagePeriodDays > 366
      ) {
        return '使用期間日数が不正です';
      }
      return null;
    case 'no_stock_observed':
    case 'low_stock_text':
    case 'refill_request':
      return null;
  }
}

function isSupportedSignalForObservation(
  signal: SignalRow,
  observation: ApplyMedicationStockObservationInput,
) {
  if (signal.signal_domain !== 'medication_stock') return false;

  switch (observation.kind) {
    case 'observed_absolute':
      return signal.signal_type === 'observed_quantity';
    case 'no_stock_observed':
      return signal.signal_type === 'out_of_stock_text';
    case 'usage_delta':
      return signal.signal_type === 'usage_delta';
    case 'usage_frequency':
      return signal.signal_type === 'usage_frequency';
    case 'low_stock_text':
      return signal.signal_type === 'low_stock_text';
    case 'refill_request':
      return signal.signal_type === 'refill_request';
  }
}

function observationQuantity(input: ApplyMedicationStockObservationInput) {
  return input.kind === 'observed_absolute' ? input.quantity : 0;
}

function externalObservationKind(
  input: Extract<
    ApplyMedicationStockObservationInput,
    { kind: 'observed_absolute' | 'no_stock_observed' }
  >,
) {
  return input.kind === 'observed_absolute' ? 'remaining_quantity' : 'no_stock_observed';
}

function shouldCreateExternalObservation(input: ApplyMedicationStockObservationInput) {
  return input.kind === 'observed_absolute' || input.kind === 'no_stock_observed';
}

function buildStockEventFields(input: ApplyMedicationStockObservationInput) {
  switch (input.kind) {
    case 'observed_absolute':
      return {
        event_type: 'external_observation_apply' as const,
        quantity_kind: 'observed_absolute' as const,
        quantity_delta: null,
        observed_quantity: new Prisma.Decimal(input.quantity),
        usage_quantity: null,
        usage_period_days: null,
      };
    case 'no_stock_observed':
      return {
        event_type: 'no_stock_observed' as const,
        quantity_kind: 'observed_absolute' as const,
        quantity_delta: null,
        observed_quantity: new Prisma.Decimal(0),
        usage_quantity: null,
        usage_period_days: null,
      };
    case 'usage_delta':
      return {
        event_type: 'patient_report' as const,
        quantity_kind: 'delta' as const,
        quantity_delta: new Prisma.Decimal(-input.usedQuantity),
        observed_quantity: null,
        usage_quantity: null,
        usage_period_days: null,
      };
    case 'usage_frequency':
      return {
        event_type: 'usage_frequency_update' as const,
        quantity_kind: 'usage_rate' as const,
        quantity_delta: null,
        observed_quantity: null,
        usage_quantity: new Prisma.Decimal(input.usageQuantity),
        usage_period_days: input.usagePeriodDays,
      };
    case 'low_stock_text':
    case 'refill_request':
      return {
        event_type: 'patient_report' as const,
        quantity_kind: 'no_quantity' as const,
        quantity_delta: null,
        observed_quantity: null,
        usage_quantity: null,
        usage_period_days: null,
      };
  }
}

function usagePatternForStockItem(
  item: StockItemRow,
  dailyUsageOverride?: number | null,
): MedicationUsePattern {
  const dailyQuantity =
    dailyUsageOverride != null
      ? dailyUsageOverride
      : decimalToNumber(item.default_usage_amount_per_day);
  if (dailyQuantity == null || dailyQuantity <= 0) return { kind: 'unknown' };

  const quantity: StockQuantity = {
    value: dailyQuantity,
    unitKey: item.unit,
  };

  if (item.medication_category === 'prn') {
    return { kind: 'prn', typicalDailyQuantity: quantity };
  }
  if (item.medication_category === 'topical' || item.medication_category === 'external') {
    return {
      kind: 'topical',
      estimatedDailyQuantity: quantity,
      estimationBasis: 'professional_estimate',
    };
  }
  return { kind: 'scheduled', dailyQuantity: quantity };
}

function mapForecastRisk(
  risk: ReturnType<typeof forecastMedicationStockout>['risk'],
): SnapshotResult['stock_risk_level'] {
  switch (risk) {
    case 'already_out':
      return 'urgent';
    case 'before_next_visit':
      return 'shortage_expected';
    case 'within_buffer':
      return 'watch';
    case 'sufficient_until_next_visit':
      return 'ok';
    case 'unknown':
      return 'unknown';
  }
}

function foldStockEvents(events: StockEventRow[]) {
  let currentQuantity: number | null = null;
  let lastObservedQuantity: number | null = null;
  let lastObservedAt: Date | null = null;
  let lastEventId: string | null = null;
  let latestDailyUsage: number | null = null;

  for (const event of events) {
    lastEventId = event.id;
    const observed = decimalToNumber(event.observed_quantity);
    const delta = decimalToNumber(event.quantity_delta);
    const usageQuantity = decimalToNumber(event.usage_quantity);

    if (event.quantity_kind === 'observed_absolute' && observed != null) {
      currentQuantity = observed;
      lastObservedQuantity = observed;
      lastObservedAt = event.event_at;
      continue;
    }

    if (event.quantity_kind === 'delta' && currentQuantity != null && delta != null) {
      currentQuantity = Math.max(0, currentQuantity + delta);
      continue;
    }

    if (
      event.quantity_kind === 'usage_rate' &&
      usageQuantity != null &&
      event.usage_period_days != null &&
      event.usage_period_days > 0
    ) {
      latestDailyUsage = usageQuantity / event.usage_period_days;
    }
  }

  return {
    currentQuantity,
    lastObservedQuantity,
    lastObservedAt,
    lastEventId,
    latestDailyUsage,
  };
}

async function recalculateStockSnapshot(args: {
  db: ApplyInboundMedicationStockSignalDb;
  orgId: string;
  stockItem: StockItemRow;
  eventId: string;
  asOf: Date;
}) {
  const events = (await args.db.medicationStockEvent.findMany({
    where: {
      org_id: args.orgId,
      stock_item_id: args.stockItem.id,
    },
    orderBy: [{ event_at: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      event_at: true,
      created_at: true,
      quantity_kind: true,
      quantity_delta: true,
      observed_quantity: true,
      usage_quantity: true,
      usage_period_days: true,
      unit: true,
    },
  })) as StockEventRow[];

  const folded = foldStockEvents(events);
  const remainingQuantity =
    folded.currentQuantity == null
      ? null
      : {
          value: folded.currentQuantity,
          unitKey: args.stockItem.unit,
        };
  const forecast = forecastMedicationStockout({
    asOfDateKey: toDateKey(args.asOf),
    remainingQuantity,
    usePattern: usagePatternForStockItem(args.stockItem, folded.latestDailyUsage),
    bufferDays: RISK_BUFFER_DAYS,
  });
  const estimatedDailyUsage =
    folded.latestDailyUsage ?? decimalToNumber(args.stockItem.default_usage_amount_per_day);

  const daysUntilStockout =
    forecast.kind === 'point_estimate'
      ? forecast.daysRemaining
      : forecast.kind === 'range_estimate'
        ? forecast.earliestDaysRemaining
        : null;
  const estimatedStockoutDate =
    forecast.kind === 'point_estimate'
      ? dateKeyToDate(forecast.projectedStockoutDateKey)
      : forecast.kind === 'range_estimate'
        ? dateKeyToDate(forecast.earliestStockoutDateKey)
        : null;
  const snapshotDisplayId = await allocateDisplayId(
    args.db as Prisma.TransactionClient,
    'MedicationStockSnapshot',
    args.orgId,
  );

  const snapshot = await args.db.medicationStockSnapshot.upsert({
    where: {
      org_id_stock_item_id: {
        org_id: args.orgId,
        stock_item_id: args.stockItem.id,
      },
    },
    create: {
      org_id: args.orgId,
      display_id: snapshotDisplayId,
      stock_item_id: args.stockItem.id,
      patient_id: args.stockItem.patient_id,
      case_id: args.stockItem.case_id,
      current_quantity:
        folded.currentQuantity == null ? null : new Prisma.Decimal(folded.currentQuantity),
      unit: args.stockItem.unit as never,
      last_observed_quantity:
        folded.lastObservedQuantity == null
          ? null
          : new Prisma.Decimal(folded.lastObservedQuantity),
      last_observed_at: folded.lastObservedAt,
      last_event_id: folded.lastEventId ?? args.eventId,
      estimated_daily_usage:
        estimatedDailyUsage == null ? null : new Prisma.Decimal(estimatedDailyUsage),
      usage_confidence: estimatedDailyUsage == null ? 'unknown' : 'medium',
      estimated_stockout_date: estimatedStockoutDate,
      days_until_stockout: daysUntilStockout,
      stock_risk_level: mapForecastRisk(forecast.risk),
      risk_reason_code: forecast.kind === 'not_forecastable' ? `forecast_${forecast.reason}` : null,
      calculation_version: SNAPSHOT_VERSION,
      calculated_at: args.asOf,
    },
    update: {
      current_quantity:
        folded.currentQuantity == null ? null : new Prisma.Decimal(folded.currentQuantity),
      unit: args.stockItem.unit as never,
      last_observed_quantity:
        folded.lastObservedQuantity == null
          ? null
          : new Prisma.Decimal(folded.lastObservedQuantity),
      last_observed_at: folded.lastObservedAt,
      last_event_id: folded.lastEventId ?? args.eventId,
      estimated_daily_usage:
        estimatedDailyUsage == null ? null : new Prisma.Decimal(estimatedDailyUsage),
      usage_confidence: estimatedDailyUsage == null ? 'unknown' : 'medium',
      estimated_stockout_date: estimatedStockoutDate,
      days_until_stockout: daysUntilStockout,
      stock_risk_level: mapForecastRisk(forecast.risk),
      risk_reason_code: forecast.kind === 'not_forecastable' ? `forecast_${forecast.reason}` : null,
      calculation_version: SNAPSHOT_VERSION,
      calculated_at: args.asOf,
    },
    select: {
      current_quantity: true,
      stock_risk_level: true,
      calculated_at: true,
    },
  });

  return {
    current_quantity: decimalToNumber(snapshot.current_quantity),
    stock_risk_level: snapshot.stock_risk_level,
    calculated_at: snapshot.calculated_at.toISOString(),
  } satisfies SnapshotResult;
}

async function closeOpenReviewTasks(args: {
  db: ApplyInboundMedicationStockSignalDb;
  orgId: string;
  signalId: string;
  now: Date;
}) {
  const result = await args.db.task.updateMany({
    where: {
      org_id: args.orgId,
      dedupe_key: {
        startsWith: `inbound:${args.signalId}:`,
      },
      status: {
        in: ['pending', 'in_progress'],
      },
    },
    data: {
      status: 'completed',
      completed_at: args.now,
    },
  });
  return typeof result.count === 'number' ? result.count : 0;
}

async function returnExistingApplication(args: {
  db: ApplyInboundMedicationStockSignalDb;
  orgId: string;
  signal: SignalRow;
  stockItemId: string;
  event: {
    id: string;
    external_observation_id: string | null;
    request_fingerprint_hash: string;
  };
  requestFingerprintHash: string;
  now: Date;
}): Promise<ApplyInboundMedicationStockSignalResult> {
  if (args.event.request_fingerprint_hash !== args.requestFingerprintHash) {
    return { kind: 'conflict', message: '同じ冪等キーで異なる反映内容が指定されています' };
  }

  await args.db.inboundCommunicationSignal.updateMany({
    where: {
      id: args.signal.id,
      org_id: args.orgId,
      review_status: 'accepted',
      action_status: {
        in: ['not_linked', 'linked_to_stock_event'],
      },
    },
    data: {
      action_status: 'linked_to_stock_event',
    },
  });

  const taskClosureCount = await closeOpenReviewTasks({
    db: args.db,
    orgId: args.orgId,
    signalId: args.signal.id,
    now: args.now,
  });
  const snapshot = await args.db.medicationStockSnapshot.findFirst({
    where: {
      org_id: args.orgId,
      stock_item_id: args.stockItemId,
    },
    select: {
      current_quantity: true,
      stock_risk_level: true,
      calculated_at: true,
    },
  });

  return {
    kind: 'applied',
    data: {
      signal_id: args.signal.id,
      inbound_event_id: args.signal.inbound_event_id,
      stock_item_id: args.stockItemId,
      stock_event_id: args.event.id,
      external_observation_id: args.event.external_observation_id,
      review_status: 'accepted',
      action_status: 'linked_to_stock_event',
      snapshot: {
        current_quantity: decimalToNumber(snapshot?.current_quantity),
        stock_risk_level: snapshot?.stock_risk_level ?? 'unknown',
        calculated_at: snapshot?.calculated_at.toISOString() ?? args.now.toISOString(),
      },
      review_task_closure_count: taskClosureCount,
      idempotent_replay: true,
    },
  };
}

export async function applyInboundSignalToMedicationStock(
  db: ApplyInboundMedicationStockSignalDb,
  args: ApplyInboundMedicationStockSignalArgs,
): Promise<ApplyInboundMedicationStockSignalResult> {
  if (!isMedicationStockApplyRole(args.role)) {
    return { kind: 'forbidden', message: '残数台帳への反映権限がありません' };
  }
  const validationMessage = validateObservationInput(args.observation);
  if (validationMessage) {
    return { kind: 'validation_error', message: validationMessage };
  }

  const assignmentWhere = await buildInboundCommunicationEventAssignmentWhere({
    db,
    orgId: args.orgId,
    accessContext: { userId: args.userId, role: args.role },
  });

  const signal = (await db.inboundCommunicationSignal.findFirst({
    where: {
      AND: [
        {
          id: args.signalId,
          org_id: args.orgId,
          inbound_event: {
            is: {
              org_id: args.orgId,
            },
          },
        },
        ...(assignmentWhere
          ? [
              {
                inbound_event: {
                  is: assignmentWhere,
                },
              },
            ]
          : []),
      ],
    },
    select: {
      id: true,
      inbound_event_id: true,
      patient_id: true,
      case_id: true,
      signal_domain: true,
      signal_type: true,
      source_confidence: true,
      extracted_medication_name: true,
      review_status: true,
      action_status: true,
      inbound_event: {
        select: {
          id: true,
          patient_id: true,
          case_id: true,
          sender_role: true,
          occurred_at: true,
          received_at: true,
        },
      },
    },
  })) as SignalRow | null;
  if (!signal) return { kind: 'not_found', message: 'シグナルが見つかりません' };

  if (!isSupportedSignalForObservation(signal, args.observation)) {
    return { kind: 'invalid_state', message: 'このシグナルは残数台帳へ反映できません' };
  }
  if (signal.review_status !== 'accepted') {
    return { kind: 'invalid_state', message: '承認済みのシグナルだけ反映できます' };
  }

  const patientId = signal.patient_id ?? signal.inbound_event.patient_id;
  if (!patientId) {
    return { kind: 'invalid_state', message: '患者に紐づいていないシグナルは反映できません' };
  }

  const assignedCareCaseWhere = buildAssignedCareCaseWhere(args);
  const patient = await db.patient.findFirst({
    where: buildPatientDetailWhere({
      orgId: args.orgId,
      patientId,
      role: args.role,
      userId: args.userId,
    }),
    select: {
      id: true,
      cases: {
        ...(assignedCareCaseWhere ? { where: assignedCareCaseWhere } : {}),
        select: { id: true },
      },
    },
  });
  if (!patient) return { kind: 'not_found', message: '患者が見つかりません' };

  const visibleCaseIds = patient.cases.map((item) => item.id);
  const itemCaseScope =
    visibleCaseIds.length > 0
      ? buildNullableCaseScope(visibleCaseIds)
      : ({ case_id: null } satisfies Prisma.PatientMedicationStockItemWhereInput);
  const stockItem = (await db.patientMedicationStockItem.findFirst({
    where: {
      org_id: args.orgId,
      id: args.targetStockItemId,
      patient_id: patientId,
      active: true,
      ...itemCaseScope,
    },
    select: {
      id: true,
      patient_id: true,
      case_id: true,
      unit: true,
      default_usage_amount_per_day: true,
      medication_category: true,
    },
  })) as StockItemRow | null;
  if (!stockItem) return { kind: 'not_found', message: '残数管理対象薬剤が見つかりません' };

  const signalCaseId = signal.case_id ?? signal.inbound_event.case_id;
  if (stockItem.case_id && signalCaseId && stockItem.case_id !== signalCaseId) {
    return { kind: 'conflict', message: 'シグナルと残数管理対象薬剤のケースが一致しません' };
  }
  if (normalizeUnit(args.observation.unit) !== stockItem.unit) {
    return { kind: 'validation_error', message: '残数単位が残数管理対象薬剤と一致しません' };
  }
  if (signal.action_status !== 'not_linked' && signal.action_status !== 'linked_to_stock_event') {
    return { kind: 'invalid_state', message: 'このシグナルは既に別の処理に連動済みです' };
  }

  const now = new Date();
  const eventAt = args.observation.eventAt ?? signal.inbound_event.occurred_at ?? now;
  const idempotencyKeyHash = buildIdempotencyKeyHash({
    orgId: args.orgId,
    signalId: signal.id,
    idempotencyKey: args.idempotencyKey,
  });
  const requestFingerprintHash = buildRequestFingerprint({
    signalId: signal.id,
    targetStockItemId: stockItem.id,
    observation: {
      ...args.observation,
      unit: stockItem.unit,
      eventAt,
    },
  });

  const existingEvent = await db.medicationStockEvent.findFirst({
    where: {
      org_id: args.orgId,
      idempotency_key_hash: idempotencyKeyHash,
    },
    select: {
      id: true,
      stock_item_id: true,
      source_signal_id: true,
      external_observation_id: true,
      request_fingerprint_hash: true,
    },
  });
  if (existingEvent) {
    if (
      existingEvent.stock_item_id !== stockItem.id ||
      existingEvent.source_signal_id !== signal.id
    ) {
      return { kind: 'conflict', message: '同じ冪等キーが別の残数反映で使用されています' };
    }
    return returnExistingApplication({
      db,
      orgId: args.orgId,
      signal,
      stockItemId: stockItem.id,
      event: existingEvent,
      requestFingerprintHash,
      now,
    });
  }

  const linkSignal = await db.inboundCommunicationSignal.updateMany({
    where: {
      id: signal.id,
      org_id: args.orgId,
      review_status: 'accepted',
      action_status: 'not_linked',
    },
    data: {
      action_status: 'linked_to_stock_event',
    },
  });
  if (linkSignal.count !== 1) {
    return { kind: 'conflict', message: 'シグナルが他の操作で更新されています' };
  }

  const stockEventFields = buildStockEventFields(args.observation);
  const externalObservation =
    shouldCreateExternalObservation(args.observation) &&
    (args.observation.kind === 'observed_absolute' || args.observation.kind === 'no_stock_observed')
      ? await db.externalMedicationStockObservation.create({
          data: {
            org_id: args.orgId,
            display_id: await allocateDisplayId(
              db as Prisma.TransactionClient,
              'ExternalMedicationStockObservation',
              args.orgId,
            ),
            patient_id: patientId,
            case_id: stockItem.case_id ?? signalCaseId ?? null,
            inbound_signal_id: signal.id,
            source_entity_type: 'inbound_signal',
            source_entity_id: signal.id,
            source_author_role: signal.inbound_event.sender_role,
            observed_at: eventAt,
            observation_kind: externalObservationKind(args.observation),
            matched_stock_item_id: stockItem.id,
            extracted_medication_name: signal.extracted_medication_name,
            extracted_quantity: new Prisma.Decimal(observationQuantity(args.observation)),
            extracted_unit: stockItem.unit as never,
            source_confidence: signal.source_confidence as never,
            review_state: 'applied',
            reviewed_by: args.userId,
            reviewed_at: now,
            idempotency_key_hash: idempotencyKeyHash,
            request_fingerprint_hash: requestFingerprintHash,
          },
          select: { id: true },
        })
      : null;

  const stockEventDisplayId = await allocateDisplayId(
    db as Prisma.TransactionClient,
    'MedicationStockEvent',
    args.orgId,
  );

  const stockEvent = await db.medicationStockEvent.create({
    data: {
      org_id: args.orgId,
      display_id: stockEventDisplayId,
      patient_id: patientId,
      case_id: stockItem.case_id ?? signalCaseId ?? null,
      stock_item_id: stockItem.id,
      event_type: stockEventFields.event_type,
      event_at: eventAt,
      recorded_at: now,
      recorded_by: args.userId,
      quantity_kind: stockEventFields.quantity_kind,
      quantity_delta: stockEventFields.quantity_delta,
      observed_quantity: stockEventFields.observed_quantity,
      usage_quantity: stockEventFields.usage_quantity,
      usage_period_days: stockEventFields.usage_period_days,
      unit: stockItem.unit as never,
      source_entity_type: 'inbound_signal',
      source_entity_id: signal.id,
      source_signal_id: signal.id,
      external_observation_id: externalObservation?.id ?? null,
      idempotency_key_hash: idempotencyKeyHash,
      request_fingerprint_hash: requestFingerprintHash,
    },
    select: {
      id: true,
    },
  });

  if (externalObservation) {
    await db.externalMedicationStockObservation.update({
      where: { id: externalObservation.id },
      data: {
        applied_stock_event_id: stockEvent.id,
      },
    });
  }

  const snapshot = await recalculateStockSnapshot({
    db,
    orgId: args.orgId,
    stockItem,
    eventId: stockEvent.id,
    asOf: now,
  });
  const taskClosureCount = await closeOpenReviewTasks({
    db,
    orgId: args.orgId,
    signalId: signal.id,
    now,
  });

  return {
    kind: 'applied',
    data: {
      signal_id: signal.id,
      inbound_event_id: signal.inbound_event_id,
      stock_item_id: stockItem.id,
      stock_event_id: stockEvent.id,
      external_observation_id: externalObservation?.id ?? null,
      review_status: 'accepted',
      action_status: 'linked_to_stock_event',
      snapshot,
      review_task_closure_count: taskClosureCount,
      idempotent_replay: false,
    },
  };
}
