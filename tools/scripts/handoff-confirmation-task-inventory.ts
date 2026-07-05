import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { inspect } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Client, type QueryResultRow } from 'pg';

type InventoryMode = 'dry-run';

export type HandoffConfirmationTaskInventoryOptions = {
  mode: InventoryMode;
  orgId: string | null;
  maxRows: number;
  sampleLimit: number;
  includeSensitiveSamples: boolean;
  jsonOutputPath: string | null;
  markdownOutputPath: string | null;
};

type PgClientLike = {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: unknown[],
  ): Promise<{
    rows: T[];
    rowCount: number | null;
  }>;
};

type HandoffConfirmationTaskInventoryQueryRow = Omit<
  HandoffConfirmationTaskInventoryRow,
  'taskCreatedDay'
> & {
  taskDay: string | null;
};

export type HandoffConfirmationTaskInventoryRow = {
  orgId: string;
  taskId: string;
  taskStatus: string;
  relatedEntityType: string | null;
  visitRecordId: string | null;
  scheduleId: string | null;
  visitRecordExists: boolean;
  dedupeKeyMatches: boolean | null;
  extractionStatus: string | null;
  visitRecordVersion: number | null;
  sourceVisitRecordVersion: number | null;
  handoffAlreadyConfirmed: boolean;
  schedulePharmacistId: string | null;
  casePrimaryPharmacistId: string | null;
  caseBackupPharmacistId: string | null;
  taskCreatedDay: string | null;
};

export type HandoffConfirmationTaskInventoryClassification =
  | 'assign_schedule_pharmacist'
  | 'assign_case_primary'
  | 'assign_case_backup'
  | 'already_confirmed_open_task'
  | 'invalid_task_link'
  | 'missing_visit_record'
  | 'dedupe_key_mismatch'
  | 'extraction_not_succeeded'
  | 'no_candidate_assignee';

export type HandoffConfirmationTaskInventoryFinding = {
  classification: HandoffConfirmationTaskInventoryClassification;
  reason: string;
  orgId: string;
  taskId: string;
  taskStatus: string;
  visitRecordId: string | null;
  scheduleId: string | null;
  visitRecordExists: boolean;
  dedupeKeyMatches: boolean | null;
  extractionStatus: string | null;
  visitRecordVersion: number | null;
  sourceVisitRecordVersion: number | null;
  handoffAlreadyConfirmed: boolean;
  candidateAssigneeUserId: string | null;
  candidateBasis: 'assigned_schedule' | 'case_primary' | 'case_backup' | null;
  taskCreatedDay: string | null;
  wouldRequireReview: boolean;
  wouldBackfillAssignment: boolean;
  wouldCloseResolvedTask: boolean;
};

export type HandoffConfirmationTaskInventoryCounts = Record<
  HandoffConfirmationTaskInventoryClassification,
  number
> & {
  scannedRows: number;
  backfillableAssignments: number;
  closeCandidates: number;
  blockerCount: number;
};

export type HandoffConfirmationTaskInventoryResult = {
  ok: boolean;
  mode: InventoryMode;
  dryRun: true;
  applyReady: false;
  separateApprovalRequired: true;
  generatedAt: string;
  orgId: string;
  maxRows: number;
  truncated: boolean;
  counts: HandoffConfirmationTaskInventoryCounts;
  blockingIssues: string[];
  samples: Record<
    HandoffConfirmationTaskInventoryClassification,
    HandoffConfirmationTaskInventoryFinding[]
  >;
};

const DEFAULT_MAX_ROWS = 5_000;
const DEFAULT_SAMPLE_LIMIT = 20;
const FLAGS_WITH_VALUES = new Set([
  '--org-id',
  '--max-rows',
  '--sample-limit',
  '--json-output',
  '--markdown-output',
]);
const KNOWN_FLAGS = new Set([
  '--dry-run',
  '--help',
  '--apply',
  '--include-sensitive-samples',
  ...FLAGS_WITH_VALUES,
]);
const USAGE = [
  'Usage: pnpm db:handoff-confirmation-tasks:inventory -- --org-id ORG [--dry-run] [--max-rows N] [--sample-limit N] [--include-sensitive-samples] [--json-output PATH] [--markdown-output PATH]',
  'Default mode is --dry-run. This helper is intentionally read-only; --apply is not implemented.',
  'The report is PHI-minimized: it does not select Task title/description, patient names, or SOAP/handoff free text.',
  'Row-level samples contain sensitive operational IDs and are omitted unless --include-sensitive-samples is explicitly provided.',
].join('\n');

function readValue(argv: string[], name: string) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parsePositiveInt(value: string | null, name: string, fallback: number) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInt(value: string | null, name: string, fallback: number) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function parseOrgId(value: string | null) {
  if (value == null) return null;
  if (value.trim() !== value || value.length === 0) {
    throw new Error('--org-id must be a non-empty safe org id without surrounding whitespace');
  }
  return value;
}

export function parseHandoffConfirmationTaskInventoryArgs(
  argv: string[],
): HandoffConfirmationTaskInventoryOptions {
  const args = argv.filter((arg) => arg !== '--');

  if (args.includes('--help')) {
    throw new Error(USAGE);
  }
  for (const arg of args) {
    if (arg.startsWith('--') && !KNOWN_FLAGS.has(arg)) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (args.includes('--apply')) {
    throw new Error('Apply mode is not implemented for handoff confirmation task inventory');
  }

  return {
    mode: 'dry-run',
    orgId: parseOrgId(readValue(args, '--org-id')),
    maxRows: parsePositiveInt(readValue(args, '--max-rows'), '--max-rows', DEFAULT_MAX_ROWS),
    sampleLimit: parseNonNegativeInt(
      readValue(args, '--sample-limit'),
      '--sample-limit',
      DEFAULT_SAMPLE_LIMIT,
    ),
    includeSensitiveSamples: args.includes('--include-sensitive-samples'),
    jsonOutputPath: readValue(args, '--json-output'),
    markdownOutputPath: readValue(args, '--markdown-output'),
  };
}

function selectCandidate(row: HandoffConfirmationTaskInventoryRow): {
  userId: string | null;
  basis: HandoffConfirmationTaskInventoryFinding['candidateBasis'];
  classification:
    | 'assign_schedule_pharmacist'
    | 'assign_case_primary'
    | 'assign_case_backup'
    | 'no_candidate_assignee';
} {
  if (row.schedulePharmacistId) {
    return {
      userId: row.schedulePharmacistId,
      basis: 'assigned_schedule',
      classification: 'assign_schedule_pharmacist',
    };
  }
  if (row.casePrimaryPharmacistId) {
    return {
      userId: row.casePrimaryPharmacistId,
      basis: 'case_primary',
      classification: 'assign_case_primary',
    };
  }
  if (row.caseBackupPharmacistId) {
    return {
      userId: row.caseBackupPharmacistId,
      basis: 'case_backup',
      classification: 'assign_case_backup',
    };
  }
  return { userId: null, basis: null, classification: 'no_candidate_assignee' };
}

function finding(
  row: HandoffConfirmationTaskInventoryRow,
  classification: HandoffConfirmationTaskInventoryClassification,
  reason: string,
  candidate: ReturnType<typeof selectCandidate>,
): HandoffConfirmationTaskInventoryFinding {
  const wouldBackfillAssignment = classification.startsWith('assign_');
  return {
    classification,
    reason,
    orgId: row.orgId,
    taskId: row.taskId,
    taskStatus: row.taskStatus,
    visitRecordId: row.visitRecordId,
    scheduleId: row.scheduleId,
    visitRecordExists: row.visitRecordExists,
    dedupeKeyMatches: row.dedupeKeyMatches,
    extractionStatus: row.extractionStatus,
    visitRecordVersion: row.visitRecordVersion,
    sourceVisitRecordVersion: row.sourceVisitRecordVersion,
    handoffAlreadyConfirmed: row.handoffAlreadyConfirmed,
    candidateAssigneeUserId: candidate.userId,
    candidateBasis: candidate.basis,
    taskCreatedDay: row.taskCreatedDay,
    wouldRequireReview: !wouldBackfillAssignment,
    wouldBackfillAssignment,
    wouldCloseResolvedTask: classification === 'already_confirmed_open_task',
  };
}

export function classifyHandoffConfirmationTaskInventoryRows(
  rows: HandoffConfirmationTaskInventoryRow[],
): HandoffConfirmationTaskInventoryFinding[] {
  return [...rows]
    .sort((a, b) => {
      const day = (a.taskCreatedDay ?? '').localeCompare(b.taskCreatedDay ?? '');
      if (day !== 0) return day;
      return a.taskId.localeCompare(b.taskId);
    })
    .map((row) => {
      const candidate = selectCandidate(row);
      if (row.relatedEntityType !== 'visit_record' || !row.visitRecordId) {
        return finding(row, 'invalid_task_link', 'task_does_not_point_to_visit_record', {
          userId: null,
          basis: null,
          classification: 'no_candidate_assignee',
        });
      }
      if (!row.visitRecordExists) {
        return finding(row, 'missing_visit_record', 'visit_record_missing_or_cross_org', {
          userId: null,
          basis: null,
          classification: 'no_candidate_assignee',
        });
      }
      if (row.dedupeKeyMatches !== true) {
        return finding(row, 'dedupe_key_mismatch', 'handoff_task_dedupe_key_mismatch', candidate);
      }
      if (row.handoffAlreadyConfirmed) {
        return finding(
          row,
          'already_confirmed_open_task',
          'handoff_already_confirmed_but_task_still_open',
          candidate,
        );
      }
      if (row.extractionStatus !== 'succeeded') {
        return finding(
          row,
          'extraction_not_succeeded',
          'handoff_extraction_not_succeeded',
          candidate,
        );
      }
      if (candidate.classification === 'no_candidate_assignee') {
        return finding(
          row,
          'no_candidate_assignee',
          'no_schedule_or_case_pharmacist_candidate',
          candidate,
        );
      }
      return finding(row, candidate.classification, 'assignment_candidate_found', candidate);
    });
}

const INVENTORY_CLASSIFICATION_ORDER: HandoffConfirmationTaskInventoryClassification[] = [
  'assign_schedule_pharmacist',
  'assign_case_primary',
  'assign_case_backup',
  'already_confirmed_open_task',
  'invalid_task_link',
  'missing_visit_record',
  'dedupe_key_mismatch',
  'extraction_not_succeeded',
  'no_candidate_assignee',
];

export function summarizeHandoffConfirmationTaskInventoryFindings(
  findings: HandoffConfirmationTaskInventoryFinding[],
  options: HandoffConfirmationTaskInventoryOptions & { orgId: string },
): HandoffConfirmationTaskInventoryResult {
  const counts: HandoffConfirmationTaskInventoryCounts = {
    scannedRows: findings.length,
    backfillableAssignments: 0,
    closeCandidates: 0,
    blockerCount: 0,
    assign_schedule_pharmacist: 0,
    assign_case_primary: 0,
    assign_case_backup: 0,
    already_confirmed_open_task: 0,
    invalid_task_link: 0,
    missing_visit_record: 0,
    dedupe_key_mismatch: 0,
    extraction_not_succeeded: 0,
    no_candidate_assignee: 0,
  };
  const samples: HandoffConfirmationTaskInventoryResult['samples'] = {
    assign_schedule_pharmacist: [],
    assign_case_primary: [],
    assign_case_backup: [],
    already_confirmed_open_task: [],
    invalid_task_link: [],
    missing_visit_record: [],
    dedupe_key_mismatch: [],
    extraction_not_succeeded: [],
    no_candidate_assignee: [],
  };

  for (const finding of findings) {
    counts[finding.classification] += 1;
    if (finding.wouldBackfillAssignment) counts.backfillableAssignments += 1;
    if (finding.wouldCloseResolvedTask) counts.closeCandidates += 1;
    if (finding.wouldRequireReview) counts.blockerCount += 1;
    if (options.includeSensitiveSamples) {
      const bucket = samples[finding.classification];
      if (bucket.length < options.sampleLimit) bucket.push(finding);
    }
  }

  const blockingIssues = [
    counts.invalid_task_link > 0 ? `${counts.invalid_task_link} tasks have invalid links` : null,
    counts.missing_visit_record > 0
      ? `${counts.missing_visit_record} tasks point to missing visit records`
      : null,
    counts.dedupe_key_mismatch > 0
      ? `${counts.dedupe_key_mismatch} tasks have dedupe key mismatches`
      : null,
    counts.already_confirmed_open_task > 0
      ? `${counts.already_confirmed_open_task} tasks are already confirmed and need close review`
      : null,
    counts.extraction_not_succeeded > 0
      ? `${counts.extraction_not_succeeded} tasks do not have succeeded handoff extraction`
      : null,
    counts.no_candidate_assignee > 0
      ? `${counts.no_candidate_assignee} tasks have no assignment candidate`
      : null,
  ].filter((issue): issue is string => issue !== null);

  return {
    ok: blockingIssues.length === 0,
    mode: options.mode,
    dryRun: true,
    applyReady: false,
    separateApprovalRequired: true,
    generatedAt: new Date().toISOString(),
    orgId: options.orgId,
    maxRows: options.maxRows,
    truncated: findings.length >= options.maxRows,
    counts,
    blockingIssues,
    samples,
  };
}

function markdownTableCell(value: unknown) {
  if (value === null || value === undefined || value === '') return '-';
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function renderHandoffConfirmationTaskInventoryMarkdown(
  result: HandoffConfirmationTaskInventoryResult,
) {
  const lines: string[] = [
    '# Handoff Confirmation Task Inventory',
    '',
    'Read-only inventory. Apply mode is intentionally disabled; assignment backfill or task close requires separate explicit approval.',
    '',
    'Sensitive operational row samples are omitted by default. Re-run with `--include-sensitive-samples` only for approved local review artifacts.',
    '',
    '## Summary',
    '',
    `- generated_at: ${result.generatedAt}`,
    `- org_id: ${result.orgId}`,
    `- scanned_rows: ${result.counts.scannedRows}`,
    `- max_rows: ${result.maxRows}`,
    `- truncated: ${result.truncated ? 'yes' : 'no'}`,
    `- ok: ${result.ok ? 'yes' : 'no'}`,
    `- apply_ready: ${result.applyReady ? 'yes' : 'no'}`,
    `- separate_approval_required: ${result.separateApprovalRequired ? 'yes' : 'no'}`,
    '',
    '## Counts',
    '',
    '| classification | count |',
    '| --- | ---: |',
  ];

  for (const classification of INVENTORY_CLASSIFICATION_ORDER) {
    lines.push(`| ${classification} | ${result.counts[classification]} |`);
  }
  lines.push(
    `| backfillableAssignments | ${result.counts.backfillableAssignments} |`,
    `| closeCandidates | ${result.counts.closeCandidates} |`,
    `| blockerCount | ${result.counts.blockerCount} |`,
    `| scannedRows | ${result.counts.scannedRows} |`,
    '',
    '## Blocking Issues',
    '',
  );

  if (result.blockingIssues.length === 0) {
    lines.push('- None', '');
  } else {
    for (const issue of result.blockingIssues) {
      lines.push(`- ${issue}`);
    }
    lines.push('');
  }

  lines.push('## Samples', '');
  for (const classification of INVENTORY_CLASSIFICATION_ORDER) {
    const samples = result.samples[classification];
    if (samples.length === 0) continue;
    lines.push(`### ${classification}`, '');
    lines.push(
      '| task_id | org_id | status | visit_record_id | schedule_id | extraction_status | candidate_assignee | candidate_basis | created_day | review_required | reason |',
    );
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const sample of samples) {
      lines.push(
        [
          sample.taskId,
          sample.orgId,
          sample.taskStatus,
          sample.visitRecordId,
          sample.scheduleId,
          sample.extractionStatus,
          sample.candidateAssigneeUserId,
          sample.candidateBasis,
          sample.taskCreatedDay,
          sample.wouldRequireReview ? 'yes' : 'no',
          sample.reason,
        ]
          .map(markdownTableCell)
          .join(' | ')
          .replace(/^/, '| ')
          .replace(/$/, ' |'),
      );
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

async function writeTextArtifact(filePath: string, content: string) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

async function writeHandoffConfirmationTaskInventoryArtifacts(
  result: HandoffConfirmationTaskInventoryResult,
  options: HandoffConfirmationTaskInventoryOptions,
) {
  if (options.jsonOutputPath) {
    await writeTextArtifact(options.jsonOutputPath, `${JSON.stringify(result, null, 2)}\n`);
  }
  if (options.markdownOutputPath) {
    await writeTextArtifact(
      options.markdownOutputPath,
      renderHandoffConfirmationTaskInventoryMarkdown(result),
    );
  }
}

async function readHandoffConfirmationTaskInventoryRows(
  client: PgClientLike,
  options: HandoffConfirmationTaskInventoryOptions & { orgId: string },
) {
  const result = await client.query<HandoffConfirmationTaskInventoryQueryRow>(
    `
      WITH target_tasks AS (
        SELECT
          task."org_id" AS "orgId",
          task."id" AS "taskId",
          task."status"::text AS "taskStatus",
          task."dedupe_key" = CONCAT('handoff_confirm_', task."related_entity_id") AS "dedupeKeyMatches",
          task."related_entity_type" AS "relatedEntityType",
          task."related_entity_id" AS "visitRecordId",
          NULL::text AS "taskDay"
        FROM "Task" task
        WHERE task."org_id" = $1
          AND task."task_type" = 'handoff_confirmation'
          AND task."assigned_to" IS NULL
          AND task."status" IN ('pending', 'in_progress')
        ORDER BY task."id" ASC
        LIMIT $2
      )
      SELECT
        target_tasks."orgId",
        target_tasks."taskId",
        target_tasks."taskStatus",
        target_tasks."dedupeKeyMatches",
        target_tasks."relatedEntityType",
        target_tasks."visitRecordId",
        target_tasks."taskDay",
        visit_record."id" IS NOT NULL AS "visitRecordExists",
        visit_record."version" AS "visitRecordVersion",
        visit_record."schedule_id" AS "scheduleId",
        extraction."status"::text AS "extractionStatus",
        extraction."source_visit_record_version" AS "sourceVisitRecordVersion",
        (
          visit_record."structured_soap"::jsonb -> 'handoff' ->> 'confirmed_by' IS NOT NULL
          OR visit_record."structured_soap"::jsonb -> 'handoff' ->> 'confirmed_at' IS NOT NULL
        ) AS "handoffAlreadyConfirmed",
        visit_schedule."pharmacist_id" AS "schedulePharmacistId",
        care_case."primary_pharmacist_id" AS "casePrimaryPharmacistId",
        care_case."backup_pharmacist_id" AS "caseBackupPharmacistId"
      FROM target_tasks
      LEFT JOIN "VisitRecord" visit_record
        ON visit_record."org_id" = target_tasks."orgId"
       AND visit_record."id" = target_tasks."visitRecordId"
       AND target_tasks."relatedEntityType" = 'visit_record'
      LEFT JOIN "VisitSchedule" visit_schedule
        ON visit_schedule."org_id" = target_tasks."orgId"
       AND visit_schedule."id" = visit_record."schedule_id"
      LEFT JOIN "CareCase" care_case
        ON care_case."org_id" = target_tasks."orgId"
       AND care_case."id" = visit_schedule."case_id"
      LEFT JOIN "VisitHandoffExtraction" extraction
        ON extraction."org_id" = target_tasks."orgId"
       AND extraction."visit_record_id" = visit_record."id"
      ORDER BY target_tasks."taskId" ASC
    `,
    [options.orgId, options.maxRows],
  );
  return result.rows.map((row) => ({
    ...row,
    taskCreatedDay: row.taskDay,
  }));
}

export async function runHandoffConfirmationTaskInventory(
  client: PgClientLike,
  options: HandoffConfirmationTaskInventoryOptions,
) {
  if (!options.orgId) {
    throw new Error('--org-id is required for handoff confirmation task inventory');
  }

  await client.query('BEGIN');
  try {
    await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [options.orgId]);
    await client.query(`SELECT set_config('app.rls_context_applied', 'true', true)`);
    const rows = await readHandoffConfirmationTaskInventoryRows(client, {
      ...options,
      orgId: options.orgId,
    });
    const findings = classifyHandoffConfirmationTaskInventoryRows(rows);
    const result = summarizeHandoffConfirmationTaskInventoryFindings(findings, {
      ...options,
      orgId: options.orgId,
    });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log(USAGE);
    return;
  }

  const options = parseHandoffConfirmationTaskInventoryArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const client = new Client({
    connectionString: databaseUrl,
    statement_timeout: 120_000,
    query_timeout: 120_000,
  });
  await client.connect();
  try {
    const result = await runHandoffConfirmationTaskInventory(client, options);
    await writeHandoffConfirmationTaskInventoryArtifacts(result, options);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        ok: false,
        message:
          error instanceof Error && error.message.length > 0
            ? error.message
            : inspect(error, { depth: 2 }),
      }),
    );
    process.exit(1);
  });
}
