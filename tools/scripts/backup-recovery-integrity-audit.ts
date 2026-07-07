import 'dotenv/config';
import { inspect } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Client, type QueryResultRow } from 'pg';
import { parseOptionalStringArg } from './_shared/report-cli';

const USAGE = [
  'Usage: pnpm backup:drill:integrity [--help] [--format json|markdown] [--json] [--markdown] [--allow-production] [--expected-latest-at ISO] [--rpo-minutes N]',
  'SELECT-only restored/staging/local DB integrity audit for backup recovery drills.',
  'Output is PHI-free: counts, statuses, timestamps, and issue counts only.',
].join('\n');

const CLOUD_DATABASE_ENDPOINT_PATTERN =
  /rds\.amazonaws\.com|amazonaws\.com|aurora|cluster-[a-z0-9-]+/i;
const PRODUCTION_TOKEN_PATTERN = /(^|[^a-z0-9])(prod|production|prd|live|primary)([^a-z0-9]|$)/i;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const RPO_CRITICAL_CATEGORIES = new Set([
  'patients',
  'care_cases',
  'visit_schedules',
  'visit_records',
  'care_reports',
  'delivery_records',
  'billing_candidates',
  'tasks',
  'file_assets',
  'inbound_communication_events',
  'inbound_communication_signals',
  'medication_stock_items',
  'medication_stock_events',
  'medication_stock_snapshots',
]);

export type RecoveryIntegrityFormat = 'json' | 'markdown';

export type RecoveryIntegrityAuditArgs = {
  format: RecoveryIntegrityFormat;
  allowProduction: boolean;
  expectedLatestAt?: string;
  rpoMinutes?: number;
};

export type RecoveryIntegrityClient = {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
  ): Promise<{
    rows: T[];
    rowCount?: number | null;
  }>;
};

type RawCountRow = QueryResultRow & {
  category: string;
  row_count: string | number;
  latest_at: string | Date | null;
};

type RawIntegrityRow = QueryResultRow & {
  check_key: string;
  severity: 'error' | 'warning';
  issue_count: string | number;
};

export type RecoveryIntegrityCount = {
  category: string;
  count: number;
  latest_at: string | null;
};

export type RecoveryIntegrityCheck = {
  check_key: string;
  severity: 'error' | 'warning';
  issue_count: number;
  status: 'pass' | 'fail' | 'attention';
};

export type RecoveryIntegrityRpoHint = {
  latest_observed_data_at: string | null;
  latest_observed_source_category: string | null;
  minutes_since_latest_observed_data_at: number | null;
  expected_latest_at: string | null;
  rpo_minutes: number | null;
  basis: 'critical_operational_categories';
  status: 'not_configured' | 'pass' | 'fail' | 'unknown';
};

export type RecoveryIntegrityAuditReport = {
  ok: boolean;
  generated_at: string;
  target: {
    production_like: boolean;
    allow_production: boolean;
  };
  counts: RecoveryIntegrityCount[];
  integrity_checks: RecoveryIntegrityCheck[];
  rpo_hint: RecoveryIntegrityRpoHint;
  warnings: string[];
  output_policy: {
    phi_free: true;
    includes_raw_ids: false;
    includes_raw_text: false;
    includes_storage_keys: false;
    includes_provider_identifiers: false;
  };
};

export const RECOVERY_INTEGRITY_COUNTS_SQL = `
SELECT 'patients' AS category, COUNT(*)::text AS row_count, MAX(updated_at)::text AS latest_at FROM "Patient"
UNION ALL
SELECT 'care_cases', COUNT(*)::text, MAX(updated_at)::text FROM "CareCase"
UNION ALL
SELECT 'visit_schedules', COUNT(*)::text, MAX(updated_at)::text FROM "VisitSchedule"
UNION ALL
SELECT 'visit_records', COUNT(*)::text, MAX(updated_at)::text FROM "VisitRecord"
UNION ALL
SELECT 'care_reports', COUNT(*)::text, MAX(updated_at)::text FROM "CareReport"
UNION ALL
SELECT 'delivery_records', COUNT(*)::text, MAX(updated_at)::text FROM "DeliveryRecord"
UNION ALL
SELECT 'billing_candidates', COUNT(*)::text, MAX(updated_at)::text FROM "BillingCandidate"
UNION ALL
SELECT 'tasks', COUNT(*)::text, MAX(updated_at)::text FROM "Task"
UNION ALL
SELECT 'file_assets', COUNT(*)::text, MAX(updated_at)::text FROM "FileAsset"
UNION ALL
SELECT 'audit_logs', COUNT(*)::text, MAX(created_at)::text FROM "AuditLog"
UNION ALL
SELECT 'inbound_communication_events', COUNT(*)::text, MAX(updated_at)::text FROM "InboundCommunicationEvent"
UNION ALL
SELECT 'inbound_communication_signals', COUNT(*)::text, MAX(updated_at)::text FROM "InboundCommunicationSignal"
UNION ALL
SELECT 'medication_stock_items', COUNT(*)::text, MAX(updated_at)::text FROM "PatientMedicationStockItem"
UNION ALL
SELECT 'medication_stock_events', COUNT(*)::text, MAX(created_at)::text FROM "MedicationStockEvent"
UNION ALL
SELECT 'medication_stock_snapshots', COUNT(*)::text, MAX(updated_at)::text FROM "MedicationStockSnapshot"
ORDER BY category
`;

export const RECOVERY_INTEGRITY_CHECKS_SQL = `
SELECT 'patient_missing_org' AS check_key, 'error' AS severity, COUNT(*)::text AS issue_count
FROM "Patient" patient
LEFT JOIN "Organization" org ON org.id = patient.org_id
WHERE org.id IS NULL
UNION ALL
SELECT 'care_case_missing_patient', 'error', COUNT(*)::text
FROM "CareCase" care_case
LEFT JOIN "Patient" patient ON patient.id = care_case.patient_id AND patient.org_id = care_case.org_id
WHERE patient.id IS NULL
UNION ALL
SELECT 'visit_schedule_missing_case', 'error', COUNT(*)::text
FROM "VisitSchedule" schedule
LEFT JOIN "CareCase" care_case ON care_case.id = schedule.case_id AND care_case.org_id = schedule.org_id
WHERE care_case.id IS NULL
UNION ALL
SELECT 'visit_record_missing_schedule', 'error', COUNT(*)::text
FROM "VisitRecord" record
LEFT JOIN "VisitSchedule" schedule ON schedule.id = record.schedule_id AND schedule.org_id = record.org_id
WHERE schedule.id IS NULL
UNION ALL
SELECT 'visit_record_missing_patient', 'error', COUNT(*)::text
FROM "VisitRecord" record
LEFT JOIN "Patient" patient ON patient.id = record.patient_id AND patient.org_id = record.org_id
WHERE patient.id IS NULL
UNION ALL
SELECT 'visit_record_patient_case_mismatch', 'error', COUNT(*)::text
FROM "VisitRecord" record
JOIN "VisitSchedule" schedule ON schedule.id = record.schedule_id AND schedule.org_id = record.org_id
JOIN "CareCase" care_case ON care_case.id = schedule.case_id AND care_case.org_id = schedule.org_id
WHERE record.patient_id <> care_case.patient_id
UNION ALL
SELECT 'care_report_missing_patient', 'error', COUNT(*)::text
FROM "CareReport" report
LEFT JOIN "Patient" patient ON patient.id = report.patient_id AND patient.org_id = report.org_id
WHERE patient.id IS NULL
UNION ALL
SELECT 'care_report_missing_case', 'error', COUNT(*)::text
FROM "CareReport" report
LEFT JOIN "CareCase" care_case ON care_case.id = report.case_id AND care_case.org_id = report.org_id
WHERE report.case_id IS NOT NULL AND care_case.id IS NULL
UNION ALL
SELECT 'care_report_case_patient_mismatch', 'error', COUNT(*)::text
FROM "CareReport" report
JOIN "CareCase" care_case ON care_case.id = report.case_id AND care_case.org_id = report.org_id
WHERE report.case_id IS NOT NULL AND report.patient_id <> care_case.patient_id
UNION ALL
SELECT 'care_report_missing_visit_record', 'error', COUNT(*)::text
FROM "CareReport" report
LEFT JOIN "VisitRecord" record ON record.id = report.visit_record_id AND record.org_id = report.org_id
WHERE report.visit_record_id IS NOT NULL AND record.id IS NULL
UNION ALL
SELECT 'care_report_visit_record_patient_mismatch', 'error', COUNT(*)::text
FROM "CareReport" report
JOIN "VisitRecord" record ON record.id = report.visit_record_id AND record.org_id = report.org_id
WHERE report.visit_record_id IS NOT NULL AND report.patient_id <> record.patient_id
UNION ALL
SELECT 'delivery_record_missing_report', 'error', COUNT(*)::text
FROM "DeliveryRecord" delivery
LEFT JOIN "CareReport" report ON report.id = delivery.report_id AND report.org_id = delivery.org_id
WHERE report.id IS NULL
UNION ALL
SELECT 'billing_candidate_missing_patient', 'error', COUNT(*)::text
FROM "BillingCandidate" candidate
LEFT JOIN "Patient" patient ON patient.id = candidate.patient_id AND patient.org_id = candidate.org_id
WHERE candidate.patient_id IS NOT NULL AND patient.id IS NULL
UNION ALL
SELECT 'task_patient_reference_missing', 'error', COUNT(*)::text
FROM "Task" task
LEFT JOIN "Patient" patient ON patient.id = task.related_entity_id AND patient.org_id = task.org_id
WHERE task.related_entity_type = 'patient' AND task.related_entity_id IS NOT NULL AND patient.id IS NULL
UNION ALL
SELECT 'task_case_reference_missing', 'error', COUNT(*)::text
FROM "Task" task
LEFT JOIN "CareCase" care_case ON care_case.id = task.related_entity_id AND care_case.org_id = task.org_id
WHERE task.related_entity_type = 'case' AND task.related_entity_id IS NOT NULL AND care_case.id IS NULL
UNION ALL
SELECT 'task_cycle_reference_missing', 'error', COUNT(*)::text
FROM "Task" task
LEFT JOIN "MedicationCycle" cycle ON cycle.id = task.related_entity_id AND cycle.org_id = task.org_id
WHERE task.related_entity_type = 'cycle' AND task.related_entity_id IS NOT NULL AND cycle.id IS NULL
UNION ALL
SELECT 'task_visit_reference_missing', 'warning', COUNT(*)::text
FROM "Task" task
LEFT JOIN "VisitSchedule" schedule ON schedule.id = task.related_entity_id AND schedule.org_id = task.org_id
LEFT JOIN "VisitRecord" record ON record.id = task.related_entity_id AND record.org_id = task.org_id
WHERE task.related_entity_type = 'visit'
  AND task.related_entity_id IS NOT NULL
  AND schedule.id IS NULL
  AND record.id IS NULL
UNION ALL
SELECT 'file_asset_missing_patient', 'error', COUNT(*)::text
FROM "FileAsset" asset
LEFT JOIN "Patient" patient ON patient.id = asset.patient_id AND patient.org_id = asset.org_id
WHERE asset.patient_id IS NOT NULL AND patient.id IS NULL
UNION ALL
SELECT 'file_asset_missing_visit_record', 'error', COUNT(*)::text
FROM "FileAsset" asset
LEFT JOIN "VisitRecord" record ON record.id = asset.visit_record_id AND record.org_id = asset.org_id
WHERE asset.visit_record_id IS NOT NULL AND record.id IS NULL
UNION ALL
SELECT 'file_asset_missing_report', 'error', COUNT(*)::text
FROM "FileAsset" asset
LEFT JOIN "CareReport" report ON report.id = asset.report_id AND report.org_id = asset.org_id
WHERE asset.report_id IS NOT NULL AND report.id IS NULL
UNION ALL
SELECT 'audit_log_missing_patient', 'error', COUNT(*)::text
FROM "AuditLog" audit
LEFT JOIN "Patient" patient ON patient.id = audit.patient_id AND patient.org_id = audit.org_id
WHERE audit.patient_id IS NOT NULL AND patient.id IS NULL
UNION ALL
SELECT 'inbound_event_missing_patient', 'error', COUNT(*)::text
FROM "InboundCommunicationEvent" inbound_event
LEFT JOIN "Patient" patient ON patient.id = inbound_event.patient_id AND patient.org_id = inbound_event.org_id
WHERE inbound_event.patient_id IS NOT NULL AND patient.id IS NULL
UNION ALL
SELECT 'inbound_signal_missing_event', 'error', COUNT(*)::text
FROM "InboundCommunicationSignal" signal
LEFT JOIN "InboundCommunicationEvent" inbound_event
  ON inbound_event.id = signal.inbound_event_id AND inbound_event.org_id = signal.org_id
WHERE inbound_event.id IS NULL
UNION ALL
SELECT 'inbound_signal_missing_patient', 'error', COUNT(*)::text
FROM "InboundCommunicationSignal" signal
LEFT JOIN "Patient" patient ON patient.id = signal.patient_id AND patient.org_id = signal.org_id
WHERE signal.patient_id IS NOT NULL AND patient.id IS NULL
UNION ALL
SELECT 'medication_stock_item_missing_patient', 'error', COUNT(*)::text
FROM "PatientMedicationStockItem" item
LEFT JOIN "Patient" patient ON patient.id = item.patient_id AND patient.org_id = item.org_id
WHERE patient.id IS NULL
UNION ALL
SELECT 'medication_stock_event_missing_item', 'error', COUNT(*)::text
FROM "MedicationStockEvent" event
LEFT JOIN "PatientMedicationStockItem" item ON item.id = event.stock_item_id AND item.org_id = event.org_id
WHERE item.id IS NULL
UNION ALL
SELECT 'medication_stock_event_missing_patient', 'error', COUNT(*)::text
FROM "MedicationStockEvent" event
LEFT JOIN "Patient" patient ON patient.id = event.patient_id AND patient.org_id = event.org_id
WHERE patient.id IS NULL
UNION ALL
SELECT 'medication_stock_snapshot_missing_item', 'error', COUNT(*)::text
FROM "MedicationStockSnapshot" snapshot
LEFT JOIN "PatientMedicationStockItem" item
  ON item.id = snapshot.stock_item_id AND item.org_id = snapshot.org_id
WHERE item.id IS NULL
UNION ALL
SELECT 'medication_stock_snapshot_missing_patient', 'error', COUNT(*)::text
FROM "MedicationStockSnapshot" snapshot
LEFT JOIN "Patient" patient ON patient.id = snapshot.patient_id AND patient.org_id = snapshot.org_id
WHERE patient.id IS NULL
UNION ALL
SELECT 'medication_stock_snapshot_missing_last_event', 'error', COUNT(*)::text
FROM "MedicationStockSnapshot" snapshot
LEFT JOIN "MedicationStockEvent" event ON event.id = snapshot.last_event_id AND event.org_id = snapshot.org_id
WHERE snapshot.last_event_id IS NOT NULL AND event.id IS NULL
ORDER BY check_key
`;

function readFormat(argv: string[]) {
  if (argv.includes('--json')) return 'json';
  if (argv.includes('--markdown')) return 'markdown';
  const value = parseOptionalStringArg(argv, '--format');
  if (!value) return 'json';
  if (value !== 'json' && value !== 'markdown') {
    throw new Error('--format は json または markdown を指定してください');
  }
  return value;
}

function parsePositiveInteger(value: string | undefined, field: string) {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${field} は正の整数で指定してください`);
  }
  return parsed;
}

function normalizeIsoDateTime(value: string | undefined, field: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${field} は ISO 8601 形式の日時で指定してください`);
  }
  return parsed.toISOString();
}

export function parseRecoveryIntegrityAuditArgs(
  argv = process.argv.slice(2),
): RecoveryIntegrityAuditArgs {
  if (argv.includes('--help')) {
    throw new Error(USAGE);
  }

  const expectedLatestAt = normalizeIsoDateTime(
    parseOptionalStringArg(argv, '--expected-latest-at') ?? undefined,
    '--expected-latest-at',
  );
  const rpoMinutes = parsePositiveInteger(
    parseOptionalStringArg(argv, '--rpo-minutes') ?? undefined,
    '--rpo-minutes',
  );
  if ((expectedLatestAt && rpoMinutes == null) || (!expectedLatestAt && rpoMinutes != null)) {
    throw new Error('--expected-latest-at と --rpo-minutes はセットで指定してください');
  }

  return {
    format: readFormat(argv),
    allowProduction: argv.includes('--allow-production'),
    expectedLatestAt,
    rpoMinutes,
  };
}

export function isProductionLikeDatabaseUrl(
  databaseUrl: string,
  env: Partial<NodeJS.ProcessEnv> = process.env,
) {
  const appEnv = `${env.NODE_ENV ?? ''} ${env.VERCEL_ENV ?? ''} ${env.APP_ENV ?? ''}`;
  if (/\bproduction\b/i.test(appEnv)) return true;

  try {
    const parsed = new URL(databaseUrl);
    const host = parsed.hostname.toLowerCase();
    const databaseName = parsed.pathname.replace(/^\//, '').toLowerCase();
    const userName = decodeURIComponent(parsed.username || '').toLowerCase();
    const target = `${host} ${databaseName} ${userName}`;
    if (LOCAL_HOSTS.has(host) || host.endsWith('.local')) {
      return PRODUCTION_TOKEN_PATTERN.test(`${databaseName} ${userName}`);
    }
    return CLOUD_DATABASE_ENDPOINT_PATTERN.test(target) || PRODUCTION_TOKEN_PATTERN.test(target);
  } catch {
    const normalized = databaseUrl.toLowerCase();
    return (
      CLOUD_DATABASE_ENDPOINT_PATTERN.test(normalized) || PRODUCTION_TOKEN_PATTERN.test(normalized)
    );
  }
}

export function assertRecoveryIntegrityTargetAllowed(args: {
  databaseUrl: string;
  allowProduction: boolean;
  env?: Partial<NodeJS.ProcessEnv>;
}) {
  const productionLike = isProductionLikeDatabaseUrl(args.databaseUrl, args.env ?? process.env);
  if (productionLike && !args.allowProduction) {
    throw new Error(
      'DATABASE_URL looks production-like. Re-run only against a restored/staging/local DB, or pass --allow-production after human approval.',
    );
  }
  return productionLike;
}

function normalizeTimestamp(value: string | Date | null | undefined) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeCount(value: string | number, field = 'count') {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return parsed;
}

function normalizeCounts(rows: RawCountRow[]): RecoveryIntegrityCount[] {
  return rows.map((row) => ({
    category: row.category,
    count: normalizeCount(row.row_count, `${row.category}.row_count`),
    latest_at: normalizeTimestamp(row.latest_at),
  }));
}

function normalizeIntegrityChecks(rows: RawIntegrityRow[]): RecoveryIntegrityCheck[] {
  return rows.map((row) => {
    const issueCount = normalizeCount(row.issue_count, `${row.check_key}.issue_count`);
    return {
      check_key: row.check_key,
      severity: row.severity,
      issue_count: issueCount,
      status: issueCount === 0 ? 'pass' : row.severity === 'error' ? 'fail' : 'attention',
    };
  });
}

function computeLatestObservedDataPoint(counts: RecoveryIntegrityCount[]) {
  let latest: { category: string; timestamp: number } | null = null;
  for (const item of counts) {
    if (!RPO_CRITICAL_CATEGORIES.has(item.category) || !item.latest_at) continue;
    const timestamp = new Date(item.latest_at).getTime();
    if (!Number.isFinite(timestamp)) continue;
    if (!latest || timestamp > latest.timestamp) {
      latest = { category: item.category, timestamp };
    }
  }
  if (!latest) return null;
  return {
    category: latest.category,
    latest_at: new Date(latest.timestamp).toISOString(),
  };
}

function minutesBetween(laterIso: string, earlierIso: string) {
  return Math.max(
    0,
    Math.floor((new Date(laterIso).getTime() - new Date(earlierIso).getTime()) / 60000),
  );
}

function buildRpoHint(args: {
  counts: RecoveryIntegrityCount[];
  generatedAt: string;
  expectedLatestAt?: string;
  rpoMinutes?: number;
}): RecoveryIntegrityRpoHint {
  const latestObserved = computeLatestObservedDataPoint(args.counts);
  const latestObservedAt = latestObserved?.latest_at ?? null;
  const latestObservedCategory = latestObserved?.category ?? null;
  const minutesSinceLatest = latestObservedAt
    ? minutesBetween(args.generatedAt, latestObservedAt)
    : null;

  if (!args.expectedLatestAt || args.rpoMinutes == null) {
    return {
      latest_observed_data_at: latestObservedAt,
      latest_observed_source_category: latestObservedCategory,
      minutes_since_latest_observed_data_at: minutesSinceLatest,
      expected_latest_at: args.expectedLatestAt ?? null,
      rpo_minutes: args.rpoMinutes ?? null,
      basis: 'critical_operational_categories',
      status: 'not_configured',
    };
  }
  if (!latestObservedAt) {
    return {
      latest_observed_data_at: null,
      latest_observed_source_category: null,
      minutes_since_latest_observed_data_at: null,
      expected_latest_at: args.expectedLatestAt,
      rpo_minutes: args.rpoMinutes,
      basis: 'critical_operational_categories',
      status: 'unknown',
    };
  }

  const toleratedEarliest = new Date(args.expectedLatestAt).getTime() - args.rpoMinutes * 60_000;
  const observed = new Date(latestObservedAt).getTime();
  return {
    latest_observed_data_at: latestObservedAt,
    latest_observed_source_category: latestObservedCategory,
    minutes_since_latest_observed_data_at: minutesSinceLatest,
    expected_latest_at: args.expectedLatestAt,
    rpo_minutes: args.rpoMinutes,
    basis: 'critical_operational_categories',
    status: observed >= toleratedEarliest ? 'pass' : 'fail',
  };
}

function buildWarnings(counts: RecoveryIntegrityCount[], rpoHint: RecoveryIntegrityRpoHint) {
  const warnings: string[] = [];
  const countByCategory = new Map(counts.map((item) => [item.category, item.count]));
  if ((countByCategory.get('patients') ?? 0) === 0) {
    warnings.push(
      'patients count is zero; confirm this is an intentionally empty restored target.',
    );
  }
  if ((countByCategory.get('audit_logs') ?? 0) === 0) {
    warnings.push(
      'audit_logs count is zero; confirm audit archive restore expectations separately.',
    );
  }
  if (rpoHint.status === 'unknown') {
    warnings.push('RPO check is unknown because no latest data timestamp was observed.');
  }
  return warnings;
}

export async function runRecoveryIntegrityAudit(args: {
  client: RecoveryIntegrityClient;
  productionLike: boolean;
  allowProduction: boolean;
  expectedLatestAt?: string;
  rpoMinutes?: number;
  now?: Date;
}): Promise<RecoveryIntegrityAuditReport> {
  const generatedAt = (args.now ?? new Date()).toISOString();
  const countsResult = await args.client.query<RawCountRow>(RECOVERY_INTEGRITY_COUNTS_SQL);
  const checksResult = await args.client.query<RawIntegrityRow>(RECOVERY_INTEGRITY_CHECKS_SQL);
  const counts = normalizeCounts(countsResult.rows);
  const integrityChecks = normalizeIntegrityChecks(checksResult.rows);
  const rpoHint = buildRpoHint({
    counts,
    generatedAt,
    expectedLatestAt: args.expectedLatestAt,
    rpoMinutes: args.rpoMinutes,
  });
  const hasIntegrityFailure = integrityChecks.some((check) => check.status === 'fail');
  const hasRpoFailure = rpoHint.status === 'fail' || rpoHint.status === 'unknown';

  return {
    ok: !hasIntegrityFailure && !hasRpoFailure,
    generated_at: generatedAt,
    target: {
      production_like: args.productionLike,
      allow_production: args.allowProduction,
    },
    counts,
    integrity_checks: integrityChecks,
    rpo_hint: rpoHint,
    warnings: buildWarnings(counts, rpoHint),
    output_policy: {
      phi_free: true,
      includes_raw_ids: false,
      includes_raw_text: false,
      includes_storage_keys: false,
      includes_provider_identifiers: false,
    },
  };
}

function formatMarkdown(report: RecoveryIntegrityAuditReport) {
  const lines = [
    `# Backup Recovery Integrity Audit (${report.generated_at})`,
    '',
    `- Result: ${report.ok ? 'PASS' : 'FAIL'}`,
    `- Production-like target: ${report.target.production_like ? 'yes' : 'no'}`,
    `- RPO status: ${report.rpo_hint.status}`,
    `- Latest observed data: ${report.rpo_hint.latest_observed_data_at ?? 'n/a'}`,
    `- Latest observed source: ${report.rpo_hint.latest_observed_source_category ?? 'n/a'}`,
    `- RPO basis: ${report.rpo_hint.basis}`,
    '',
    '## Counts',
    '',
    '| Category | Count | Latest timestamp |',
    '| --- | ---: | --- |',
    ...report.counts.map(
      (item) => `| ${item.category} | ${item.count} | ${item.latest_at ?? 'n/a'} |`,
    ),
    '',
    '## Integrity Checks',
    '',
    '| Check | Severity | Issues | Status |',
    '| --- | --- | ---: | --- |',
    ...report.integrity_checks.map(
      (item) => `| ${item.check_key} | ${item.severity} | ${item.issue_count} | ${item.status} |`,
    ),
  ];

  if (report.warnings.length > 0) {
    lines.push('', '## Warnings', '', ...report.warnings.map((warning) => `- ${warning}`));
  }
  lines.push(
    '',
    '## Output Policy',
    '',
    '- PHI-free output only.',
    '- No raw IDs, raw text, storage keys, AWS identifiers, endpoints, or provider errors are included.',
  );
  return `${lines.join('\n')}\n`;
}

export function serializeRecoveryIntegrityAudit(
  report: RecoveryIntegrityAuditReport,
  format: RecoveryIntegrityFormat,
) {
  return format === 'markdown' ? formatMarkdown(report) : `${JSON.stringify(report, null, 2)}\n`;
}

export async function runRecoveryIntegrityAuditCli(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    console.log(USAGE);
    return;
  }
  const args = parseRecoveryIntegrityAuditArgs(argv);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  const productionLike = assertRecoveryIntegrityTargetAllowed({
    databaseUrl,
    allowProduction: args.allowProduction,
  });

  const client = new Client({
    connectionString: databaseUrl,
    options: '-c default_transaction_read_only=on',
    statement_timeout: 120_000,
    query_timeout: 120_000,
  });
  await client.connect();
  try {
    const report = await runRecoveryIntegrityAudit({
      client,
      productionLike,
      allowProduction: args.allowProduction,
      expectedLatestAt: args.expectedLatestAt,
      rpoMinutes: args.rpoMinutes,
    });
    const output = serializeRecoveryIntegrityAudit(report, args.format);
    if (report.ok) {
      process.stdout.write(output);
    } else {
      process.stderr.write(output);
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

export function formatRecoveryIntegrityCliError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (
    message === 'DATABASE_URL is required' ||
    message.includes('production-like') ||
    message.startsWith('--')
  ) {
    return {
      ok: false,
      message,
      error_kind: message.includes('production-like') ? 'guard' : 'usage',
    };
  }
  return {
    ok: false,
    message: 'backup recovery integrity audit failed',
    error_kind: 'audit',
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runRecoveryIntegrityAuditCli().catch((error) => {
    void inspect;
    console.error(JSON.stringify(formatRecoveryIntegrityCliError(error)));
    process.exit(1);
  });
}
