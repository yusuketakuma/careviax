import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  cycleGroupByMock,
  visitScheduleFindManyMock,
  dispenseTaskCountMock,
  setPlanFindManyMock,
  membershipFindManyMock,
  shiftFindManyMock,
} = vi.hoisted(() => ({
  cycleGroupByMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  dispenseTaskCountMock: vi.fn(),
  setPlanFindManyMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  shiftFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: 'admin' },
      routeContext: { params: Promise<Record<string, string>> },
    ) => Promise<Response>,
  ) => {
    return (req: NextRequest, routeContext: { params: Promise<Record<string, string>> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'admin' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    medicationCycle: { groupBy: cycleGroupByMock },
    visitSchedule: { findMany: visitScheduleFindManyMock },
    dispenseTask: { count: dispenseTaskCountMock },
    setPlan: { findMany: setPlanFindManyMock },
    membership: { findMany: membershipFindManyMock },
    pharmacistShift: { findMany: shiftFindManyMock },
  },
}));

import { GET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const routeGET = (req: NextRequest) => GET(req, emptyRouteContext);

// ローカル 2026-06-13 10:00(TZ に依存しないようローカルコンストラクタで固定)
const fixedNow = new Date(2026, 5, 13, 10, 0, 0);

function timeOfDay(hours: number, minutes: number): Date {
  return new Date(Date.UTC(2026, 5, 13, hours, minutes, 0));
}

describe('/api/admin/capacity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('KPI・行程残・スタッフ負荷・注意点を集計して返す', async () => {
    cycleGroupByMock.mockResolvedValue([
      { overall_status: 'intake_received', _count: { id: 1 } },
      { overall_status: 'dispensed', _count: { id: 5 } },
      { overall_status: 'audit_pending', _count: { id: 1 } },
      { overall_status: 'ready_to_dispense', _count: { id: 2 } },
      { overall_status: 'audited', _count: { id: 2 } },
      { overall_status: 'set_audited', _count: { id: 3 } },
      { overall_status: 'visit_completed', _count: { id: 1 } },
      { overall_status: 'reported', _count: { id: 4 } }, // 算定(6 工程の外)
    ]);
    visitScheduleFindManyMock.mockResolvedValue([
      // 午前に完了済み 2 件(時間未定)
      {
        schedule_status: 'completed',
        pharmacist_id: 'user_yamada',
        time_window_start: null,
        time_window_end: null,
        facility_batch_id: null,
      },
      {
        schedule_status: 'completed',
        pharmacist_id: 'user_sato',
        time_window_start: null,
        time_window_end: null,
        facility_batch_id: null,
      },
      // 14時台が満枠(薬剤師 2 名に対し 2 単位)
      {
        schedule_status: 'planned',
        pharmacist_id: 'user_yamada',
        time_window_start: timeOfDay(14, 0),
        time_window_end: timeOfDay(15, 0),
        facility_batch_id: null,
      },
      {
        schedule_status: 'planned',
        pharmacist_id: 'user_sato',
        time_window_start: timeOfDay(14, 30),
        time_window_end: timeOfDay(15, 30),
        facility_batch_id: null,
      },
      // 施設一括(同一バッチ 2 行 = 1 訪問単位)
      {
        schedule_status: 'planned',
        pharmacist_id: 'user_yamada',
        time_window_start: timeOfDay(15, 30),
        time_window_end: timeOfDay(16, 30),
        facility_batch_id: 'batch_gh',
      },
      {
        schedule_status: 'planned',
        pharmacist_id: 'user_yamada',
        time_window_start: timeOfDay(15, 30),
        time_window_end: timeOfDay(16, 30),
        facility_batch_id: 'batch_gh',
      },
    ]);
    dispenseTaskCountMock
      .mockResolvedValueOnce(3) // 未完了(pending/in_progress)
      .mockResolvedValueOnce(6); // 本日完了
    setPlanFindManyMock.mockResolvedValue([
      { audits: [{ result: 'approved' }] },
      { audits: [{ result: 'approved' }] },
      { audits: [{ result: 'rejected' }] },
      { audits: [] },
    ]);
    membershipFindManyMock.mockResolvedValue([
      { user_id: 'user_yamada', role: 'owner', user: { name: '山田 太郎' } },
      { user_id: 'user_sato', role: 'pharmacist', user: { name: '佐藤 恵' } },
      { user_id: 'user_suzuki', role: 'clerk', user: { name: '鈴木 さくら' } },
      { user_id: 'user_tanaka', role: 'clerk', user: { name: '田中 真' } },
    ]);
    shiftFindManyMock.mockResolvedValue([
      // 田中(事務)は当日休み → 集計から除外
      { user_id: 'user_tanaka', available: false, available_from: null, available_to: null },
    ]);

    const response = (await routeGET(new NextRequest('http://localhost/api/admin/capacity')))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        generated_at: fixedNow.toISOString(),
        kpis: {
          visit_slots: { completed: 2, total: 6 },
          // 調剤 6/9(未完了3+本日完了6)+ セット 2/4(最新監査が承認)
          dispense_set: { completed: 8, total: 13 },
          // 山田: 余白300 / 佐藤: 420 / 鈴木: 480 → (1620-1200)/1620 = 26%
          staff_utilization_percent: 26,
          // 余白合計 1200分 ÷ 60分 = 20件
          emergency_capacity_count: 20,
        },
        process_remaining: [
          { key: 'input', label: '入力', count: 1 },
          { key: 'confirm', label: '確認', count: 6 },
          { key: 'dispense', label: '調剤', count: 2 },
          { key: 'set', label: 'セット', count: 2 },
          { key: 'visit', label: '訪問', count: 3 },
          { key: 'report', label: '報告', count: 1 },
        ],
        staff_load: [
          { user_id: 'user_yamada', label: '山田', load_percent: 44 },
          { user_id: 'user_sato', label: '佐藤', load_percent: 22 },
          { user_id: 'user_suzuki', label: '鈴木', load_percent: 11 },
        ],
        attention_items: [
          '確認が6件で多め',
          '14〜15時の訪問枠が不足',
          '薬剤師確認待ちが6件たまっています',
        ],
      },
    });

    // cancelled サイクルは集計から除外していること
    expect(cycleGroupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { org_id: 'org_1', overall_status: { notIn: ['cancelled'] } },
      }),
    );
    // 本日レンジ(@db.Date 境界)+ キャンセル/再調整除外で照会していること
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          scheduled_date: {
            gte: new Date('2026-06-13T00:00:00.000Z'),
            lt: new Date('2026-06-14T00:00:00.000Z'),
          },
          schedule_status: { notIn: ['cancelled', 'rescheduled'] },
        },
      }),
    );
    // 調剤タスクは未完了全件と本日完了の 2 カウント
    expect(dispenseTaskCountMock).toHaveBeenNthCalledWith(1, {
      where: { org_id: 'org_1', status: { in: ['pending', 'in_progress'] } },
    });
    expect(dispenseTaskCountMock).toHaveBeenNthCalledWith(2, {
      where: {
        org_id: 'org_1',
        status: 'completed',
        updated_at: {
          gte: new Date('2026-06-12T15:00:00.000Z'),
          lt: new Date('2026-06-13T15:00:00.000Z'),
        },
      },
    });
    // セット計画は今日と対象期間が重なるものだけを数え、古い履歴や取消サイクルを混ぜない。
    expect(setPlanFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        target_period_start: { lt: new Date('2026-06-14T00:00:00.000Z') },
        target_period_end: { gte: new Date('2026-06-13T00:00:00.000Z') },
        cycle: { overall_status: { not: 'cancelled' } },
      },
      select: {
        audits: {
          orderBy: { audited_at: 'desc' },
          take: 1,
          select: { result: true },
        },
      },
    });
    // 当日シフトは @db.Date 境界で照会していること
    expect(shiftFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          date: {
            gte: new Date('2026-06-13T00:00:00.000Z'),
            lt: new Date('2026-06-14T00:00:00.000Z'),
          },
        },
      }),
    );
  });

  it('データが無い組織では 0 件サマリを返す', async () => {
    cycleGroupByMock.mockResolvedValue([]);
    visitScheduleFindManyMock.mockResolvedValue([]);
    dispenseTaskCountMock.mockResolvedValue(0);
    setPlanFindManyMock.mockResolvedValue([]);
    membershipFindManyMock.mockResolvedValue([]);
    shiftFindManyMock.mockResolvedValue([]);

    const response = (await routeGET(new NextRequest('http://localhost/api/admin/capacity')))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        generated_at: fixedNow.toISOString(),
        kpis: {
          visit_slots: { completed: 0, total: 0 },
          dispense_set: { completed: 0, total: 0 },
          staff_utilization_percent: 0,
          emergency_capacity_count: 0,
        },
        process_remaining: [
          { key: 'input', label: '入力', count: 0 },
          { key: 'confirm', label: '確認', count: 0 },
          { key: 'dispense', label: '調剤', count: 0 },
          { key: 'set', label: 'セット', count: 0 },
          { key: 'visit', label: '訪問', count: 0 },
          { key: 'report', label: '報告', count: 0 },
        ],
        staff_load: [],
        attention_items: [],
      },
    });
  });

  it('DateTime の本日完了件数は JST 業務日レンジで数え、@db.Date レンジと混同しない', async () => {
    vi.setSystemTime(new Date('2026-06-11T15:30:00.000Z')); // JST 2026-06-12 00:30
    cycleGroupByMock.mockResolvedValue([]);
    visitScheduleFindManyMock.mockResolvedValue([]);
    dispenseTaskCountMock.mockResolvedValue(0);
    setPlanFindManyMock.mockResolvedValue([]);
    membershipFindManyMock.mockResolvedValue([]);
    shiftFindManyMock.mockResolvedValue([]);

    const response = (await routeGET(new NextRequest('http://localhost/api/admin/capacity')))!;

    expect(response.status).toBe(200);
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scheduled_date: {
            gte: new Date('2026-06-12T00:00:00.000Z'),
            lt: new Date('2026-06-13T00:00:00.000Z'),
          },
        }),
      }),
    );
    expect(dispenseTaskCountMock).toHaveBeenNthCalledWith(2, {
      where: {
        org_id: 'org_1',
        status: 'completed',
        updated_at: {
          gte: new Date('2026-06-11T15:00:00.000Z'),
          lt: new Date('2026-06-12T15:00:00.000Z'),
        },
      },
    });
    expect(setPlanFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          target_period_start: { lt: new Date('2026-06-13T00:00:00.000Z') },
          target_period_end: { gte: new Date('2026-06-12T00:00:00.000Z') },
        }),
      }),
    );
    expect(shiftFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: {
            gte: new Date('2026-06-12T00:00:00.000Z'),
            lt: new Date('2026-06-13T00:00:00.000Z'),
          },
        }),
      }),
    );
  });
});
