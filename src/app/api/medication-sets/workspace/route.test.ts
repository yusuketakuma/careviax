import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authContextMock,
  visitScheduleFindManyMock,
  setPlanFindManyMock,
  cycleFindManyMock,
  exceptionCountMock,
  userFindManyMock,
  drugMasterFindManyMock,
} = vi.hoisted(() => ({
  authContextMock: { orgId: 'org_1', userId: 'user_1', role: 'admin' },
  visitScheduleFindManyMock: vi.fn(),
  setPlanFindManyMock: vi.fn(),
  cycleFindManyMock: vi.fn(),
  exceptionCountMock: vi.fn(),
  userFindManyMock: vi.fn(),
  drugMasterFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
      handler(req, authContextMock, routeContext);
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: (_orgId: string, fn: (tx: unknown) => unknown) =>
    fn({
      visitSchedule: { findMany: visitScheduleFindManyMock },
      setPlan: { findMany: setPlanFindManyMock },
      medicationCycle: { findMany: cycleFindManyMock },
      workflowException: { count: exceptionCountMock },
      user: { findMany: userFindManyMock },
      drugMaster: { findMany: drugMasterFindManyMock },
    }),
}));

import { GET } from './route';
import {
  buildCalendarMatrix,
  deriveRowStatus,
  deriveSlotMarks,
} from '@/lib/dispensing/set-derivations';

function createRequest(query = '') {
  return new NextRequest(`http://localhost/api/medication-sets/workspace${query}`, {
    headers: { 'x-org-id': 'org_1' },
  });
}

function buildSchedule(args: {
  id: string;
  caseId: string;
  patientId: string;
  patientName: string;
  room?: string | null;
  facility?: { id: string; name: string } | null;
  time?: Date | null;
  allergy?: unknown;
  pharmacistId?: string;
}) {
  return {
    id: args.id,
    case_id: args.caseId,
    pharmacist_id: args.pharmacistId ?? 'user_yamada',
    time_window_start: args.time ?? new Date(2026, 5, 11, 15, 30),
    case_: {
      id: args.caseId,
      patient: {
        id: args.patientId,
        name: args.patientName,
        allergy_info: args.allergy ?? null,
        residences:
          args.facility === null
            ? []
            : [
                {
                  unit_name: args.room ?? '101',
                  facility_id: args.facility?.id ?? 'facility_gh',
                  facility: args.facility ?? { id: 'facility_gh', name: 'グリーンヒル' },
                },
              ],
      },
    },
  };
}

function buildPlan(args: {
  id: string;
  caseId: string;
  slots?: Array<{
    slot: string;
    day: number;
    lineId: string;
    tags?: string[];
    drugCode?: string | null;
  }>;
  auditResult?: string | null;
  changedBy?: string | null;
  periodDays?: number;
}) {
  const periodDays = args.periodDays ?? 1;
  return {
    id: args.id,
    target_period_start: new Date(2026, 5, 11),
    target_period_end: new Date(2026, 5, 11 + (periodDays - 1)),
    cycle: { case_id: args.caseId },
    batches: (args.slots ?? []).map((slot) => ({
      line_id: slot.lineId,
      line: { drug_code: slot.drugCode ?? null },
      slot: slot.slot,
      day_number: slot.day,
      packaging_instruction_tags_snapshot: slot.tags ?? [],
    })),
    audits: args.auditResult ? [{ result: args.auditResult }] : [],
    change_logs: [{ changed_by: args.changedBy ?? 'user_suzuki' }],
  };
}

describe('/api/medication-sets/workspace', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 11, 9, 42));
    vi.clearAllMocks();
    visitScheduleFindManyMock.mockResolvedValue([]);
    setPlanFindManyMock.mockResolvedValue([]);
    cycleFindManyMock.mockResolvedValue([]);
    exceptionCountMock.mockResolvedValue(0);
    drugMasterFindManyMock.mockResolvedValue([]);
    userFindManyMock.mockResolvedValue([
      {
        id: 'user_suzuki',
        name: '鈴木',
        memberships: [{ role: 'clerk' }],
      },
      {
        id: 'user_yamada',
        name: '山田',
        memberships: [{ role: 'pharmacist' }],
      },
    ]);
  });

  it('施設グルーピング・状態・レーン件数・担当ラベルを返す', async () => {
    visitScheduleFindManyMock.mockImplementation((args: { where: { scheduled_date: unknown } }) => {
      // 1 回目: 本日訪問 / 2 回目(明日先行可)は空
      if (visitScheduleFindManyMock.mock.calls.length === 1) {
        return Promise.resolve([
          buildSchedule({
            id: 'visit_1',
            caseId: 'case_ogawa',
            patientId: 'patient_ogawa',
            patientName: '小川 タケ',
            room: '101',
          }),
          buildSchedule({
            id: 'visit_2',
            caseId: 'case_nakamura',
            patientId: 'patient_nakamura',
            patientName: '中村 ヨシ',
            room: '103',
            allergy: [{ substance: 'セフェム系' }],
          }),
          buildSchedule({
            id: 'visit_3',
            caseId: 'case_home',
            patientId: 'patient_home',
            patientName: '田中 一郎',
            facility: null,
          }),
        ]);
      }
      void args;
      return Promise.resolve([]);
    });
    setPlanFindManyMock.mockResolvedValue([
      buildPlan({
        id: 'plan_ogawa',
        caseId: 'case_ogawa',
        auditResult: 'approved',
        slots: [
          { slot: 'morning', day: 1, lineId: 'line_1' },
          { slot: 'noon', day: 1, lineId: 'line_1' },
          { slot: 'evening', day: 1, lineId: 'line_2', tags: ['cold_storage'] },
        ],
      }),
      buildPlan({
        id: 'plan_nakamura',
        caseId: 'case_nakamura',
        periodDays: 2,
        slots: [
          { slot: 'morning', day: 1, lineId: 'line_3' },
          { slot: 'morning', day: 2, lineId: 'line_3' },
          { slot: 'noon', day: 1, lineId: 'line_4', tags: ['narcotic'] },
        ],
      }),
    ]);

    const res = await GET(createRequest('?scope=today'), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = await res.json();
    const data = body.data;

    expect(data.facility_groups).toHaveLength(1);
    const group = data.facility_groups[0];
    expect(group.facility_name).toBe('グリーンヒル');
    expect(group.total_count).toBe(2);
    expect(group.completed_count).toBe(1);
    expect(group.lane_counts).toEqual({ normal: 2, cold: 1, narcotic: 1 });
    expect(group.final_check_assignee).toBe('山田');

    const ogawa = group.rows.find(
      (row: { patient_id: string }) => row.patient_id === 'patient_ogawa',
    );
    expect(ogawa.status).toBe('completed');
    expect(ogawa.slots).toEqual({ morning: 'set', noon: 'set', evening: 'set' });
    expect(ogawa.assignee_label).toBe('鈴木(事務)');

    const nakamura = group.rows.find(
      (row: { patient_id: string }) => row.patient_id === 'patient_nakamura',
    );
    expect(nakamura.has_allergy).toBe(true);
    // 朝=全2日分セット済 / 昼=1日分のみ(・) / 夕=なし(—) → 進行中
    expect(nakamura.slots).toEqual({ morning: 'set', noon: 'partial', evening: 'none' });
    expect(nakamura.status).toBe('in_progress');

    expect(data.evidence.cart_map_count).toBe(1);
    expect(data.evidence.cold_storage_log_status).toBe('正常');
  });

  it('DrugMaster が麻薬扱いする未タグ行を麻薬レーンに分類する', async () => {
    visitScheduleFindManyMock.mockImplementation(() => {
      if (visitScheduleFindManyMock.mock.calls.length === 1) {
        return Promise.resolve([
          buildSchedule({
            id: 'visit_1',
            caseId: 'case_narcotic',
            patientId: 'patient_narcotic',
            patientName: '麻薬 太郎',
            room: '105',
          }),
        ]);
      }
      return Promise.resolve([]);
    });
    drugMasterFindManyMock.mockResolvedValue([{ yj_code: 'YJ_MASTER_NARCOTIC' }]);
    setPlanFindManyMock.mockResolvedValue([
      buildPlan({
        id: 'plan_narcotic',
        caseId: 'case_narcotic',
        slots: [
          {
            slot: 'morning',
            day: 1,
            lineId: 'line_master_narcotic',
            drugCode: 'YJ_MASTER_NARCOTIC',
          },
        ],
      }),
    ]);

    const res = await GET(createRequest('?scope=today'), { params: Promise.resolve({}) });
    const body = await res.json();
    const data = body.data;

    expect(drugMasterFindManyMock).toHaveBeenCalledWith({
      where: {
        yj_code: { in: ['YJ_MASTER_NARCOTIC'] },
        is_narcotic: true,
      },
      select: { yj_code: true },
    });
    expect(data.facility_groups[0].lane_counts).toEqual({
      normal: 0,
      cold: 0,
      narcotic: 1,
    });
  });

  it('調剤監査待ちサイクルを「工程待ちのセット」に出す(麻薬・冷所と担当文つき)', async () => {
    visitScheduleFindManyMock.mockImplementation(() => {
      if (visitScheduleFindManyMock.mock.calls.length === 1) {
        return Promise.resolve([
          buildSchedule({
            id: 'visit_1',
            caseId: 'case_tanaka',
            patientId: 'patient_tanaka',
            patientName: '田中 一郎',
            facility: null,
            time: new Date(2026, 5, 11, 14, 0),
          }),
        ]);
      }
      return Promise.resolve([]);
    });
    cycleFindManyMock.mockResolvedValue([
      {
        id: 'cycle_tanaka',
        case_id: 'case_tanaka',
        case_: { patient: { name: '田中 一郎' } },
        prescription_intakes: [
          {
            lines: [
              { packaging_instruction_tags: ['narcotic'] },
              { packaging_instruction_tags: ['cold_storage'] },
            ],
          },
        ],
      },
    ]);

    const res = await GET(createRequest(), { params: Promise.resolve({}) });
    const body = await res.json();
    const data = body.data;

    expect(data.pending_items).toHaveLength(1);
    const item = data.pending_items[0];
    expect(item.kind).toBe('audit_waiting');
    expect(item.badge_label).toBe('監査待ち');
    expect(item.title).toBe('田中 一郎 様 — 本日14:00 持参分');
    expect(item.subtitle).toContain('監査合格と同時にここへ自動で現れます。');
    expect(item.subtitle).toContain('麻薬・冷所のため山田が直接セットします。');
    expect(item.meta_label).toBe('所要15分');
    expect(item.action_href).toBe('/audit');
  });

  it('DrugMaster が麻薬扱いする監査待ち未タグ行を工程待ち文言に反映する', async () => {
    visitScheduleFindManyMock.mockImplementation(() => {
      if (visitScheduleFindManyMock.mock.calls.length === 1) {
        return Promise.resolve([
          buildSchedule({
            id: 'visit_1',
            caseId: 'case_master_narcotic',
            patientId: 'patient_master_narcotic',
            patientName: '佐藤 二郎',
            facility: null,
            time: new Date(2026, 5, 11, 16, 15),
          }),
        ]);
      }
      return Promise.resolve([]);
    });
    drugMasterFindManyMock.mockResolvedValue([{ yj_code: 'YJ_MASTER_NARCOTIC' }]);
    cycleFindManyMock.mockResolvedValue([
      {
        id: 'cycle_master_narcotic',
        case_id: 'case_master_narcotic',
        case_: { patient: { name: '佐藤 二郎' } },
        prescription_intakes: [
          {
            lines: [
              {
                drug_code: 'YJ_MASTER_NARCOTIC',
                packaging_instruction_tags: [],
              },
            ],
          },
        ],
      },
    ]);

    const res = await GET(createRequest(), { params: Promise.resolve({}) });
    const body = await res.json();
    const data = body.data;

    expect(data.pending_items).toHaveLength(1);
    expect(data.pending_items[0].subtitle).toContain('麻薬のため山田が直接セットします。');
  });

  it('DrugMaster が麻薬扱いする明日分の未タグ行を先行可タイトルに表示する', async () => {
    visitScheduleFindManyMock.mockImplementation(() => {
      if (visitScheduleFindManyMock.mock.calls.length === 1) {
        return Promise.resolve([]);
      }
      return Promise.resolve([
        {
          id: 'visit_tomorrow',
          case_: {
            patient: { id: 'patient_tomorrow', name: '明日 花子' },
            medication_cycles: [
              {
                prescription_intakes: [
                  {
                    lines: [
                      {
                        drug_code: 'YJ_MASTER_NARCOTIC',
                        packaging_instruction_tags: [],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ]);
    });
    drugMasterFindManyMock.mockResolvedValue([{ yj_code: 'YJ_MASTER_NARCOTIC' }]);

    const res = await GET(createRequest(), { params: Promise.resolve({}) });
    const body = await res.json();
    const data = body.data;

    expect(data.pending_items).toHaveLength(1);
    expect(data.pending_items[0]).toMatchObject({
      kind: 'preworkable',
      title: '明日 花子 様(麻薬)',
    });
  });

  it('不正な scope はバリデーションエラー', async () => {
    const res = await GET(createRequest('?scope=yesterday'), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
  });
});

describe('deriveSlotMarks / deriveRowStatus', () => {
  const basePlan = {
    target_period_start: new Date(2026, 5, 11),
    target_period_end: new Date(2026, 5, 11),
    audits: [] as Array<{ result: string }>,
    change_logs: [] as Array<{ changed_by: string | null }>,
  };

  it('プラン無し → 全スロット — / 着手前', () => {
    expect(deriveSlotMarks(null)).toEqual({ morning: 'none', noon: 'none', evening: 'none' });
    expect(deriveRowStatus(null)).toBe('waiting');
  });

  it('全スロット充足 → 監査待ち(薬剤師確認前)', () => {
    const plan = {
      ...basePlan,
      batches: [
        { line_id: 'l1', slot: 'morning', day_number: 1, packaging_instruction_tags_snapshot: [] },
        { line_id: 'l1', slot: 'noon', day_number: 1, packaging_instruction_tags_snapshot: [] },
        { line_id: 'l1', slot: 'evening', day_number: 1, packaging_instruction_tags_snapshot: [] },
      ],
    };
    expect(deriveRowStatus(plan)).toBe('quantity_check');
  });

  it.each([
    ['approved', 'completed'],
    ['partial_approved', 'partial_approved'],
    ['rejected', 'rejected'],
  ] as const)('最新監査 %s → %s', (result, status) => {
    const plan = {
      ...basePlan,
      audits: [{ result }],
      batches: [
        { line_id: 'l1', slot: 'morning', day_number: 1, packaging_instruction_tags_snapshot: [] },
      ],
    };
    expect(deriveRowStatus(plan)).toBe(status);
  });

  it('caps calendar matrix day generation defensively for oversized existing plans', () => {
    const matrix = buildCalendarMatrix({
      periodStart: new Date(2026, 3, 1),
      periodEnd: new Date(2026, 5, 30),
      lines: [
        {
          id: 'line_1',
          drug_name: 'アムロジピン錠5mg',
          dose: '1錠',
          frequency: '朝食後',
          unit: '錠',
        },
      ],
      batches: [],
    });

    expect(matrix.day_count).toBe(35);
    expect(matrix.rows[0].days).toHaveLength(35);
    expect(matrix.period_end).toBe('2026-05-05');
  });
});
