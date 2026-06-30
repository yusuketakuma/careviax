import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { buildTodayOpsRail } from './today-ops-rail';

type AuditTaskFixture = {
  id: string;
  priority: string;
  due_date: Date | null;
  updated_at: Date | null;
  audits: Array<{ result: string }>;
  patientName: string;
  tags?: string[];
};

function buildAuditTask(fixture: AuditTaskFixture) {
  return {
    id: fixture.id,
    priority: fixture.priority,
    due_date: fixture.due_date,
    updated_at: fixture.updated_at,
    audits: fixture.audits,
    cycle: {
      case_: { patient: { name: fixture.patientName } },
      prescription_intakes: [
        {
          lines: [
            {
              packaging_instruction_tags: fixture.tags ?? [],
              packaging_instructions: null,
              notes: null,
              dispensing_method: null,
            },
          ],
        },
      ],
    },
  };
}

function createTx({
  auditTasks = [],
  visits = [],
  exceptions = [],
}: {
  auditTasks?: ReturnType<typeof buildAuditTask>[];
  visits?: Array<{ id?: string; patient_name: string; time_start: Date | null }>;
  exceptions?: Array<{
    id: string;
    exception_type: string;
    description: string;
    severity: string;
    created_at: Date;
    patient_id?: string | null;
  }>;
}) {
  return {
    dispenseTask: { findMany: vi.fn().mockResolvedValue(auditTasks) },
    visitSchedule: {
      findMany: vi.fn().mockResolvedValue(
        visits.map((visit, index) => ({
          id: visit.id ?? `visit_${index + 1}`,
          time_window_start: visit.time_start,
          case_: { patient: { name: visit.patient_name } },
        })),
      ),
    },
    workflowException: {
      findMany: vi.fn().mockResolvedValue(
        exceptions.map((exception) => ({
          patient_id: null,
          ...exception,
        })),
      ),
    },
  } as unknown as Prisma.TransactionClient;
}

describe('buildTodayOpsRail', () => {
  const now = new Date(2026, 5, 11, 9, 42);

  it('builds the narcotic audit next action with the visit-linked description', async () => {
    const tx = createTx({
      auditTasks: [
        buildAuditTask({
          id: 'task_plain',
          priority: 'normal',
          due_date: new Date(2026, 5, 11, 11, 0),
          updated_at: new Date(2026, 5, 11, 8, 0),
          audits: [],
          patientName: '佐藤 花子',
        }),
        buildAuditTask({
          id: 'task_narcotic',
          priority: 'urgent',
          due_date: new Date(2026, 5, 11, 12, 0),
          updated_at: new Date(2026, 5, 11, 8, 30),
          audits: [],
          patientName: '田中 一郎',
          tags: ['narcotic'],
        }),
      ],
      visits: [{ patient_name: '田中 一郎', time_start: new Date(Date.UTC(1970, 0, 1, 14, 0)) }],
      exceptions: [
        {
          id: 'exception_consent',
          exception_type: 'family_consent_pending',
          description: 'ご家族の同意待ち(新規契約)',
          severity: 'critical',
          created_at: new Date(2026, 5, 10, 8, 42),
          patient_id: 'patient_1',
        },
        {
          id: 'exception_delivery',
          exception_type: 'delivery_target_confirmation',
          description: '送付先の確認(やまもと内科)',
          severity: 'warning',
          created_at: new Date(2026, 5, 11, 9, 12),
        },
        {
          id: 'exception_unknown',
          exception_type: 'unexpected_blocker',
          description: '訪問準備の確認待ち',
          severity: 'warning',
          created_at: new Date(2026, 5, 11, 9, 22),
        },
      ],
    });

    const rail = await buildTodayOpsRail(tx, 'org_1', now);

    // 麻薬を最優先に「次にやること」へ昇格させる(危険語を隠さない)
    expect(rail.next_action).toEqual({
      label: '麻薬監査を開始 — 12:00期限',
      description: '14:00訪問(田中様)の持参薬です。完了で午後の予定がすべて確定します。',
      href: '/audit',
    });

    expect(rail.blocked_reasons).toHaveLength(3);
    expect(rail.blocked_reasons[0]).toMatchObject({
      label: 'ご家族の同意待ち(新規契約)',
      severity: 'critical',
      category: '患者',
      action_label: '再連絡する →',
      action_href: '/communications/requests?status=sent&patient_id=patient_1',
    });
    expect(rail.blocked_reasons[0].age_minutes).toBe(25 * 60);
    expect(rail.blocked_reasons[1]).toMatchObject({
      label: '送付先の確認(やまもと内科)',
      severity: 'warning',
      category: '事務',
      age_minutes: 30,
      action_label: '状況を見る →',
      action_href: '/admin/contact-profiles',
    });
    expect(rail.blocked_reasons[2]).toMatchObject({
      label: '訪問準備の確認待ち',
      severity: 'warning',
      category: '事務',
      age_minutes: 20,
      action_label: '状況を見る →',
      action_href: '/workflow?focus=exceptions',
    });
  });

  it('skips audit tasks that already passed and falls back to the plain audit label', async () => {
    const tx = createTx({
      auditTasks: [
        buildAuditTask({
          id: 'task_passed',
          priority: 'urgent',
          due_date: new Date(2026, 5, 11, 10, 0),
          updated_at: null,
          audits: [{ result: 'pass' }],
          patientName: '田中 一郎',
          tags: ['narcotic'],
        }),
        buildAuditTask({
          id: 'task_pending',
          priority: 'normal',
          due_date: null,
          updated_at: new Date(2026, 5, 11, 7, 0),
          audits: [{ result: 'hold' }],
          patientName: '佐藤 花子',
        }),
      ],
    });

    const rail = await buildTodayOpsRail(tx, 'org_1', now);

    expect(rail.next_action.label).toBe('監査を開始する');
    expect(rail.next_action.description).toBe(
      '佐藤 花子 様の調剤監査が待ちです。完了で次の工程が動き出します。',
    );
  });

  it('falls back to visit preparation, then to the daily schedule, when no audits wait', async () => {
    const withVisits = await buildTodayOpsRail(
      createTx({ visits: [{ patient_name: '伊藤 キヨ', time_start: null }] }),
      'org_1',
      now,
    );
    expect(withVisits.next_action).toEqual({
      label: '訪問準備を確認する',
      description: '本日の訪問 1件の準備状況を確認します。',
      href: '/schedules?focus=schedule&schedule_id=visit_1',
    });

    const idle = await buildTodayOpsRail(createTx({}), 'org_1', now);
    expect(idle.next_action).toEqual({
      label: '今日の予定を確認する',
      description: 'いま期限で止まっている作業はありません。',
      href: '/schedules',
    });
    expect(idle.blocked_reasons).toEqual([]);
  });

  it('JST 朝(UTC では前日)でも scheduled_date(@db.Date)をローカル日付の UTC レンジで絞り込む', async () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'Asia/Tokyo';
    try {
      const tx = createTx({});
      // JST 2026-06-12 08:00(UTC では 2026-06-11T23:00Z)
      await buildTodayOpsRail(tx, 'org_1', new Date('2026-06-12T08:00:00+09:00'));

      const findManyMock = (
        tx as unknown as { visitSchedule: { findMany: ReturnType<typeof vi.fn> } }
      ).visitSchedule.findMany;
      const where = findManyMock.mock.calls[0][0].where;
      expect(where.scheduled_date.gte.toISOString()).toBe('2026-06-12T00:00:00.000Z');
      expect(where.scheduled_date.lt.toISOString()).toBe('2026-06-13T00:00:00.000Z');
    } finally {
      if (originalTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });
});
