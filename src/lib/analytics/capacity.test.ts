import { describe, expect, it } from 'vitest';
import {
  buildAttentionItems,
  buildDispenseSetSummary,
  buildProcessRemaining,
  buildStaffCapacity,
  buildVisitSlotSummary,
  countAuditWaiting,
  findVisitSlotShortage,
  minutesOfDayLocal,
  shiftTimeToMinutes,
  visitTimeToMinutes,
} from './capacity';

describe('capacity time converters', () => {
  it('visitTimeToMinutes はローカル時刻として読む', () => {
    // ローカルコンストラクタで生成 → どの TZ でも 14:30
    expect(visitTimeToMinutes(new Date(2026, 5, 13, 14, 30))).toBe(14 * 60 + 30);
    expect(visitTimeToMinutes(null)).toBeNull();
  });

  it('shiftTimeToMinutes は UTC 時刻部分を読む(cockpit 規約)', () => {
    expect(shiftTimeToMinutes(new Date(Date.UTC(1970, 0, 1, 10, 0)))).toBe(600);
    expect(shiftTimeToMinutes(null)).toBeNull();
  });

  it('minutesOfDayLocal はローカル 0:00 からの分を返す', () => {
    expect(minutesOfDayLocal(new Date(2026, 5, 13, 9, 15))).toBe(555);
  });
});

describe('buildProcessRemaining', () => {
  it('overall_status を 6 工程バケットへ畳む', () => {
    const remaining = buildProcessRemaining({
      intake_received: 1,
      structuring: 2,
      inquiry_pending: 1,
      inquiry_resolved: 1,
      dispensed: 5,
      audit_pending: 1,
      ready_to_dispense: 1,
      dispensing: 1,
      audited: 2,
      setting: 1,
      set_audited: 2,
      visit_ready: 1,
      visit_completed: 1,
      reported: 9, // 算定(6 工程の外)
      on_hold: 3, // フロー外
    });

    expect(remaining).toEqual([
      { key: 'input', label: '入力', count: 3 },
      { key: 'confirm', label: '確認', count: 8 },
      { key: 'dispense', label: '調剤', count: 2 },
      { key: 'set', label: 'セット', count: 3 },
      { key: 'visit', label: '訪問', count: 3 },
      { key: 'report', label: '報告', count: 1 },
    ]);
  });

  it('countAuditWaiting は監査待ち(dispensed/audit_pending)のみ数える', () => {
    expect(countAuditWaiting({ dispensed: 5, audit_pending: 2, inquiry_pending: 9 })).toBe(7);
    expect(countAuditWaiting({})).toBe(0);
  });
});

describe('buildVisitSlotSummary / buildDispenseSetSummary', () => {
  it('訪問枠は完了/全体を数える', () => {
    expect(buildVisitSlotSummary(['completed', 'planned', 'ready', 'completed'])).toEqual({
      completed: 2,
      total: 4,
    });
    expect(buildVisitSlotSummary([])).toEqual({ completed: 0, total: 0 });
  });

  it('調剤・セットは未完了+本日完了+セット計画から組み立てる', () => {
    expect(
      buildDispenseSetSummary({
        dispenseOpenCount: 3,
        dispenseCompletedTodayCount: 6,
        setPlans: [
          { latestAuditResult: 'approved' },
          { latestAuditResult: 'approved' },
          { latestAuditResult: 'rejected' },
          { latestAuditResult: null },
        ],
      }),
    ).toEqual({ completed: 8, total: 13 });
  });
});

describe('buildStaffCapacity', () => {
  const nowMinutes = 10 * 60; // 10:00

  it('余白から稼働率・緊急余力・スタッフ別負荷を出す', () => {
    const summary = buildStaffCapacity(
      [
        {
          userId: 'u-yamada',
          name: '山田 太郎',
          role: 'owner',
          shift: null,
          visits: [
            { startMinutes: 14 * 60, endMinutes: 15 * 60 },
            { startMinutes: 15 * 60 + 30, endMinutes: 16 * 60 + 30 },
          ],
        },
        {
          userId: 'u-sato',
          name: '佐藤 恵',
          role: 'pharmacist',
          shift: null,
          visits: [{ startMinutes: 14 * 60 + 30, endMinutes: null }], // 終了未定 → 60分
        },
        {
          userId: 'u-suzuki',
          name: '鈴木 さくら',
          role: 'clerk',
          shift: null,
          visits: [],
        },
      ],
      nowMinutes,
    );

    // 山田: 勤務540 残り480 拘束120 → 余白360 → 負荷 (540-360)/540 = 33%
    // 佐藤: 余白 480-60=420 → 負荷 22% / 鈴木: 余白480 → 負荷 11%
    expect(summary.staffLoad).toEqual([
      { userId: 'u-yamada', label: '山田', loadPercent: 33 },
      { userId: 'u-sato', label: '佐藤', loadPercent: 22 },
      { userId: 'u-suzuki', label: '鈴木', loadPercent: 11 },
    ]);
    // 稼働率 = (1620 - 1260) / 1620 = 22%
    expect(summary.utilizationPercent).toBe(22);
    // 緊急余力 = 1260分 / 60 = 21.0件
    expect(summary.emergencyCapacityCount).toBe(21);
    expect(summary.workingPharmacistCount).toBe(2);
  });

  it('当日休みのメンバーは除外し、事務はバーの末尾に並べる', () => {
    const summary = buildStaffCapacity(
      [
        {
          userId: 'u-clerk',
          name: '鈴木 さくら',
          role: 'clerk',
          shift: null,
          visits: [],
        },
        {
          userId: 'u-off',
          name: '田中 真',
          role: 'clerk',
          shift: { available: false, fromMinutes: null, toMinutes: null },
          visits: [],
        },
        {
          userId: 'u-pharm',
          name: '山田 太郎',
          role: 'owner',
          shift: null,
          visits: [],
        },
      ],
      nowMinutes,
    );

    expect(summary.staffLoad.map((item) => item.userId)).toEqual(['u-pharm', 'u-clerk']);
    expect(summary.workingPharmacistCount).toBe(1);
  });

  it('シフトの勤務枠を尊重し、開始前は余白に数えない', () => {
    const summary = buildStaffCapacity(
      [
        {
          userId: 'u-late',
          name: '高橋 玲',
          role: 'pharmacist',
          // 13:00-17:00 勤務(まだ開始前)
          shift: { available: true, fromMinutes: 13 * 60, toMinutes: 17 * 60 },
          visits: [{ startMinutes: 13 * 60, endMinutes: 14 * 60 }],
        },
      ],
      nowMinutes,
    );

    // 勤務240 残り240 拘束60 → 余白180 → 負荷 (240-180)/240 = 25%
    expect(summary.staffLoad).toEqual([{ userId: 'u-late', label: '高橋', loadPercent: 25 }]);
    expect(summary.emergencyCapacityCount).toBe(3);
  });

  it('メンバー不在では稼働 0% / 余力 0 件', () => {
    expect(buildStaffCapacity([], nowMinutes)).toEqual({
      staffLoad: [],
      utilizationPercent: 0,
      emergencyCapacityCount: 0,
      workingPharmacistCount: 0,
      workingStaffCount: 0,
    });
  });
});

describe('findVisitSlotShortage', () => {
  it('需要が薬剤師数以上の時間帯を満枠として検出する(需要最大・同数は早い時間帯)', () => {
    const shortage = findVisitSlotShortage(
      [
        { startMinutes: 14 * 60, endMinutes: 15 * 60, facilityBatchId: null },
        { startMinutes: 14 * 60 + 30, endMinutes: 15 * 60 + 30, facilityBatchId: null },
        { startMinutes: 16 * 60, endMinutes: 17 * 60, facilityBatchId: null },
      ],
      2,
    );
    expect(shortage).toEqual({ startHour: 14, demand: 2 });
  });

  it('施設一括バッチは 1 訪問単位として数える', () => {
    const shortage = findVisitSlotShortage(
      [
        { startMinutes: 15 * 60, endMinutes: 16 * 60, facilityBatchId: 'batch-1' },
        { startMinutes: 15 * 60, endMinutes: 16 * 60, facilityBatchId: 'batch-1' },
        { startMinutes: 15 * 60, endMinutes: 16 * 60, facilityBatchId: 'batch-1' },
      ],
      2,
    );
    expect(shortage).toBeNull();
  });

  it('時刻未定の訪問と薬剤師 0 人は判定しない', () => {
    expect(
      findVisitSlotShortage([{ startMinutes: null, endMinutes: null, facilityBatchId: null }], 2),
    ).toBeNull();
    expect(
      findVisitSlotShortage(
        [{ startMinutes: 10 * 60, endMinutes: 11 * 60, facilityBatchId: null }],
        0,
      ),
    ).toBeNull();
  });
});

describe('buildAttentionItems', () => {
  const processRemaining = [
    { key: 'input' as const, label: '入力', count: 3 },
    { key: 'confirm' as const, label: '確認', count: 8 },
    { key: 'dispense' as const, label: '調剤', count: 2 },
    { key: 'set' as const, label: 'セット', count: 3 },
    { key: 'visit' as const, label: '訪問', count: 3 },
    { key: 'report' as const, label: '報告', count: 1 },
  ];

  it('最大工程・満枠時間帯・確認待ち・緊急余力の 4 件を導出する', () => {
    expect(
      buildAttentionItems({
        processRemaining,
        auditWaitingCount: 6,
        visitShortage: { startHour: 14, demand: 2 },
        emergencyCapacityCount: 3.2,
        workingStaffCount: 3,
      }),
    ).toEqual([
      '確認が8件で多め',
      '14〜15時の訪問枠が不足',
      '薬剤師確認待ちが6件たまっています',
      '緊急対応余力が3件を下回りそう',
    ]);
  });

  it('条件を満たさないルールは出さない(全件 0 は空)', () => {
    expect(
      buildAttentionItems({
        processRemaining: processRemaining.map((process) => ({ ...process, count: 0 })),
        auditWaitingCount: 0,
        visitShortage: null,
        emergencyCapacityCount: 12,
        workingStaffCount: 3,
      }),
    ).toEqual([]);
  });

  it('緊急余力が閾値以上なら注意に含めない', () => {
    const items = buildAttentionItems({
      processRemaining,
      auditWaitingCount: 2,
      visitShortage: null,
      emergencyCapacityCount: 4,
      workingStaffCount: 3,
    });
    expect(items).toEqual(['確認が8件で多め']);
  });

  it('勤務スタッフがいない 0 件の余力には警告を出さない', () => {
    const items = buildAttentionItems({
      processRemaining: processRemaining.map((process) => ({ ...process, count: 0 })),
      auditWaitingCount: 0,
      visitShortage: null,
      emergencyCapacityCount: 0,
      workingStaffCount: 0,
    });
    expect(items).toEqual([]);
  });
});
