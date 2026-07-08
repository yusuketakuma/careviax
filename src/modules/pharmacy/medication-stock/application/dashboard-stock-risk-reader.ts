import { Prisma } from '@prisma/client';

export type DashboardMedicationStockLedgerRiskDb = {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
};

export type DashboardMedicationStockLedgerRiskRow = {
  stock_item_id: string;
  stock_item_display_id: string | null;
  patient_id: string;
  case_id: string | null;
  display_name: string;
  ingredient_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  route: string | null;
  unit: string;
  medication_category: string;
  managing_party: string;
  equivalence_review_status: string;
  equivalence_confidence: string | null;
  item_updated_at: Date;
  snapshot_id: string | null;
  current_quantity: Prisma.Decimal | number | string | null;
  last_observed_quantity: Prisma.Decimal | number | string | null;
  last_observed_at: Date | null;
  estimated_daily_usage: Prisma.Decimal | number | string | null;
  usage_confidence: string | null;
  estimated_stockout_date: Date | null;
  days_until_stockout: number | null;
  stock_risk_level: string | null;
  risk_reason_code: string | null;
  calculated_at: Date | null;
  total_count: bigint | number | string | null;
  urgent_count: bigint | number | string | null;
  shortage_expected_count: bigint | number | string | null;
  usage_unknown_count: bigint | number | string | null;
  equivalence_review_count: bigint | number | string | null;
};

export type DashboardMedicationStockLedgerRiskResult = {
  rows: DashboardMedicationStockLedgerRiskRow[];
  totalCount: number;
  urgentCount: number;
  shortageExpectedCount: number;
  usageUnknownCount: number;
  equivalenceReviewCount: number;
};

export type DashboardMedicationStockSignalRiskRow = {
  id: string;
  patient_id: string | null;
  case_id: string | null;
  inbound_event_id: string;
  signal_type: string;
  extracted_medication_name: string | null;
  extracted_quantity: number | null;
  extracted_unit: string | null;
  source_confidence: string;
  review_status: string;
  action_status: string;
  created_at: Date;
  updated_at: Date;
  inbound_event_patient_id: string | null;
  inbound_event_case_id: string | null;
  inbound_event_source_channel: string;
  inbound_event_sender_role: string;
  inbound_event_normalized_summary: string | null;
  inbound_event_received_at: Date;
  total_count: bigint | number | string | null;
  urgent_count: bigint | number | string | null;
  shortage_expected_count: bigint | number | string | null;
  usage_unknown_count: bigint | number | string | null;
  equivalence_review_count: bigint | number | string | null;
  linked_to_stock_event_count: bigint | number | string | null;
};

export type DashboardMedicationStockSignalRiskResult = {
  rows: DashboardMedicationStockSignalRiskRow[];
  totalCount: number;
  urgentCount: number;
  shortageExpectedCount: number;
  usageUnknownCount: number;
  equivalenceReviewCount: number;
  linkedToStockEventCount: number;
};

export type ReadDashboardMedicationStockLedgerRisksArgs = {
  orgId: string;
  patientIds?: string[];
  caseIds?: string[];
  take: number;
};

function readCount(value: bigint | number | string | null | undefined): number {
  if (typeof value === 'bigint') return Number(value);
  const count = Number(value ?? 0);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function uniq(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).filter(Boolean)));
}

function buildScopeSql(args: { patientIds?: string[]; caseIds?: string[] }) {
  const patientIds = uniq(args.patientIds);
  const caseIds = uniq(args.caseIds);
  const restricted = args.patientIds !== undefined || args.caseIds !== undefined;

  if (restricted && patientIds.length === 0 && caseIds.length === 0) {
    return { restricted, empty: true, sql: Prisma.empty };
  }

  if (!restricted) {
    return { restricted, empty: false, sql: Prisma.empty };
  }

  const clauses: Prisma.Sql[] = [];
  if (patientIds.length > 0) {
    clauses.push(Prisma.sql`item."patient_id" IN (${Prisma.join(patientIds)})`);
  }
  if (caseIds.length > 0) {
    clauses.push(Prisma.sql`item."case_id" IN (${Prisma.join(caseIds)})`);
  }

  return {
    restricted,
    empty: false,
    sql: Prisma.sql`AND (${Prisma.join(clauses, ' OR ')})`,
  };
}

function buildSignalScopeSql(args: { patientIds?: string[]; caseIds?: string[] }) {
  const patientIds = uniq(args.patientIds);
  const caseIds = uniq(args.caseIds);
  const restricted = args.patientIds !== undefined || args.caseIds !== undefined;

  if (restricted && patientIds.length === 0 && caseIds.length === 0) {
    return { restricted, empty: true, sql: Prisma.empty };
  }

  if (!restricted) {
    return { restricted, empty: false, sql: Prisma.empty };
  }

  const clauses: Prisma.Sql[] = [];
  if (patientIds.length > 0) {
    clauses.push(Prisma.sql`signal."patient_id" IN (${Prisma.join(patientIds)})`);
  }
  if (caseIds.length > 0) {
    clauses.push(Prisma.sql`signal."case_id" IN (${Prisma.join(caseIds)})`);
  }

  return {
    restricted,
    empty: false,
    sql: Prisma.sql`AND (${Prisma.join(clauses, ' OR ')})`,
  };
}

export async function readDashboardMedicationStockSignalRisks(
  db: DashboardMedicationStockLedgerRiskDb,
  args: ReadDashboardMedicationStockLedgerRisksArgs,
): Promise<DashboardMedicationStockSignalRiskResult> {
  const scope = buildSignalScopeSql({ patientIds: args.patientIds, caseIds: args.caseIds });
  if (scope.empty || args.take <= 0) {
    return {
      rows: [],
      totalCount: 0,
      urgentCount: 0,
      shortageExpectedCount: 0,
      usageUnknownCount: 0,
      equivalenceReviewCount: 0,
      linkedToStockEventCount: 0,
    };
  }

  const rows = await db.$queryRaw<DashboardMedicationStockSignalRiskRow[]>(Prisma.sql`
    SELECT
      signal."id",
      signal."patient_id",
      signal."case_id",
      signal."inbound_event_id",
      signal."signal_type"::text AS signal_type,
      signal."extracted_medication_name",
      signal."extracted_quantity",
      signal."extracted_unit",
      signal."source_confidence"::text AS source_confidence,
      signal."review_status"::text AS review_status,
      signal."action_status"::text AS action_status,
      signal."created_at",
      signal."updated_at",
      event."patient_id" AS inbound_event_patient_id,
      event."case_id" AS inbound_event_case_id,
      event."source_channel"::text AS inbound_event_source_channel,
      event."sender_role"::text AS inbound_event_sender_role,
      event."normalized_summary" AS inbound_event_normalized_summary,
      event."received_at" AS inbound_event_received_at,
      COUNT(*) OVER()::bigint AS total_count,
      COUNT(*) FILTER (
        WHERE signal."signal_type"::text = 'out_of_stock_text'
           OR (signal."signal_type"::text = 'observed_quantity' AND signal."extracted_quantity" = 0)
      ) OVER()::bigint AS urgent_count,
      COUNT(*) FILTER (
        WHERE signal."signal_type"::text IN ('low_stock_text', 'refill_request')
      ) OVER()::bigint AS shortage_expected_count,
      COUNT(*) FILTER (
        WHERE signal."signal_type"::text IN ('usage_frequency', 'usage_delta')
      ) OVER()::bigint AS usage_unknown_count,
      COUNT(*) FILTER (
        WHERE signal."extracted_medication_name" IS NULL
           OR signal."extracted_medication_name" = ''
      ) OVER()::bigint AS equivalence_review_count,
      COUNT(*) FILTER (
        WHERE signal."action_status"::text = 'linked_to_stock_event'
      ) OVER()::bigint AS linked_to_stock_event_count
    FROM "InboundCommunicationSignal" signal
    INNER JOIN "InboundCommunicationEvent" event
      ON event."org_id" = signal."org_id"
     AND event."id" = signal."inbound_event_id"
    WHERE signal."org_id" = ${args.orgId}
      AND signal."signal_domain"::text = 'medication_stock'
      ${scope.sql}
      AND (
        signal."review_status"::text = 'needs_review'
        OR signal."action_status"::text IN (
          'not_linked',
          'linked_to_task',
          'linked_to_stock_event'
        )
      )
    ORDER BY signal."updated_at" DESC, signal."id" ASC
    LIMIT ${args.take}
  `);

  const first = rows[0];
  return {
    rows,
    totalCount: readCount(first?.total_count),
    urgentCount: readCount(first?.urgent_count),
    shortageExpectedCount: readCount(first?.shortage_expected_count),
    usageUnknownCount: readCount(first?.usage_unknown_count),
    equivalenceReviewCount: readCount(first?.equivalence_review_count),
    linkedToStockEventCount: readCount(first?.linked_to_stock_event_count),
  };
}

export async function readDashboardMedicationStockLedgerRisks(
  db: DashboardMedicationStockLedgerRiskDb,
  args: ReadDashboardMedicationStockLedgerRisksArgs,
): Promise<DashboardMedicationStockLedgerRiskResult> {
  const scope = buildScopeSql({ patientIds: args.patientIds, caseIds: args.caseIds });
  if (scope.empty || args.take <= 0) {
    return {
      rows: [],
      totalCount: 0,
      urgentCount: 0,
      shortageExpectedCount: 0,
      usageUnknownCount: 0,
      equivalenceReviewCount: 0,
    };
  }

  const rows = await db.$queryRaw<DashboardMedicationStockLedgerRiskRow[]>(Prisma.sql`
    SELECT
      item."id" AS stock_item_id,
      item."display_id" AS stock_item_display_id,
      item."patient_id",
      item."case_id",
      item."display_name",
      item."ingredient_name",
      item."strength",
      item."dosage_form",
      item."route",
      item."unit"::text AS unit,
      item."medication_category"::text AS medication_category,
      item."managing_party"::text AS managing_party,
      item."equivalence_review_status"::text AS equivalence_review_status,
      item."equivalence_confidence"::text AS equivalence_confidence,
      item."updated_at" AS item_updated_at,
      snapshot."id" AS snapshot_id,
      snapshot."current_quantity",
      snapshot."last_observed_quantity",
      snapshot."last_observed_at",
      snapshot."estimated_daily_usage",
      snapshot."usage_confidence"::text AS usage_confidence,
      snapshot."estimated_stockout_date",
      snapshot."days_until_stockout",
      snapshot."stock_risk_level"::text AS stock_risk_level,
      snapshot."risk_reason_code",
      snapshot."calculated_at",
      COUNT(*) OVER()::bigint AS total_count,
      COUNT(*) FILTER (WHERE snapshot."stock_risk_level"::text = 'urgent') OVER()::bigint
        AS urgent_count,
      COUNT(*) FILTER (WHERE snapshot."stock_risk_level"::text = 'shortage_expected') OVER()::bigint
        AS shortage_expected_count,
      COUNT(*) FILTER (WHERE snapshot."usage_confidence"::text = 'unknown') OVER()::bigint
        AS usage_unknown_count,
      COUNT(*) FILTER (
        WHERE item."equivalence_review_status"::text IN ('needs_review', 'uncertain')
      ) OVER()::bigint AS equivalence_review_count
    FROM "PatientMedicationStockItem" item
    LEFT JOIN "MedicationStockSnapshot" snapshot
      ON snapshot."org_id" = item."org_id"
     AND snapshot."stock_item_id" = item."id"
    WHERE item."org_id" = ${args.orgId}
      AND item."active" = TRUE
      ${scope.sql}
      AND (
        snapshot."stock_risk_level"::text IN ('urgent', 'shortage_expected')
        OR snapshot."usage_confidence"::text = 'unknown'
        OR item."equivalence_review_status"::text IN ('needs_review', 'uncertain')
      )
    ORDER BY
      CASE
        WHEN snapshot."stock_risk_level"::text = 'urgent' THEN 0
        WHEN snapshot."stock_risk_level"::text = 'shortage_expected' THEN 1
        WHEN snapshot."usage_confidence"::text = 'unknown' THEN 2
        WHEN item."equivalence_review_status"::text IN ('needs_review', 'uncertain') THEN 3
        ELSE 4
      END ASC,
      snapshot."estimated_stockout_date" ASC NULLS LAST,
      COALESCE(snapshot."calculated_at", item."updated_at") DESC,
      item."id" ASC
    LIMIT ${args.take}
  `);

  const first = rows[0];
  return {
    rows,
    totalCount: readCount(first?.total_count),
    urgentCount: readCount(first?.urgent_count),
    shortageExpectedCount: readCount(first?.shortage_expected_count),
    usageUnknownCount: readCount(first?.usage_unknown_count),
    equivalenceReviewCount: readCount(first?.equivalence_review_count),
  };
}
