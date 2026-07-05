import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyHandoffConfirmationTaskInventoryRows,
  parseHandoffConfirmationTaskInventoryArgs,
  renderHandoffConfirmationTaskInventoryMarkdown,
  runHandoffConfirmationTaskInventory,
  summarizeHandoffConfirmationTaskInventoryFindings,
  type HandoffConfirmationTaskInventoryRow,
} from './handoff-confirmation-task-inventory';

function row(
  overrides: Partial<HandoffConfirmationTaskInventoryRow>,
): HandoffConfirmationTaskInventoryRow {
  const value = <K extends keyof HandoffConfirmationTaskInventoryRow>(
    key: K,
    fallback: HandoffConfirmationTaskInventoryRow[K],
  ): HandoffConfirmationTaskInventoryRow[K] =>
    Object.prototype.hasOwnProperty.call(overrides, key)
      ? (overrides[key] as HandoffConfirmationTaskInventoryRow[K])
      : fallback;

  return {
    orgId: value('orgId', 'org_1'),
    taskId: value('taskId', 'task_1'),
    taskStatus: value('taskStatus', 'pending'),
    relatedEntityType: value('relatedEntityType', 'visit_record'),
    visitRecordId: value('visitRecordId', 'visit_record_1'),
    scheduleId: value('scheduleId', 'visit_schedule_1'),
    visitRecordExists: value('visitRecordExists', true),
    dedupeKeyMatches: value('dedupeKeyMatches', true),
    extractionStatus: value('extractionStatus', 'succeeded'),
    visitRecordVersion: value('visitRecordVersion', 3),
    sourceVisitRecordVersion: value('sourceVisitRecordVersion', 3),
    handoffAlreadyConfirmed: value('handoffAlreadyConfirmed', false),
    schedulePharmacistId: value('schedulePharmacistId', 'user_schedule'),
    casePrimaryPharmacistId: value('casePrimaryPharmacistId', 'user_primary'),
    caseBackupPharmacistId: value('caseBackupPharmacistId', 'user_backup'),
    taskCreatedDay: value('taskCreatedDay', '2026-07-05'),
  };
}

describe('handoff-confirmation-task-inventory', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to bounded dry-run and rejects unsafe args', () => {
    expect(parseHandoffConfirmationTaskInventoryArgs([])).toEqual({
      mode: 'dry-run',
      orgId: null,
      maxRows: 5000,
      sampleLimit: 20,
      includeSensitiveSamples: false,
      jsonOutputPath: null,
      markdownOutputPath: null,
    });
    expect(
      parseHandoffConfirmationTaskInventoryArgs([
        '--',
        '--dry-run',
        '--org-id',
        'org_1',
        '--max-rows',
        '25',
        '--sample-limit',
        '3',
        '--include-sensitive-samples',
        '--json-output',
        'tmp/handoff.json',
        '--markdown-output',
        'tmp/handoff.md',
      ]),
    ).toEqual({
      mode: 'dry-run',
      orgId: 'org_1',
      maxRows: 25,
      sampleLimit: 3,
      includeSensitiveSamples: true,
      jsonOutputPath: 'tmp/handoff.json',
      markdownOutputPath: 'tmp/handoff.md',
    });
    expect(() => parseHandoffConfirmationTaskInventoryArgs(['--apply'])).toThrow(
      /Apply mode is not implemented/,
    );
    expect(() => parseHandoffConfirmationTaskInventoryArgs(['--max-rows', '0'])).toThrow(
      /positive integer/,
    );
    expect(parseHandoffConfirmationTaskInventoryArgs(['--sample-limit', '0']).sampleLimit).toBe(0);
    expect(() => parseHandoffConfirmationTaskInventoryArgs(['--org-id', ' org_1'])).toThrow(
      /org-id/,
    );
    expect(() => parseHandoffConfirmationTaskInventoryArgs(['--unknown'])).toThrow(
      /Unknown option/,
    );
  });

  it('classifies historical handoff tasks without exposing PHI-bearing source fields', () => {
    const findings = classifyHandoffConfirmationTaskInventoryRows([
      row({ taskId: 'task_schedule', schedulePharmacistId: 'user_schedule' }),
      row({
        taskId: 'task_primary',
        schedulePharmacistId: null,
        casePrimaryPharmacistId: 'user_primary',
      }),
      row({
        taskId: 'task_backup',
        schedulePharmacistId: null,
        casePrimaryPharmacistId: null,
        caseBackupPharmacistId: 'user_backup',
      }),
      row({
        taskId: 'task_confirmed',
        handoffAlreadyConfirmed: true,
      }),
      row({
        taskId: 'task_missing_record',
        visitRecordExists: false,
        schedulePharmacistId: null,
        casePrimaryPharmacistId: null,
        caseBackupPharmacistId: null,
      }),
      row({
        taskId: 'task_wrong_entity',
        relatedEntityType: 'patient',
        visitRecordId: 'patient_1',
      }),
      row({
        taskId: 'task_dedupe_mismatch',
        dedupeKeyMatches: false,
      }),
      row({
        taskId: 'task_no_extraction',
        extractionStatus: 'failed',
      }),
      row({
        taskId: 'task_no_candidate',
        schedulePharmacistId: null,
        casePrimaryPharmacistId: null,
        caseBackupPharmacistId: null,
      }),
    ]);

    expect(findings).toEqual([
      expect.objectContaining({
        taskId: 'task_backup',
        classification: 'assign_case_backup',
        candidateAssigneeUserId: 'user_backup',
        candidateBasis: 'case_backup',
        wouldBackfillAssignment: true,
        wouldRequireReview: false,
      }),
      expect.objectContaining({
        taskId: 'task_confirmed',
        classification: 'already_confirmed_open_task',
        wouldCloseResolvedTask: true,
        wouldRequireReview: true,
      }),
      expect.objectContaining({
        taskId: 'task_dedupe_mismatch',
        classification: 'dedupe_key_mismatch',
        wouldRequireReview: true,
      }),
      expect.objectContaining({
        taskId: 'task_missing_record',
        classification: 'missing_visit_record',
        candidateAssigneeUserId: null,
        wouldRequireReview: true,
      }),
      expect.objectContaining({
        taskId: 'task_no_candidate',
        classification: 'no_candidate_assignee',
        wouldRequireReview: true,
      }),
      expect.objectContaining({
        taskId: 'task_no_extraction',
        classification: 'extraction_not_succeeded',
        wouldRequireReview: true,
      }),
      expect.objectContaining({
        taskId: 'task_primary',
        classification: 'assign_case_primary',
        candidateAssigneeUserId: 'user_primary',
        candidateBasis: 'case_primary',
        wouldBackfillAssignment: true,
      }),
      expect.objectContaining({
        taskId: 'task_schedule',
        classification: 'assign_schedule_pharmacist',
        candidateAssigneeUserId: 'user_schedule',
        candidateBasis: 'assigned_schedule',
        wouldBackfillAssignment: true,
      }),
      expect.objectContaining({
        taskId: 'task_wrong_entity',
        classification: 'invalid_task_link',
        wouldRequireReview: true,
      }),
    ]);
    expect(JSON.stringify(findings)).not.toContain('patient_name');
    expect(JSON.stringify(findings)).not.toContain('description');
    expect(JSON.stringify(findings)).not.toContain('structured_soap');
    expect(JSON.stringify(findings)).not.toContain('decision_rationale');
  });

  it('summarizes blocking counts with bounded samples and disabled apply mode', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-05T09:00:00.000Z'));
    const findings = classifyHandoffConfirmationTaskInventoryRows([
      row({ taskId: 'task_schedule' }),
      row({ taskId: 'task_primary', schedulePharmacistId: null }),
      row({ taskId: 'task_confirmed', handoffAlreadyConfirmed: true }),
      row({ taskId: 'task_missing_record', visitRecordExists: false }),
      row({
        taskId: 'task_no_candidate',
        schedulePharmacistId: null,
        casePrimaryPharmacistId: null,
        caseBackupPharmacistId: null,
      }),
    ]);

    const summary = summarizeHandoffConfirmationTaskInventoryFindings(findings, {
      mode: 'dry-run',
      orgId: 'org_1',
      maxRows: 10,
      sampleLimit: 1,
      includeSensitiveSamples: false,
      jsonOutputPath: null,
      markdownOutputPath: null,
    });

    expect(summary).toMatchObject({
      ok: false,
      dryRun: true,
      applyReady: false,
      separateApprovalRequired: true,
      generatedAt: '2026-07-05T09:00:00.000Z',
      orgId: 'org_1',
      counts: {
        scannedRows: 5,
        assign_schedule_pharmacist: 1,
        assign_case_primary: 1,
        already_confirmed_open_task: 1,
        missing_visit_record: 1,
        no_candidate_assignee: 1,
        backfillableAssignments: 2,
        closeCandidates: 1,
        blockerCount: 3,
      },
      blockingIssues: [
        '1 tasks point to missing visit records',
        '1 tasks are already confirmed and need close review',
        '1 tasks have no assignment candidate',
      ],
    });
    expect(summary.samples.assign_schedule_pharmacist).toHaveLength(0);
    expect(summary.samples.already_confirmed_open_task).toHaveLength(0);
    expect(summary.samples.missing_visit_record).toHaveLength(0);
  });

  it('renders aggregate-only markdown by default without sensitive operational identifiers', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-05T09:00:00.000Z'));
    const findings = classifyHandoffConfirmationTaskInventoryRows([
      row({
        taskId: 'task|schedule',
        visitRecordId: 'visit_record_1',
        scheduleId: 'visit_schedule_1',
      }),
      row({ taskId: 'task_confirmed', handoffAlreadyConfirmed: true }),
    ]);
    const summary = summarizeHandoffConfirmationTaskInventoryFindings(findings, {
      mode: 'dry-run',
      orgId: 'org_1',
      maxRows: 10,
      sampleLimit: 2,
      includeSensitiveSamples: false,
      jsonOutputPath: null,
      markdownOutputPath: null,
    });

    const markdown = renderHandoffConfirmationTaskInventoryMarkdown(summary);

    expect(markdown).toContain('# Handoff Confirmation Task Inventory');
    expect(markdown).toContain('Read-only inventory');
    expect(markdown).toContain('Apply mode is intentionally disabled');
    expect(markdown).toContain('Sensitive operational row samples are omitted by default');
    expect(markdown).toContain('| assign_schedule_pharmacist | 1 |');
    expect(markdown).toContain('| already_confirmed_open_task | 1 |');
    expect(markdown).not.toContain('task\\|schedule');
    expect(markdown).not.toContain('visit_record_1');
    expect(markdown).not.toContain('visit_schedule_1');
    expect(markdown).not.toContain('user_schedule');
    expect(markdown).not.toContain('田中');
    expect(markdown).not.toContain('token=secret');
    expect(markdown).not.toContain('SOAP');
    expect(markdown).not.toContain('next_check_items');
    expect(markdown).not.toContain('decision_rationale');
  });

  it('renders sensitive row samples only after explicit opt-in', () => {
    const findings = classifyHandoffConfirmationTaskInventoryRows([
      row({
        taskId: 'task|schedule',
        visitRecordId: 'visit_record_1',
        scheduleId: 'visit_schedule_1',
      }),
    ]);
    const summary = summarizeHandoffConfirmationTaskInventoryFindings(findings, {
      mode: 'dry-run',
      orgId: 'org_1',
      maxRows: 10,
      sampleLimit: 2,
      includeSensitiveSamples: true,
      jsonOutputPath: null,
      markdownOutputPath: null,
    });

    const markdown = renderHandoffConfirmationTaskInventoryMarkdown(summary);

    expect(summary.samples.assign_schedule_pharmacist).toHaveLength(1);
    expect(markdown).toContain('task\\|schedule');
    expect(markdown).toContain('visit_record_1');
    expect(markdown).toContain('visit_schedule_1');
    expect(markdown).toContain('user_schedule');
  });

  it('runs dry-run with RLS context and SELECT-only inventory SQL', async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const client = {
      async query(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [], rowCount: null };
        if (sql.includes('set_config')) return { rows: [], rowCount: null };
        if (sql.includes('FROM "Task"')) {
          return {
            rows: [
              row({
                taskId: 'task_schedule',
                orgId: 'org_1',
              }),
            ],
            rowCount: 1,
          };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    };

    const result = await runHandoffConfirmationTaskInventory(
      client as unknown as Parameters<typeof runHandoffConfirmationTaskInventory>[0],
      {
        mode: 'dry-run',
        orgId: 'org_1',
        maxRows: 2,
        sampleLimit: 5,
        includeSensitiveSamples: false,
        jsonOutputPath: null,
        markdownOutputPath: null,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      counts: {
        scannedRows: 1,
        assign_schedule_pharmacist: 1,
      },
    });
    expect(queries.map((query) => query.sql)).toEqual([
      'BEGIN',
      `SELECT set_config('app.current_org_id', $1, true)`,
      `SELECT set_config('app.rls_context_applied', 'true', true)`,
      expect.stringContaining('FROM "Task"'),
      'COMMIT',
    ]);
    expect(
      queries.some((query) =>
        /UPDATE|DELETE|INSERT|UPSERT|ALTER|CREATE|DROP|TRUNCATE|LOCK/i.test(query.sql),
      ),
    ).toBe(false);
    expect(queries[3].sql).toContain('task."org_id" = $1');
    expect(queries[3].sql).toContain('task."task_type" = \'handoff_confirmation\'');
    expect(queries[3].sql).toContain('LIMIT $2');
    expect(queries[3].sql).not.toContain('task."title"');
    expect(queries[3].sql).not.toContain('task."description"');
    expect(queries[3].sql).not.toContain('patient');
    expect(queries[3].values).toEqual(['org_1', 2]);
  });

  it('requires org id before reading tenant-scoped details', async () => {
    const client = {
      query: vi.fn(),
    };

    await expect(
      runHandoffConfirmationTaskInventory(
        client as unknown as Parameters<typeof runHandoffConfirmationTaskInventory>[0],
        {
          mode: 'dry-run',
          orgId: null,
          maxRows: 2,
          sampleLimit: 5,
          includeSensitiveSamples: false,
          jsonOutputPath: null,
          markdownOutputPath: null,
        },
      ),
    ).rejects.toThrow(/--org-id is required/);
    expect(client.query).not.toHaveBeenCalled();
  });
});
