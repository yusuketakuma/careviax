import type { Prisma } from '@prisma/client';

import type {
  PatientMedicationStockEventDto,
  PatientMedicationStockItemDto,
  PatientMedicationStockSummaryResponse,
} from '@/types/medication-stock';
import {
  buildAssignedCareCaseWhere,
  buildNullableCaseScope,
  buildPatientDetailWhere,
  type PatientDetailScopeArgs,
} from '@/server/services/patient-detail-scope';

export type MedicationStockSummaryDb = Pick<Prisma.TransactionClient, 'patient'> & {
  patientMedicationStockItem: Pick<
    Prisma.TransactionClient['patientMedicationStockItem'],
    'count' | 'findMany'
  >;
  medicationStockSnapshot: Pick<Prisma.TransactionClient['medicationStockSnapshot'], 'findMany'>;
  medicationStockEvent: Pick<Prisma.TransactionClient['medicationStockEvent'], 'findMany'>;
  externalMedicationStockObservation: Pick<
    Prisma.TransactionClient['externalMedicationStockObservation'],
    'count'
  >;
};

export type GetPatientMedicationStockSummaryArgs = PatientDetailScopeArgs & {
  itemLimit?: number;
  eventLimit?: number;
};

type PatientRow = {
  id: string;
  cases: Array<{ id: string }>;
};

type StockItemRow = {
  id: string;
  display_id: string | null;
  patient_id: string;
  case_id: string | null;
  display_name: string;
  normalized_name: string | null;
  ingredient_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  route: string | null;
  unit: string;
  source_type: string;
  medication_category: string;
  managing_party: string;
  equivalence_review_status: string;
  equivalence_confidence: string | null;
  active: boolean;
  updated_at: Date;
};

type StockSnapshotRow = {
  stock_item_id: string;
  current_quantity: Prisma.Decimal | number | string | null;
  unit: string;
  last_observed_quantity: Prisma.Decimal | number | string | null;
  last_observed_at: Date | null;
  estimated_daily_usage: Prisma.Decimal | number | string | null;
  usage_confidence: string;
  estimated_stockout_date: Date | null;
  days_until_stockout: number | null;
  stock_risk_level: NonNullable<PatientMedicationStockItemDto['snapshot']>['stock_risk_level'];
  risk_reason_code: string | null;
  calculated_at: Date;
};

type StockEventRow = {
  id: string;
  stock_item_id: string;
  event_type: string;
  event_at: Date;
  recorded_at: Date;
  quantity_kind: string;
  quantity_delta: Prisma.Decimal | number | string | null;
  observed_quantity: Prisma.Decimal | number | string | null;
  usage_quantity: Prisma.Decimal | number | string | null;
  usage_period_days: number | null;
  unit: string;
  source_entity_type: string;
  source_entity_id: string | null;
};

const DEFAULT_ITEM_LIMIT = 50;
const DEFAULT_EVENT_LIMIT = 12;

function clampLimit(value: number | undefined, fallback: number, min: number, max: number) {
  if (value == null) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function decimalToNumber(value: Prisma.Decimal | number | string | null | undefined) {
  if (value == null) return null;
  const parsed = typeof value === 'number' ? value : Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

function dateToIso(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toItemDto(
  item: StockItemRow,
  snapshot: StockSnapshotRow | null,
): PatientMedicationStockItemDto {
  return {
    id: item.id,
    display_id: item.display_id,
    patient_id: item.patient_id,
    case_id: item.case_id,
    display_name: item.display_name,
    normalized_name: item.normalized_name,
    ingredient_name: item.ingredient_name,
    strength: item.strength,
    dosage_form: item.dosage_form,
    route: item.route,
    unit: item.unit,
    source_type: item.source_type,
    medication_category: item.medication_category,
    managing_party: item.managing_party,
    equivalence_review_status: item.equivalence_review_status,
    equivalence_confidence: item.equivalence_confidence,
    active: item.active,
    snapshot: snapshot
      ? {
          current_quantity: decimalToNumber(snapshot.current_quantity),
          last_observed_quantity: decimalToNumber(snapshot.last_observed_quantity),
          last_observed_at: dateToIso(snapshot.last_observed_at),
          estimated_daily_usage: decimalToNumber(snapshot.estimated_daily_usage),
          usage_confidence: snapshot.usage_confidence,
          estimated_stockout_date: dateToIso(snapshot.estimated_stockout_date),
          days_until_stockout: snapshot.days_until_stockout,
          stock_risk_level: snapshot.stock_risk_level,
          risk_reason_code: snapshot.risk_reason_code,
          calculated_at: dateToIso(snapshot.calculated_at),
        }
      : null,
  };
}

function toEventDto(event: StockEventRow): PatientMedicationStockEventDto {
  return {
    id: event.id,
    stock_item_id: event.stock_item_id,
    event_type: event.event_type,
    event_at: dateToIso(event.event_at) ?? '',
    recorded_at: dateToIso(event.recorded_at) ?? '',
    quantity_kind: event.quantity_kind,
    quantity_delta: decimalToNumber(event.quantity_delta),
    observed_quantity: decimalToNumber(event.observed_quantity),
    usage_quantity: decimalToNumber(event.usage_quantity),
    usage_period_days: event.usage_period_days,
    unit: event.unit,
    source_entity_type: event.source_entity_type,
    has_source_entity: Boolean(event.source_entity_id),
  };
}

export async function getPatientMedicationStockSummary(
  db: MedicationStockSummaryDb,
  args: GetPatientMedicationStockSummaryArgs,
): Promise<PatientMedicationStockSummaryResponse | null> {
  const itemLimit = clampLimit(args.itemLimit, DEFAULT_ITEM_LIMIT, 1, 100);
  const eventLimit = clampLimit(args.eventLimit, DEFAULT_EVENT_LIMIT, 0, 50);
  const assignedCareCaseWhere = buildAssignedCareCaseWhere(args);

  const patient = (await db.patient.findFirst({
    where: buildPatientDetailWhere(args),
    select: {
      id: true,
      cases: {
        ...(assignedCareCaseWhere ? { where: assignedCareCaseWhere } : {}),
        select: { id: true },
      },
    },
  })) as PatientRow | null;
  if (!patient) return null;

  const visibleCaseIds = patient.cases.map((item) => item.id);
  const caseScope =
    visibleCaseIds.length > 0
      ? buildNullableCaseScope(visibleCaseIds)
      : ({ case_id: null } satisfies Prisma.PatientMedicationStockItemWhereInput);
  const itemWhere: Prisma.PatientMedicationStockItemWhereInput = {
    org_id: args.orgId,
    patient_id: args.patientId,
    active: true,
    ...caseScope,
  };

  const [totalItemCount, items, pendingExternalObservationCount] = await Promise.all([
    db.patientMedicationStockItem.count({ where: itemWhere }),
    db.patientMedicationStockItem.findMany({
      where: itemWhere,
      orderBy: [{ updated_at: 'desc' }, { id: 'asc' }],
      take: itemLimit,
      select: {
        id: true,
        display_id: true,
        patient_id: true,
        case_id: true,
        display_name: true,
        normalized_name: true,
        ingredient_name: true,
        strength: true,
        dosage_form: true,
        route: true,
        unit: true,
        source_type: true,
        medication_category: true,
        managing_party: true,
        equivalence_review_status: true,
        equivalence_confidence: true,
        active: true,
        updated_at: true,
      },
    }) as Promise<StockItemRow[]>,
    db.externalMedicationStockObservation.count({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        review_state: 'pending_pharmacist_review',
        ...(visibleCaseIds.length > 0 ? buildNullableCaseScope(visibleCaseIds) : { case_id: null }),
      },
    }),
  ]);

  const stockItemIds = items.map((item) => item.id);
  const [snapshots, recentEvents] =
    stockItemIds.length > 0
      ? await Promise.all([
          db.medicationStockSnapshot.findMany({
            where: {
              org_id: args.orgId,
              patient_id: args.patientId,
              stock_item_id: { in: stockItemIds },
            },
            select: {
              stock_item_id: true,
              current_quantity: true,
              unit: true,
              last_observed_quantity: true,
              last_observed_at: true,
              estimated_daily_usage: true,
              usage_confidence: true,
              estimated_stockout_date: true,
              days_until_stockout: true,
              stock_risk_level: true,
              risk_reason_code: true,
              calculated_at: true,
            },
          }) as Promise<StockSnapshotRow[]>,
          eventLimit > 0
            ? (db.medicationStockEvent.findMany({
                where: {
                  org_id: args.orgId,
                  patient_id: args.patientId,
                  stock_item_id: { in: stockItemIds },
                },
                orderBy: [{ event_at: 'desc' }, { created_at: 'desc' }],
                take: eventLimit,
                select: {
                  id: true,
                  stock_item_id: true,
                  event_type: true,
                  event_at: true,
                  recorded_at: true,
                  quantity_kind: true,
                  quantity_delta: true,
                  observed_quantity: true,
                  usage_quantity: true,
                  usage_period_days: true,
                  unit: true,
                  source_entity_type: true,
                  source_entity_id: true,
                },
              }) as Promise<StockEventRow[]>)
            : Promise.resolve([]),
        ])
      : [[], []];

  const snapshotByStockItemId = new Map(snapshots.map((item) => [item.stock_item_id, item]));
  const itemDtos = items.map((item) => toItemDto(item, snapshotByStockItemId.get(item.id) ?? null));
  const eventDtos = recentEvents.map(toEventDto);

  const summary = itemDtos.reduce(
    (acc, item) => {
      const riskLevel = item.snapshot?.stock_risk_level ?? 'unknown';
      if (riskLevel === 'urgent') acc.urgent_count += 1;
      if (riskLevel === 'shortage_expected') acc.shortage_expected_count += 1;
      if (riskLevel === 'watch') acc.watch_count += 1;
      if (riskLevel === 'unknown') acc.unknown_risk_count += 1;
      if (item.snapshot?.usage_confidence === 'unknown') acc.usage_unknown_count += 1;
      if (
        item.equivalence_review_status === 'needs_review' ||
        item.equivalence_review_status === 'uncertain'
      ) {
        acc.equivalence_review_count += 1;
      }

      const observedAt = item.snapshot?.last_observed_at;
      if (observedAt && (!acc.last_observed_at || observedAt > acc.last_observed_at)) {
        acc.last_observed_at = observedAt;
      }
      return acc;
    },
    {
      total_item_count: totalItemCount,
      visible_item_count: itemDtos.length,
      active_item_count: totalItemCount,
      urgent_count: 0,
      shortage_expected_count: 0,
      watch_count: 0,
      unknown_risk_count: 0,
      usage_unknown_count: 0,
      equivalence_review_count: 0,
      pending_external_observation_count: pendingExternalObservationCount,
      last_observed_at: null as string | null,
    },
  );

  return {
    data: {
      patient_id: args.patientId,
      summary,
      items: itemDtos,
      recent_events: eventDtos,
    },
    meta: {
      generated_at: new Date().toISOString(),
      item_limit: itemLimit,
      event_limit: eventLimit,
    },
  };
}
