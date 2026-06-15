import type { VisitPriority } from '../day-view.shared';

/**
 * p1_12「ルート案を比べる」: 本日の訪問予定から並べ替え戦略の異なる 3 案を合成する純関数群。
 *
 * 移動時間は外部地図 API を使わない定数近似(薬局⇔訪問先 16 分 / 訪問先間 20 分 /
 * 同一建物内 5 分)で算出する。地理的な正確さではなく、案ごとの方針差
 * (詰めて回る / 希望時間どおりに回る / 帰局を挟んで緊急余力を残す)を比較できることを目的とする。
 */

/** 薬局⇔訪問先の片道移動の近似(分) */
export const PHARMACY_LEG_MINUTES = 16;
/** 訪問先間の移動の近似(分) */
export const BASE_LEG_MINUTES = 20;
/** 同一建物・同一施設内の移動の近似(分) */
export const SAME_PLACE_LEG_MINUTES = 5;
/** 希望時間どおりに回る場合、これ以上の空きが出たら一度帰局するとみなす閾値(分) */
export const IDLE_RETURN_THRESHOLD_MINUTES = 60;
/** 時間帯未指定の訪問 1 件の所要時間の近似(分) */
export const DEFAULT_VISIT_MINUTES = 30;
/** 終業時刻(0 時からの分)。余力件数の算出に使う */
export const WORK_END_MINUTES = 18 * 60;
/** 開始時刻が全件未指定のときに使う始業時刻(0 時からの分) */
export const DEFAULT_DAY_START_MINUTES = 9 * 60;
/** 臨時訪問 1 件の受け入れに必要な時間の近似(訪問 30 分+移動 20 分) */
export const SLACK_UNIT_MINUTES = DEFAULT_VISIT_MINUTES + BASE_LEG_MINUTES;

export type RouteScenarioId = 'min_travel' | 'time_preference' | 'emergency_slack';

export type RouteScenarioTone = 'blue' | 'emerald' | 'amber';

/** 比較対象 1 訪問分の入力。時刻は 0 時からの分(time_window が無い場合は null) */
export type RouteCompareVisitInput = {
  scheduleId: string;
  patientName: string;
  pharmacistId: string;
  startMinutes: number | null;
  endMinutes: number | null;
  priority: VisitPriority;
  routeOrder: number | null;
  /** 近接グループキー(同一建物など)。同じキーの訪問は連続配置される */
  proximityKey: string | null;
};

export type RouteScenarioStop = {
  scheduleId: string;
  patientName: string;
  pharmacistId: string;
  /** 1 始まりの訪問順 */
  order: number;
};

export type RouteScenario = {
  id: RouteScenarioId;
  /** 例: 案A 移動少なめ */
  label: string;
  /** 例: 案A */
  shortLabel: string;
  /** 例: 移動少なめ */
  strategyLabel: string;
  tone: RouteScenarioTone;
  /** 推奨案(主操作を強調する)かどうか */
  recommended: boolean;
  stops: RouteScenarioStop[];
  travelMinutes: number;
  /** 例: 余力2件 / 患者希望一致 / 午後余力大 */
  summaryDetail: string;
  /** 例: 移動92分 / 余力2件 */
  summary: string;
  /** 確認ダイアログなどで使う方針説明 */
  description: string;
};

export type RouteScenarioComparisonRow = {
  scenarioId: RouteScenarioId;
  travelMinutes: number;
  travelDeltaMinutes: number;
  stopCount: number;
  summaryDetail: string;
  decisionLabel: string;
};

const PRIORITY_WEIGHT: Record<VisitPriority, number> = {
  emergency: 2,
  urgent: 1,
  normal: 0,
};

const UNSET_ORDER_VALUE = Number.MAX_SAFE_INTEGER;

function compareNullableNumber(left: number | null, right: number | null) {
  return (left ?? UNSET_ORDER_VALUE) - (right ?? UNSET_ORDER_VALUE);
}

/** 希望時間 → 既存 route_order → 患者名 → ID の安定順 */
function compareByTimePreference(left: RouteCompareVisitInput, right: RouteCompareVisitInput) {
  return (
    compareNullableNumber(left.startMinutes, right.startMinutes) ||
    compareNullableNumber(left.routeOrder, right.routeOrder) ||
    left.patientName.localeCompare(right.patientName, 'ja') ||
    left.scheduleId.localeCompare(right.scheduleId)
  );
}

/** 訪問 1 件の所要時間(分)。時間帯が無い・不正な場合は既定値 */
function visitDurationMinutes(visit: RouteCompareVisitInput) {
  if (visit.startMinutes != null && visit.endMinutes != null) {
    const duration = visit.endMinutes - visit.startMinutes;
    if (duration > 0) return duration;
  }
  return DEFAULT_VISIT_MINUTES;
}

function isSamePlace(left: RouteCompareVisitInput, right: RouteCompareVisitInput) {
  return (
    left.proximityKey != null &&
    right.proximityKey != null &&
    left.proximityKey === right.proximityKey
  );
}

/** 訪問先間の基本レッグ(同一建物なら短縮) */
function interVisitLegMinutes(left: RouteCompareVisitInput, right: RouteCompareVisitInput) {
  return isSamePlace(left, right) ? SAME_PLACE_LEG_MINUTES : BASE_LEG_MINUTES;
}

/** 案A: 同一建物をまとめ、時間帯の早いグループから回る並び(移動最少の近似) */
export function orderByMinTravel(visits: RouteCompareVisitInput[]): RouteCompareVisitInput[] {
  const groups = new Map<string, RouteCompareVisitInput[]>();
  for (const visit of visits) {
    const key = visit.proximityKey ?? `single:${visit.scheduleId}`;
    const members = groups.get(key);
    if (members) {
      members.push(visit);
    } else {
      groups.set(key, [visit]);
    }
  }

  const orderedGroups = Array.from(groups.values()).map((members) =>
    [...members].sort(
      (left, right) =>
        compareNullableNumber(left.routeOrder, right.routeOrder) ||
        compareByTimePreference(left, right),
    ),
  );
  orderedGroups.sort((leftMembers, rightMembers) => {
    const leftEarliest = Math.min(
      ...leftMembers.map((visit) => visit.startMinutes ?? UNSET_ORDER_VALUE),
    );
    const rightEarliest = Math.min(
      ...rightMembers.map((visit) => visit.startMinutes ?? UNSET_ORDER_VALUE),
    );
    return (
      leftEarliest - rightEarliest ||
      leftMembers[0].patientName.localeCompare(rightMembers[0].patientName, 'ja') ||
      leftMembers[0].scheduleId.localeCompare(rightMembers[0].scheduleId)
    );
  });

  return orderedGroups.flat();
}

/** 案B: 患者の希望時間帯どおりの並び */
export function orderByTimePreference(visits: RouteCompareVisitInput[]): RouteCompareVisitInput[] {
  return [...visits].sort(compareByTimePreference);
}

/** 案C: 優先度の高い訪問から前倒しで回る並び */
export function orderByEmergencySlack(visits: RouteCompareVisitInput[]): RouteCompareVisitInput[] {
  return [...visits].sort(
    (left, right) =>
      PRIORITY_WEIGHT[right.priority] - PRIORITY_WEIGHT[left.priority] ||
      compareByTimePreference(left, right),
  );
}

/** 案A の移動分: 薬局発着+訪問間を空き時間なしで詰めて回る */
export function computeCompressedTravelMinutes(ordered: RouteCompareVisitInput[]) {
  if (ordered.length === 0) return 0;
  let total = PHARMACY_LEG_MINUTES * 2;
  for (let index = 0; index < ordered.length - 1; index += 1) {
    total += interVisitLegMinutes(ordered[index], ordered[index + 1]);
  }
  return total;
}

/** 案B の移動分: 希望時間どおりに回り、空きが閾値を超えるレッグは一度帰局(往復)する */
export function computeTimePreferenceTravelMinutes(ordered: RouteCompareVisitInput[]) {
  if (ordered.length === 0) return 0;
  let total = PHARMACY_LEG_MINUTES * 2;
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const current = ordered[index];
    const next = ordered[index + 1];
    if (isSamePlace(current, next)) {
      total += SAME_PLACE_LEG_MINUTES;
      continue;
    }
    const idleGap =
      current.startMinutes != null && next.startMinutes != null
        ? next.startMinutes - (current.startMinutes + visitDurationMinutes(current))
        : 0;
    total += idleGap > IDLE_RETURN_THRESHOLD_MINUTES ? PHARMACY_LEG_MINUTES * 2 : BASE_LEG_MINUTES;
  }
  return total;
}

/** 案C の移動分: 緊急対応に備え、訪問の合間ごとに薬局近くへ戻る(同一建物は除く) */
export function computeEmergencySlackTravelMinutes(ordered: RouteCompareVisitInput[]) {
  if (ordered.length === 0) return 0;
  let total = PHARMACY_LEG_MINUTES * 2;
  for (let index = 0; index < ordered.length - 1; index += 1) {
    total += isSamePlace(ordered[index], ordered[index + 1])
      ? SAME_PLACE_LEG_MINUTES
      : PHARMACY_LEG_MINUTES * 2;
  }
  return total;
}

/**
 * 案A の余力件数: 詰めて回った場合の帰局時刻から終業までに、
 * 臨時訪問(訪問+移動の近似 50 分)を何件受けられるか。
 */
export function computeSpareVisitCapacity(ordered: RouteCompareVisitInput[]) {
  if (ordered.length === 0) return 0;
  let clock = ordered[0].startMinutes ?? DEFAULT_DAY_START_MINUTES;
  for (let index = 0; index < ordered.length; index += 1) {
    clock += visitDurationMinutes(ordered[index]);
    if (index < ordered.length - 1) {
      clock += interVisitLegMinutes(ordered[index], ordered[index + 1]);
    }
  }
  clock += PHARMACY_LEG_MINUTES;
  return Math.max(0, Math.floor((WORK_END_MINUTES - clock) / SLACK_UNIT_MINUTES));
}

function toStops(ordered: RouteCompareVisitInput[]): RouteScenarioStop[] {
  return ordered.map((visit, index) => ({
    scheduleId: visit.scheduleId,
    patientName: visit.patientName,
    pharmacistId: visit.pharmacistId,
    order: index + 1,
  }));
}

/** 「1 患者名 → 2 患者名 …」形式の訪問順テキスト(確認ダイアログ・読み上げ用) */
export function describeScenarioOrder(stops: RouteScenarioStop[]) {
  return stops.map((stop) => `${stop.order} ${stop.patientName}`).join(' → ');
}

/** 本日の訪問予定から比較用の 3 案(案A 移動少なめ / 案B 希望時間優先 / 案C 緊急余力優先)を合成する */
export function buildRouteScenarios(visits: RouteCompareVisitInput[]): RouteScenario[] {
  const minTravelOrder = orderByMinTravel(visits);
  const timePreferenceOrder = orderByTimePreference(visits);
  const emergencySlackOrder = orderByEmergencySlack(visits);

  const minTravelMinutes = computeCompressedTravelMinutes(minTravelOrder);
  const timePreferenceMinutes = computeTimePreferenceTravelMinutes(timePreferenceOrder);
  const emergencySlackMinutes = computeEmergencySlackTravelMinutes(emergencySlackOrder);

  const spareCapacity = computeSpareVisitCapacity(minTravelOrder);
  const hasTimeWindow = visits.some((visit) => visit.startMinutes != null);

  const minTravelDetail = `余力${spareCapacity}件`;
  const timePreferenceDetail = hasTimeWindow ? '患者希望一致' : '時間指定なし';
  const emergencySlackDetail = '午後余力大';

  return [
    {
      id: 'min_travel',
      label: '案A 移動少なめ',
      shortLabel: '案A',
      strategyLabel: '移動少なめ',
      tone: 'blue',
      recommended: true,
      stops: toStops(minTravelOrder),
      travelMinutes: minTravelMinutes,
      summaryDetail: minTravelDetail,
      summary: `移動${minTravelMinutes}分 / ${minTravelDetail}`,
      description:
        '同じ建物の訪問をまとめ、訪問間の空きを詰めて移動を最小化する案です。希望時間帯より効率を優先します。',
    },
    {
      id: 'time_preference',
      label: '案B 希望時間優先',
      shortLabel: '案B',
      strategyLabel: '希望時間優先',
      tone: 'emerald',
      recommended: false,
      stops: toStops(timePreferenceOrder),
      travelMinutes: timePreferenceMinutes,
      summaryDetail: timePreferenceDetail,
      summary: `移動${timePreferenceMinutes}分 / ${timePreferenceDetail}`,
      description:
        '患者の希望時間帯どおりに回る案です。空き時間が長い場合は一度帰局するため移動は増えます。',
    },
    {
      id: 'emergency_slack',
      label: '案C 緊急余力優先',
      shortLabel: '案C',
      strategyLabel: '緊急余力優先',
      tone: 'amber',
      recommended: false,
      stops: toStops(emergencySlackOrder),
      travelMinutes: emergencySlackMinutes,
      summaryDetail: emergencySlackDetail,
      summary: `移動${emergencySlackMinutes}分 / ${emergencySlackDetail}`,
      description:
        '優先度の高い訪問から前倒しで回り、訪問の合間は薬局近くへ戻って緊急対応の余力を最大化する案です。',
    },
  ];
}

export function buildRouteScenarioComparisonRows(
  scenarios: RouteScenario[],
): RouteScenarioComparisonRow[] {
  const recommended = scenarios.find((scenario) => scenario.recommended) ?? scenarios[0] ?? null;
  const baselineTravelMinutes = recommended?.travelMinutes ?? 0;

  return scenarios.map((scenario) => {
    const travelDeltaMinutes = Math.max(0, scenario.travelMinutes - baselineTravelMinutes);
    return {
      scenarioId: scenario.id,
      travelMinutes: scenario.travelMinutes,
      travelDeltaMinutes,
      stopCount: scenario.stops.length,
      summaryDetail: scenario.summaryDetail,
      decisionLabel: scenario.recommended
        ? '推奨案'
        : travelDeltaMinutes > 0
          ? `推奨案より+${travelDeltaMinutes}分`
          : '推奨案と同等',
    };
  });
}

/** route_order 更新対象(比較対象外の施設一括訪問も含む本日の有効な訪問予定) */
export type RouteOrderTarget = {
  scheduleId: string;
  pharmacistId: string;
  facilityBatchId: string | null;
  routeOrder: number | null;
  startMinutes: number | null;
};

export type RouteOrderUpdate = {
  scheduleId: string;
  route_order: number;
};

/**
 * 案の採用時に送る route_order 更新を組み立てる。
 * route_order は担当薬剤師×日付のセル内で一意になる必要があるため、担当ごとに
 * 「案の訪問順 → 比較対象外(施設一括など)は現在の居室順のまま末尾」の順で 1 から振り直す。
 */
export function buildScenarioRouteOrderUpdates(args: {
  scenario: Pick<RouteScenario, 'stops'>;
  allVisits: RouteOrderTarget[];
}): RouteOrderUpdate[] {
  const stopRank = new Map(args.scenario.stops.map((stop, index) => [stop.scheduleId, index]));

  const byPharmacist = new Map<string, RouteOrderTarget[]>();
  for (const visit of args.allVisits) {
    const members = byPharmacist.get(visit.pharmacistId);
    if (members) {
      members.push(visit);
    } else {
      byPharmacist.set(visit.pharmacistId, [visit]);
    }
  }

  const updates: RouteOrderUpdate[] = [];
  for (const visits of byPharmacist.values()) {
    const inScenario = visits
      .filter((visit) => stopRank.has(visit.scheduleId))
      .sort(
        (left, right) =>
          (stopRank.get(left.scheduleId) ?? 0) - (stopRank.get(right.scheduleId) ?? 0),
      );
    const excluded = visits
      .filter((visit) => !stopRank.has(visit.scheduleId))
      .sort(
        (left, right) =>
          (left.facilityBatchId ?? '').localeCompare(right.facilityBatchId ?? '') ||
          compareNullableNumber(left.routeOrder, right.routeOrder) ||
          compareNullableNumber(left.startMinutes, right.startMinutes) ||
          left.scheduleId.localeCompare(right.scheduleId),
      );
    [...inScenario, ...excluded].forEach((visit, index) => {
      updates.push({ scheduleId: visit.scheduleId, route_order: index + 1 });
    });
  }
  return updates;
}

/**
 * p0_21「ルート最適化詳細 + 守る条件」: 3 案比較とは別に、推奨案 1 本を主役にした詳細ビュー
 * (順番付きの訪問パケット + 候補1/候補2 サマリー + 守る条件チェックリスト)を組み立てる純関数群。
 * 余力・移動の算出は上の buildRouteScenarios の結果をそのまま再利用する。
 */

/** 詳細ビューの「訪問パケット」1 行分。希望時間の有無と所要分を持つ */
export type RouteDetailStop = {
  scheduleId: string;
  patientName: string;
  /** 1 始まりの訪問順 */
  order: number;
  /** 希望時間帯がある場合の表示用ラベル(例: 10:30 - 11:00)。無ければ null */
  timeWindowLabel: string | null;
  /** 訪問 1 件の所要時間の近似(分) */
  durationMinutes: number;
};

/** 候補1/候補2 のサマリー行。recommended が候補1(主役) */
export type RouteDetailCandidate = {
  scenarioId: RouteScenarioId;
  /** 例: 候補1 / 候補2 */
  rankLabel: string;
  /** 移動分 */
  travelMinutes: number;
  /** 全訪問の所要分合計 */
  visitMinutes: number;
  /** 余力件数 */
  spareCount: number;
  recommended: boolean;
  /** 例: 移動92分 / 訪問130分 / 余力2件(候補1) または 移動105分 / 余力1件(候補2) */
  summary: string;
};

/** 守る条件チェックリスト 1 項目。満たしていれば checked */
export type RouteDetailConstraint = {
  id: string;
  label: string;
  checked: boolean;
};

/** 推奨案 1 本を主役にした詳細ビューのモデル */
export type RouteDetail = {
  /** 主役(候補1)の案 ID */
  recommendedScenarioId: RouteScenarioId;
  stops: RouteDetailStop[];
  /** 主役チャート用(候補1 の訪問順) */
  chartStops: RouteScenarioStop[];
  /** 候補1(主役)・候補2(次点)のサマリー */
  candidates: RouteDetailCandidate[];
  constraints: RouteDetailConstraint[];
};

/** 訪問予定の付帯情報(守る条件の判定に使う任意フラグ)。未指定でも詳細は組み立てられる */
export type RouteDetailVisitMeta = {
  /** 正式決定済み(confirmed_at あり)の訪問が含まれるか */
  hasConfirmedVisit?: boolean;
  /** 冷所品など要冷蔵の持参物がある訪問が含まれるか */
  hasColdChainItem?: boolean;
  /** 使用車両のラベル(例: 車両A)。割当があれば表示する */
  vehicleLabel?: string | null;
  /** 施設一括訪問(受付時間の制約あり)が本日含まれるか */
  hasFacilityVisit?: boolean;
};

/** 全訪問の所要分合計(訪問時間のみ。移動は含まない) */
function totalVisitMinutes(visits: RouteCompareVisitInput[]) {
  return visits.reduce((sum, visit) => sum + visitDurationMinutes(visit), 0);
}

function toDetailStops(ordered: RouteCompareVisitInput[]): RouteDetailStop[] {
  return ordered.map((visit, index) => ({
    scheduleId: visit.scheduleId,
    patientName: visit.patientName,
    order: index + 1,
    timeWindowLabel:
      visit.startMinutes != null ? formatMinutesRange(visit.startMinutes, visit.endMinutes) : null,
    durationMinutes: visitDurationMinutes(visit),
  }));
}

/** 0 時からの分を HH:mm に整形(終了が無ければ開始のみ) */
function formatMinutesRange(startMinutes: number, endMinutes: number | null): string {
  const left = formatMinutesOfDay(startMinutes);
  if (endMinutes == null || endMinutes <= startMinutes) return left;
  return `${left} - ${formatMinutesOfDay(endMinutes)}`;
}

function formatMinutesOfDay(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * 推奨案(候補1)を主役にした詳細ビューを組み立てる。
 * 候補1 は buildRouteScenarios の推奨案(案A 移動少なめ)、候補2 はその次点(案B 希望時間優先)。
 * 移動・余力・並び順はすべて既存の scenario 計算を再利用する。
 */
export function buildRecommendedRouteDetail(
  visits: RouteCompareVisitInput[],
  meta: RouteDetailVisitMeta = {},
): RouteDetail | null {
  if (visits.length === 0) return null;

  const scenarios = buildRouteScenarios(visits);
  const recommended = scenarios.find((scenario) => scenario.recommended) ?? scenarios[0];
  const runnerUp = scenarios.find((scenario) => scenario.id !== recommended.id) ?? null;

  // 訪問パケットは候補1(主役)の並び順を再利用する
  const orderedById = new Map(visits.map((visit) => [visit.scheduleId, visit]));
  const orderedVisits = recommended.stops
    .map((stop) => orderedById.get(stop.scheduleId))
    .filter((visit): visit is RouteCompareVisitInput => visit != null);

  const recommendedSpare = computeSpareVisitCapacity(orderedVisits);
  const visitTotal = totalVisitMinutes(orderedVisits);

  const candidates: RouteDetailCandidate[] = [];
  candidates.push({
    scenarioId: recommended.id,
    rankLabel: '候補1',
    travelMinutes: recommended.travelMinutes,
    visitMinutes: visitTotal,
    spareCount: recommendedSpare,
    recommended: true,
    summary: `移動${recommended.travelMinutes}分 / 訪問${visitTotal}分 / 余力${recommendedSpare}件`,
  });
  if (runnerUp) {
    const runnerUpVisits = runnerUp.stops
      .map((stop) => orderedById.get(stop.scheduleId))
      .filter((visit): visit is RouteCompareVisitInput => visit != null);
    const runnerUpSpare = computeSpareVisitCapacity(runnerUpVisits);
    candidates.push({
      scenarioId: runnerUp.id,
      rankLabel: '候補2',
      travelMinutes: runnerUp.travelMinutes,
      visitMinutes: totalVisitMinutes(runnerUpVisits),
      spareCount: runnerUpSpare,
      recommended: false,
      summary: `移動${runnerUp.travelMinutes}分 / 余力${runnerUpSpare}件`,
    });
  }

  const hasTimeWindow = visits.some((visit) => visit.startMinutes != null);

  const constraints: RouteDetailConstraint[] = [
    {
      id: 'patient_preferred_time',
      label: '患者希望時間を守る',
      checked: hasTimeWindow,
    },
    {
      id: 'facility_reception_time',
      label: '施設の受付時間を守る',
      checked: meta.hasFacilityVisit ?? false,
    },
    {
      id: 'keep_finalized_fixed',
      label: '正式決定済みは動かさない',
      checked: meta.hasConfirmedVisit ?? false,
    },
    {
      id: 'cold_chain',
      label: '冷所品を温度管理する',
      checked: meta.hasColdChainItem ?? false,
    },
    {
      id: 'assigned_vehicle',
      label: meta.vehicleLabel ? `${meta.vehicleLabel}を使用` : '担当車両を使用',
      checked: Boolean(meta.vehicleLabel),
    },
    {
      id: 'emergency_slack',
      label: '緊急対応余力を残す',
      checked: recommendedSpare > 0,
    },
  ];

  return {
    recommendedScenarioId: recommended.id,
    stops: toDetailStops(orderedVisits),
    chartStops: recommended.stops,
    candidates,
    constraints,
  };
}

export type ScenarioChartPoint = {
  /** 0..1 の横位置 */
  x: number;
  /** 0..1 の縦位置 */
  y: number;
};

const CHART_X_START_RATIO = 0.1;
const CHART_X_END_RATIO = 0.88;
/** target の折れ線形状(1 低 → 2 高 → 3 中 → 4 最高)に合わせた模式ジグザグ */
const CHART_ZIGZAG_Y_RATIOS = [0.82, 0.32, 0.57, 0.17] as const;

/**
 * 訪問件数分のノード座標(比率)を返す。折れ線は地理を表す地図ではなく、
 * 訪問順 1→n の進行を示す模式図のため、固定のジグザグパターンを使う。
 */
export function buildScenarioChartPoints(count: number): ScenarioChartPoint[] {
  if (count <= 0) return [];
  if (count === 1) return [{ x: 0.5, y: 0.5 }];
  const step = (CHART_X_END_RATIO - CHART_X_START_RATIO) / (count - 1);
  return Array.from({ length: count }, (_, index) => ({
    x: CHART_X_START_RATIO + step * index,
    y:
      index < CHART_ZIGZAG_Y_RATIOS.length
        ? CHART_ZIGZAG_Y_RATIOS[index]
        : index % 2 === 0
          ? 0.62
          : 0.3,
  }));
}
