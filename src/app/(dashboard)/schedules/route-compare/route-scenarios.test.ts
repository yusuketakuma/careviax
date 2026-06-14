import { describe, expect, it } from 'vitest';
import {
  buildRecommendedRouteDetail,
  buildRouteScenarios,
  buildScenarioChartPoints,
  buildScenarioRouteOrderUpdates,
  computeSpareVisitCapacity,
  describeScenarioOrder,
  orderByEmergencySlack,
  orderByMinTravel,
  orderByTimePreference,
  type RouteCompareVisitInput,
  type RouteOrderTarget,
} from './route-scenarios';

/** seed-design-demo の本日個人宅訪問 4 件を模した基本フィクスチャ */
function buildSeedLikeVisits(): RouteCompareVisitInput[] {
  return [
    {
      scheduleId: 'visit-tanaka',
      patientName: '田中 一郎',
      pharmacistId: 'user-yamada',
      startMinutes: 14 * 60,
      endMinutes: 14 * 60 + 30,
      priority: 'normal',
      routeOrder: null,
      proximityKey: null,
    },
    {
      scheduleId: 'visit-ito',
      patientName: '伊藤 キヨ',
      pharmacistId: 'user-yamada',
      startMinutes: 10 * 60 + 30,
      endMinutes: 11 * 60,
      priority: 'normal',
      routeOrder: null,
      proximityKey: null,
    },
    {
      scheduleId: 'visit-okada',
      patientName: '岡田 達也',
      pharmacistId: 'user-sato',
      startMinutes: 14 * 60 + 30,
      endMinutes: 15 * 60 + 30,
      priority: 'normal',
      routeOrder: null,
      proximityKey: null,
    },
    {
      scheduleId: 'visit-uchida',
      patientName: '内田 順子',
      pharmacistId: 'user-sato',
      startMinutes: 16 * 60,
      endMinutes: 17 * 60,
      priority: 'normal',
      routeOrder: null,
      proximityKey: null,
    },
  ];
}

describe('buildRouteScenarios', () => {
  it('案A/案B/案C を順に返し、案A のみ推奨になる', () => {
    const scenarios = buildRouteScenarios(buildSeedLikeVisits());

    expect(scenarios.map((scenario) => scenario.id)).toEqual([
      'min_travel',
      'time_preference',
      'emergency_slack',
    ]);
    expect(scenarios.map((scenario) => scenario.label)).toEqual([
      '案A 移動少なめ',
      '案B 希望時間優先',
      '案C 緊急余力優先',
    ]);
    expect(scenarios.map((scenario) => scenario.tone)).toEqual(['blue', 'emerald', 'amber']);
    expect(scenarios.map((scenario) => scenario.recommended)).toEqual([true, false, false]);
  });

  it('seed 相当 4 件で各案の移動分とサマリを近似計算する', () => {
    const [minTravel, timePreference, emergencySlack] = buildRouteScenarios(buildSeedLikeVisits());

    // 案A: 薬局往復 16*2 + 訪問間 20*3 = 92 分(詰めて回る)
    expect(minTravel.travelMinutes).toBe(92);
    // 詰めて回ると 10:30 開始 → 14:46 帰局。終業 18:00 までに 50 分単位で 3 件
    expect(minTravel.summary).toBe('移動92分 / 余力3件');

    // 案B: 伊藤→田中の空き 180 分 > 60 分のため帰局往復 32 分に置換
    // 16 + 32 + 20 + 20 + 16 = 104 分
    expect(timePreference.travelMinutes).toBe(104);
    expect(timePreference.summary).toBe('移動104分 / 患者希望一致');

    // 案C: 訪問間ごとに帰局 16 + 32*3 + 16 = 128 分
    expect(emergencySlack.travelMinutes).toBe(128);
    expect(emergencySlack.summary).toBe('移動128分 / 午後余力大');
  });

  it('全件時間指定なしの場合、案B のサマリは「時間指定なし」になる', () => {
    const visits = buildSeedLikeVisits().map((visit) => ({
      ...visit,
      startMinutes: null,
      endMinutes: null,
    }));
    const [, timePreference] = buildRouteScenarios(visits);
    expect(timePreference.summaryDetail).toBe('時間指定なし');
  });

  it('訪問 0 件では移動 0 分・stops 空で返す', () => {
    const scenarios = buildRouteScenarios([]);
    expect(scenarios).toHaveLength(3);
    for (const scenario of scenarios) {
      expect(scenario.stops).toEqual([]);
      expect(scenario.travelMinutes).toBe(0);
    }
  });
});

describe('orderByTimePreference', () => {
  it('希望時間の早い順に並び、時間未指定は末尾になる', () => {
    const visits = buildSeedLikeVisits();
    visits.push({
      scheduleId: 'visit-no-window',
      patientName: '時間 未定',
      pharmacistId: 'user-yamada',
      startMinutes: null,
      endMinutes: null,
      priority: 'normal',
      routeOrder: null,
      proximityKey: null,
    });

    const ordered = orderByTimePreference(visits);
    expect(ordered.map((visit) => visit.scheduleId)).toEqual([
      'visit-ito',
      'visit-tanaka',
      'visit-okada',
      'visit-uchida',
      'visit-no-window',
    ]);
  });

  it('同時刻は既存 route_order → 患者名で安定して並ぶ', () => {
    const base = buildSeedLikeVisits()[0];
    const ordered = orderByTimePreference([
      { ...base, scheduleId: 'b', patientName: 'い 患者', routeOrder: null },
      { ...base, scheduleId: 'a', patientName: 'あ 患者', routeOrder: null },
      { ...base, scheduleId: 'c', patientName: 'う 患者', routeOrder: 1 },
    ]);
    expect(ordered.map((visit) => visit.scheduleId)).toEqual(['c', 'a', 'b']);
  });
});

describe('orderByMinTravel', () => {
  it('同一建物(proximityKey が同じ)の訪問を連続配置し、移動分を短縮する', () => {
    const visits = buildSeedLikeVisits().map((visit) =>
      // 伊藤と内田を同じ建物にする(時間帯は離れている)
      visit.scheduleId === 'visit-ito' || visit.scheduleId === 'visit-uchida'
        ? { ...visit, proximityKey: 'building-1' }
        : visit,
    );

    const ordered = orderByMinTravel(visits);
    // 最早 10:30 を含む building-1 グループが先頭にまとまる
    expect(ordered.map((visit) => visit.scheduleId)).toEqual([
      'visit-ito',
      'visit-uchida',
      'visit-tanaka',
      'visit-okada',
    ]);

    const [minTravel] = buildRouteScenarios(visits);
    // 16*2 + 同一建物 5 + 20*2 = 77 分
    expect(minTravel.travelMinutes).toBe(77);
  });
});

describe('orderByEmergencySlack', () => {
  it('優先度の高い訪問(緊急 > 至急 > 通常)を前倒しする', () => {
    const visits = buildSeedLikeVisits().map((visit) => {
      if (visit.scheduleId === 'visit-uchida') return { ...visit, priority: 'emergency' as const };
      if (visit.scheduleId === 'visit-okada') return { ...visit, priority: 'urgent' as const };
      return visit;
    });

    const ordered = orderByEmergencySlack(visits);
    expect(ordered.map((visit) => visit.scheduleId)).toEqual([
      'visit-uchida',
      'visit-okada',
      'visit-ito',
      'visit-tanaka',
    ]);
  });
});

describe('computeSpareVisitCapacity', () => {
  it('開始時刻が全件未指定なら始業 9:00 起点で算出する', () => {
    const visits = buildSeedLikeVisits().map((visit) => ({
      ...visit,
      startMinutes: null,
      endMinutes: null,
    }));
    // 9:00 開始 → 訪問 30*4 + 移動 20*3 + 帰局 16 = 12:16 帰局。
    // 18:00 まで 344 分 → 50 分単位で 6 件
    expect(computeSpareVisitCapacity(orderByMinTravel(visits))).toBe(6);
  });

  it('終業を超える場合は 0 件になる', () => {
    const visits = buildSeedLikeVisits().map((visit) => ({
      ...visit,
      startMinutes: 17 * 60,
      endMinutes: 17 * 60 + 30,
    }));
    expect(computeSpareVisitCapacity(orderByTimePreference(visits))).toBe(0);
  });
});

describe('describeScenarioOrder', () => {
  it('「1 患者名 → 2 患者名」形式の訪問順テキストを作る', () => {
    const [, timePreference] = buildRouteScenarios(buildSeedLikeVisits());
    expect(describeScenarioOrder(timePreference.stops)).toBe(
      '1 伊藤 キヨ → 2 田中 一郎 → 3 岡田 達也 → 4 内田 順子',
    );
  });
});

describe('buildScenarioRouteOrderUpdates', () => {
  it('担当ごとに案の訪問順で 1 から振り直し、施設一括分は末尾に居室順で続ける', () => {
    const [, timePreference] = buildRouteScenarios(buildSeedLikeVisits());

    const allVisits: RouteOrderTarget[] = [
      // 比較対象の個人宅 4 件
      {
        scheduleId: 'visit-ito',
        pharmacistId: 'user-yamada',
        facilityBatchId: null,
        routeOrder: null,
        startMinutes: 10 * 60 + 30,
      },
      {
        scheduleId: 'visit-tanaka',
        pharmacistId: 'user-yamada',
        facilityBatchId: null,
        routeOrder: null,
        startMinutes: 14 * 60,
      },
      {
        scheduleId: 'visit-okada',
        pharmacistId: 'user-sato',
        facilityBatchId: null,
        routeOrder: null,
        startMinutes: 14 * 60 + 30,
      },
      {
        scheduleId: 'visit-uchida',
        pharmacistId: 'user-sato',
        facilityBatchId: null,
        routeOrder: null,
        startMinutes: 16 * 60,
      },
      // 比較対象外: 施設一括訪問 3 件(山田担当、既存の居室順 1..3)
      {
        scheduleId: 'visit-gh-nakamura',
        pharmacistId: 'user-yamada',
        facilityBatchId: 'batch-green-hill',
        routeOrder: 3,
        startMinutes: 15 * 60 + 30,
      },
      {
        scheduleId: 'visit-gh-ogawa',
        pharmacistId: 'user-yamada',
        facilityBatchId: 'batch-green-hill',
        routeOrder: 1,
        startMinutes: 15 * 60 + 30,
      },
      {
        scheduleId: 'visit-gh-yamaguchi',
        pharmacistId: 'user-yamada',
        facilityBatchId: 'batch-green-hill',
        routeOrder: 2,
        startMinutes: 15 * 60 + 30,
      },
    ];

    const updates = buildScenarioRouteOrderUpdates({ scenario: timePreference, allVisits });
    const orderByScheduleId = new Map(
      updates.map((update) => [update.scheduleId, update.route_order]),
    );

    // 山田: 案の順(伊藤→田中) 1,2 → 施設一括は居室順で 3,4,5
    expect(orderByScheduleId.get('visit-ito')).toBe(1);
    expect(orderByScheduleId.get('visit-tanaka')).toBe(2);
    expect(orderByScheduleId.get('visit-gh-ogawa')).toBe(3);
    expect(orderByScheduleId.get('visit-gh-yamaguchi')).toBe(4);
    expect(orderByScheduleId.get('visit-gh-nakamura')).toBe(5);

    // 佐藤: 案の順(岡田→内田) 1,2
    expect(orderByScheduleId.get('visit-okada')).toBe(1);
    expect(orderByScheduleId.get('visit-uchida')).toBe(2);

    // 担当×日付セル内で route_order が重複しない(reorder API の必須条件)
    expect(updates).toHaveLength(allVisits.length);
    const cellKeys = allVisits.map(
      (visit) => `${visit.pharmacistId}:${orderByScheduleId.get(visit.scheduleId)}`,
    );
    expect(new Set(cellKeys).size).toBe(cellKeys.length);
  });
});

describe('buildRecommendedRouteDetail', () => {
  it('推奨案(案A)を候補1、次点(案B)を候補2にした詳細を組み立てる', () => {
    const detail = buildRecommendedRouteDetail(buildSeedLikeVisits());
    expect(detail).not.toBeNull();
    if (!detail) return;

    // 主役は推奨案(案A 移動少なめ)
    expect(detail.recommendedScenarioId).toBe('min_travel');
    expect(detail.candidates).toHaveLength(2);

    const [candidate1, candidate2] = detail.candidates;
    expect(candidate1.rankLabel).toBe('候補1');
    expect(candidate1.recommended).toBe(true);
    // 案A: 移動92分 / 訪問は 30+30+60+60 = 180 分 / 余力3件
    expect(candidate1.summary).toBe('移動92分 / 訪問180分 / 余力3件');

    expect(candidate2.rankLabel).toBe('候補2');
    expect(candidate2.scenarioId).toBe('time_preference');
    expect(candidate2.recommended).toBe(false);
    expect(candidate2.summary.startsWith('移動104分 / 余力')).toBe(true);
  });

  it('訪問パケットは候補1の訪問順で番号・希望時間・所要分を持つ', () => {
    const detail = buildRecommendedRouteDetail(buildSeedLikeVisits());
    if (!detail) throw new Error('detail should not be null');

    expect(detail.stops.map((stop) => stop.order)).toEqual([1, 2, 3, 4]);
    // 案A は時間帯の早いグループから回るため伊藤(10:30)が先頭
    expect(detail.stops[0]).toMatchObject({
      patientName: '伊藤 キヨ',
      order: 1,
      timeWindowLabel: '10:30 - 11:00',
      durationMinutes: 30,
    });
  });

  it('守る条件は付帯情報(施設/正式決定/車両)とデータから充足を判定する', () => {
    const detail = buildRecommendedRouteDetail(buildSeedLikeVisits(), {
      hasConfirmedVisit: true,
      hasFacilityVisit: false,
      vehicleLabel: '車両A',
    });
    if (!detail) throw new Error('detail should not be null');

    const byId = new Map(detail.constraints.map((c) => [c.id, c]));
    // 希望時間ありの患者がいるので患者希望時間は充足
    expect(byId.get('patient_preferred_time')?.checked).toBe(true);
    // 施設訪問なし
    expect(byId.get('facility_reception_time')?.checked).toBe(false);
    // 正式決定済みあり
    expect(byId.get('keep_finalized_fixed')?.checked).toBe(true);
    // 車両ラベルがラベルに反映され充足
    expect(byId.get('assigned_vehicle')?.label).toBe('車両Aを使用');
    expect(byId.get('assigned_vehicle')?.checked).toBe(true);
    // 余力3件あるので緊急余力は充足
    expect(byId.get('emergency_slack')?.checked).toBe(true);
  });

  it('車両ラベル未指定なら担当車両ラベル・未充足になる', () => {
    const detail = buildRecommendedRouteDetail(buildSeedLikeVisits());
    if (!detail) throw new Error('detail should not be null');
    const vehicle = detail.constraints.find((c) => c.id === 'assigned_vehicle');
    expect(vehicle?.label).toBe('担当車両を使用');
    expect(vehicle?.checked).toBe(false);
  });

  it('訪問 0 件では null を返す', () => {
    expect(buildRecommendedRouteDetail([])).toBeNull();
  });
});

describe('buildScenarioChartPoints', () => {
  it('4 件で target と同じジグザグ(低→高→中→最高)を返す', () => {
    const points = buildScenarioChartPoints(4);
    expect(points).toHaveLength(4);
    expect(points.map((point) => point.y)).toEqual([0.82, 0.32, 0.57, 0.17]);
    // 横位置は左から右へ単調増加し 0..1 に収まる
    for (let index = 0; index < points.length; index += 1) {
      expect(points[index].x).toBeGreaterThan(0);
      expect(points[index].x).toBeLessThan(1);
      if (index > 0) expect(points[index].x).toBeGreaterThan(points[index - 1].x);
    }
  });

  it('1 件なら中央、0 件なら空配列を返す', () => {
    expect(buildScenarioChartPoints(1)).toEqual([{ x: 0.5, y: 0.5 }]);
    expect(buildScenarioChartPoints(0)).toEqual([]);
  });

  it('5 件以上はパターンを継続してジグザグを保つ', () => {
    const points = buildScenarioChartPoints(6);
    expect(points).toHaveLength(6);
    expect(points[4].y).toBe(0.62);
    expect(points[5].y).toBe(0.3);
  });
});
