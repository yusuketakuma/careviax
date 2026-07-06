import { describe, expect, it } from 'vitest';
import {
  buildOperationalTaskHealthBoard,
  normalizeOperationalTaskHealthLimit,
  type OperationalTaskHealthDb,
} from './operational-task-health';

const NOW = new Date('2026-07-06T00:00:00.000Z');

type TaskRow = Awaited<ReturnType<OperationalTaskHealthDb['task']['findMany']>>[number];

function task(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: overrides.id ?? 'task_1',
    display_id: overrides.display_id ?? 't0000000001',
    task_type: overrides.task_type ?? 'visit_preparation',
    status: overrides.status ?? 'pending',
    priority: overrides.priority ?? 'normal',
    assigned_to: Object.hasOwn(overrides, 'assigned_to')
      ? (overrides.assigned_to ?? null)
      : 'user_1',
    due_date: overrides.due_date ?? null,
    sla_due_at: overrides.sla_due_at ?? null,
    dedupe_key: overrides.dedupe_key ?? null,
    related_entity_type: overrides.related_entity_type ?? null,
    related_entity_id: overrides.related_entity_id ?? null,
    metadata: overrides.metadata ?? null,
    created_at: overrides.created_at ?? new Date('2026-07-05T00:00:00.000Z'),
    updated_at: overrides.updated_at ?? new Date('2026-07-05T00:00:00.000Z'),
  };
}

function riskMetadata(overrides: Record<string, unknown> = {}) {
  return {
    source: 'risk_finding',
    risk_domain: 'medication',
    risk_key: 'rx-change',
    risk_severity: 'urgent',
    case_id: 'case_1',
    patient_id: 'patient_1',
    related_entity_type: 'medication',
    related_entity_id: 'rx_1',
    patient_safety: true,
    billing_close: false,
    ...overrides,
  };
}

function db(rows: TaskRow[]): OperationalTaskHealthDb {
  return {
    task: {
      async findMany(args) {
        const take = args.take;
        return rows.slice(0, take);
      },
    },
  };
}

describe('operational-task-health', () => {
  it('normalizes scan limits defensively', () => {
    expect(normalizeOperationalTaskHealthLimit(undefined)).toBe(500);
    expect(normalizeOperationalTaskHealthLimit(Number.NaN)).toBe(500);
    expect(normalizeOperationalTaskHealthLimit(-1)).toBe(1);
    expect(normalizeOperationalTaskHealthLimit(1200)).toBe(1000);
    expect(normalizeOperationalTaskHealthLimit(25.9)).toBe(25);
  });

  it('aggregates overdue, SLA, unassigned, safety, billing, and report health without exposing task text', async () => {
    const board = await buildOperationalTaskHealthBoard(
      db([
        task({
          id: 'risk_1',
          task_type: 'risk_medication',
          priority: 'urgent',
          assigned_to: null,
          due_date: new Date('2026-07-05T00:00:00.000Z'),
          sla_due_at: new Date('2026-07-05T12:00:00.000Z'),
          dedupe_key: 'risk:medication:rx-change:case:case_1:medication:rx_1',
          related_entity_type: 'medication',
          related_entity_id: 'rx_1',
          metadata: riskMetadata(),
          updated_at: new Date('2026-07-03T00:00:00.000Z'),
        }),
        task({
          id: 'risk_report',
          task_type: 'risk_report_delivery',
          priority: 'high',
          dedupe_key: 'risk:report_delivery:delivery:case:case_1:care_report:report_1',
          related_entity_type: 'care_report',
          related_entity_id: 'report_1',
          metadata: riskMetadata({
            risk_domain: 'report_delivery',
            risk_key: 'delivery',
            related_entity_type: 'care_report',
            related_entity_id: 'report_1',
            patient_safety: false,
            billing_close: true,
          }),
        }),
        task({
          id: 'general_1',
          task_type: 'conference_action_item',
          priority: 'normal',
        }),
      ]),
      {
        orgId: 'org_1',
        now: NOW,
      },
    );

    expect(board.summary).toMatchObject({
      open_count: 3,
      overdue_count: 1,
      sla_overdue_count: 1,
      unassigned_count: 1,
      patient_safety_count: 1,
      billing_close_count: 1,
      report_delay_count: 1,
      risk_task_count: 2,
      stale_risk_task_count: 1,
      orphan_risk_task_count: 0,
    });
    expect(board.risk_domain_groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'medication', count: 1, urgent_count: 1 }),
        expect.objectContaining({ key: 'report_delivery', count: 1, high_count: 1 }),
      ]),
    );
    expect(board.attention.sla_overdue_tasks[0]).toEqual({
      task_id: 'risk_1',
      display_id: 't0000000001',
      task_type: 'risk_medication',
      priority: 'urgent',
      due_at: '2026-07-05T12:00:00.000Z',
      action_href: '/tasks?status=open&task_type=risk_medication',
    });
    expect(JSON.stringify(board)).not.toContain('metadata');
    expect(JSON.stringify(board)).not.toContain('dedupe');
    expect(JSON.stringify(board)).not.toContain('rx-change');
  });

  it('flags malformed risk tasks as orphan audit findings without auto-closing them', async () => {
    const board = await buildOperationalTaskHealthBoard(
      db([
        task({
          id: 'orphan_1',
          task_type: 'risk_billing',
          priority: 'high',
          dedupe_key: 'billing:old',
          related_entity_type: 'billing_evidence',
          related_entity_id: 'billing_1',
          metadata: {
            source: 'manual',
            risk_domain: 'medication',
            related_entity_type: 'billing_evidence',
            related_entity_id: 'billing_2',
          },
        }),
      ]),
      {
        orgId: 'org_1',
        now: NOW,
      },
    );

    expect(board.summary.orphan_risk_task_count).toBe(1);
    expect(board.orphan_audit.checked_count).toBe(1);
    expect(board.orphan_audit.orphan_count).toBe(1);
    expect(board.orphan_audit.reasons).toEqual(
      expect.arrayContaining([
        { reason: 'invalid_metadata_source', count: 1 },
        { reason: 'task_type_domain_mismatch', count: 1 },
        { reason: 'missing_risk_key', count: 1 },
        { reason: 'invalid_dedupe_key', count: 1 },
        { reason: 'related_entity_mismatch', count: 1 },
      ]),
    );
    expect(board.orphan_audit.tasks).toEqual([
      expect.objectContaining({
        task_id: 'orphan_1',
        task_type: 'risk_billing',
      }),
    ]);
  });

  it('audits risk-like tasks even when a legacy task type drifted outside the managed registry', async () => {
    const board = await buildOperationalTaskHealthBoard(
      db([
        task({
          id: 'legacy_risk',
          task_type: 'general',
          priority: 'urgent',
          dedupe_key: 'risk:medication:legacy:case:case_1:medication:rx_1',
          related_entity_type: 'medication',
          related_entity_id: 'rx_1',
          metadata: riskMetadata(),
        }),
        task({
          id: 'dedupe_only',
          task_type: 'general',
          priority: 'high',
          dedupe_key: 'risk:unknown:broken',
          metadata: null,
        }),
      ]),
      {
        orgId: 'org_1',
        now: NOW,
      },
    );

    expect(board.summary.risk_task_count).toBe(2);
    expect(board.summary.orphan_risk_task_count).toBe(2);
    expect(board.orphan_audit.checked_count).toBe(2);
    expect(board.orphan_audit.reasons).toEqual(
      expect.arrayContaining([
        { reason: 'task_type_domain_mismatch', count: 1 },
        { reason: 'invalid_metadata_source', count: 1 },
        { reason: 'invalid_risk_domain', count: 1 },
        { reason: 'missing_risk_key', count: 1 },
        { reason: 'missing_owner_reference', count: 1 },
      ]),
    );
    expect(board.orphan_audit.tasks.map((entry) => entry.task_id)).toEqual([
      'legacy_risk',
      'dedupe_only',
    ]);
  });
});
