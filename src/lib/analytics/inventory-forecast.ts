import { addUtcDays, localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { formatUtcDateKey } from '@/lib/date-key';

/**
 * p1_07「在庫と定期処方の予測」の集計純関数。
 * 来週(翌週月曜〜日曜)の訪問予定患者 × 直近処方の 1 日量から
 * 薬剤別の必要量見込みを作り、薬局在庫と突合して対応区分を決める。
 * Route Handler はハンドラ以外を export できないため route.ts から分離する。
 */

/** 必要量見込みの対象日数(来週 7 日分) */
export const FORECAST_DAYS = 7;
/** 要発注しきい値: 在庫 < 必要見込み × この比率 */
export const ORDER_REQUIRED_STOCK_RATIO = 0.5;

export type DrugForecastStatus = 'order_required' | 'order_candidate' | 'sufficient';

/** 対応バッジの表示ラベル(要発注=赤 / 発注候補=橙 / 余裕あり=中立) */
export const DRUG_FORECAST_STATUS_LABELS: Record<DrugForecastStatus, string> = {
  order_required: '要発注',
  order_candidate: '発注候補',
  sufficient: '余裕あり',
};

export type ForecastLineInput = {
  drugName: string;
  dose: string;
  frequency: string;
  days: number;
  quantity: number | null;
  unit: string | null;
};

export type ForecastIntakeInput = {
  patientId: string;
  prescribedDate: Date;
  createdAt: Date;
  lines: ForecastLineInput[];
};

export type ForecastVisitInput = {
  patientId: string;
  patientName: string;
  /** @db.Date(UTC 深夜)の訪問日 */
  scheduledDate: Date;
  facilityBatch: {
    id: string;
    facilityName: string;
    patientCount: number;
  } | null;
};

export type ForecastStockInput = {
  drugName: string;
  /** 五十音順ソート用のカナ名(DrugMaster.drug_name_kana) */
  drugNameKana: string | null;
  unit: string | null;
  stockQty: number | null;
};

export type DrugForecastRow = {
  /** 規格・剤形を除いた薬剤ベース名(表示キー) */
  drugKey: string;
  /** 来週 7 日分の必要量見込み(切り上げ整数) */
  requiredQty: number;
  /** 在庫数量(全拠点合算。未入力は 0) */
  stockQty: number;
  unit: string;
  status: DrugForecastStatus;
};

export type AffectedPatientCard = {
  /** patient:<id> または facility-batch:<id> */
  key: string;
  /** 「田中 一郎」「施設A 5名」など(敬称はクライアント側で付与) */
  label: string;
  /** 最初の来週訪問日(YYYY-MM-DD) */
  firstVisitDateKey: string;
  isFacilityBatch: boolean;
};

export type InventoryForecastSummary = {
  drugs: DrugForecastRow[];
  patients: AffectedPatientCard[];
};

export type InventoryForecastDecisionSummary = {
  orderRequiredCount: number;
  orderCandidateCount: number;
  shortageDrugCount: number;
  affectedPatientCount: number;
  priorityDrug: DrugForecastRow | null;
  nextAction: string;
};

export function coveragePercent(row: DrugForecastRow): number {
  if (row.requiredQty <= 0) return 100;
  return Math.round((row.stockQty / row.requiredQty) * 100);
}

export function summarizeInventoryForecast(args: {
  drugs: DrugForecastRow[];
  patients: AffectedPatientCard[];
}): InventoryForecastDecisionSummary {
  const orderRequired = args.drugs.filter((drug) => drug.status === 'order_required');
  const orderCandidate = args.drugs.filter((drug) => drug.status === 'order_candidate');
  const shortageDrugs = [...orderRequired, ...orderCandidate];
  const priorityDrug =
    shortageDrugs.sort((left, right) => {
      const statusPriority =
        Number(right.status === 'order_required') - Number(left.status === 'order_required');
      if (statusPriority !== 0) return statusPriority;
      return coveragePercent(left) - coveragePercent(right);
    })[0] ?? null;

  let nextAction = '定期処方更新後に再確認';
  if (priorityDrug?.status === 'order_required') {
    nextAction = `${priorityDrug.drugKey}を発注確認`;
  } else if (priorityDrug) {
    nextAction = `${priorityDrug.drugKey}の在庫確認`;
  }

  return {
    orderRequiredCount: orderRequired.length,
    orderCandidateCount: orderCandidate.length,
    shortageDrugCount: shortageDrugs.length,
    affectedPatientCount: args.patients.length,
    priorityDrug,
    nextAction,
  };
}

/**
 * 「来週」= ローカル日付基準の翌週月曜〜日曜。
 * @db.Date カラム比較用に UTC 深夜の半開区間 { gte, lt } で返す。
 */
export function nextWeekUtcRange(now: Date = new Date()): {
  gte: Date;
  lt: Date;
  startKey: string;
  endKey: string;
} {
  const todayUtc = utcDateFromLocalKey(localDateKey(now));
  const dayOfWeek = todayUtc.getUTCDay(); // 0=日〜6=土
  // 今日が月曜でも「翌週」の月曜まで進める(必ず 1〜7 日先)
  const daysToNextMonday = (8 - dayOfWeek) % 7 || 7;
  const gte = addUtcDays(todayUtc, daysToNextMonday);
  const lt = addUtcDays(gte, FORECAST_DAYS);
  return {
    gte,
    lt,
    startKey: formatUtcDateKey(gte),
    endKey: formatUtcDateKey(addUtcDays(gte, FORECAST_DAYS - 1)),
  };
}

/**
 * 規格・剤形サフィックスを除いた薬剤ベース名。
 * 「アムロジピン 5mg」→「アムロジピン」、「酸化Mg 330mg」→「酸化Mg」。
 */
export function drugBaseName(drugName: string): string {
  const head = drugName.trim().split(/[\s　]+/u)[0] ?? '';
  if (head.length === 0) return drugName.trim();
  // 空白なし表記(アムロジピン5mg)は数字以降を規格とみなして落とす
  const withoutStrength = head.replace(/[0-9０-９.．].*$/u, '');
  return withoutStrength.length > 0 ? withoutStrength : head;
}

/** 用法文字列から 1 日の服用回数を概算する(不明は 1 回)。 */
function frequencyPerDay(frequency: string): number {
  const explicit = frequency.match(/([0-9０-９]+)\s*回/u);
  if (explicit) {
    const count = Number(
      explicit[1].replace(/[０-９]/gu, (c) => String('０１２３４５６７８９'.indexOf(c))),
    );
    if (Number.isFinite(count) && count > 0) return count;
  }
  if (/毎食|朝昼夕|朝・昼・夕/u.test(frequency)) return 3;
  if (/朝夕|朝・夕|昼夕|朝昼/u.test(frequency)) return 2;
  return 1;
}

/**
 * 処方行から 1 日量を概算する。
 * 総量(quantity)と日数(days)が揃っていれば quantity / days を優先し、
 * 無ければ dose の先頭数値 × 用法回数で近似する。
 */
export function estimateDailyDose(line: ForecastLineInput): number {
  if (line.quantity != null && line.quantity > 0 && line.days > 0) {
    return line.quantity / line.days;
  }
  const doseMatch = line.dose.match(/([0-9]+(?:\.[0-9]+)?)/u);
  const doseValue = doseMatch ? Number(doseMatch[1]) : 1;
  return (doseValue > 0 ? doseValue : 1) * frequencyPerDay(line.frequency);
}

/** 患者ごとに最新(処方日 → 取込日時の降順)の処方取込 1 件の明細を選ぶ。 */
export function selectLatestLinesByPatient(
  intakes: ForecastIntakeInput[],
): Map<string, ForecastLineInput[]> {
  const latestByPatient = new Map<string, ForecastIntakeInput>();
  for (const intake of intakes) {
    const current = latestByPatient.get(intake.patientId);
    if (
      !current ||
      intake.prescribedDate.getTime() > current.prescribedDate.getTime() ||
      (intake.prescribedDate.getTime() === current.prescribedDate.getTime() &&
        intake.createdAt.getTime() > current.createdAt.getTime())
    ) {
      latestByPatient.set(intake.patientId, intake);
    }
  }
  return new Map(
    [...latestByPatient.entries()].map(([patientId, intake]) => [patientId, intake.lines]),
  );
}

/** FacilityVisitBatch.patient_ids(Json)から人数を安全に数える。 */
export function countFacilityPatients(patientIds: unknown): number {
  return Array.isArray(patientIds) ? patientIds.length : 0;
}

/** 対応区分: 要発注(在庫 < 見込み50%)/ 発注候補(在庫 < 見込み)/ 余裕あり。 */
export function classifyStockStatus(requiredQty: number, stockQty: number): DrugForecastStatus {
  if (stockQty < requiredQty * ORDER_REQUIRED_STOCK_RATIO) return 'order_required';
  if (stockQty < requiredQty) return 'order_candidate';
  return 'sufficient';
}

/**
 * 来週の訪問予定・直近処方・在庫から、薬剤別見込みと影響患者カードを作る。
 * - 左表: 在庫登録(is_stocked)がある薬剤のうち、来週の必要見込み > 0 のもの
 * - 右列: 不足側(要発注・発注候補)の薬剤を使う来週訪問予定の患者。
 *   施設一括訪問は「施設名 N名」(N = バッチの対象患者数)に集約する
 */
export function buildInventoryForecast(input: {
  visits: ForecastVisitInput[];
  intakes: ForecastIntakeInput[];
  stocks: ForecastStockInput[];
}): InventoryForecastSummary {
  const linesByPatient = selectLatestLinesByPatient(input.intakes);

  // 来週訪問のある患者(重複訪問は最初の日付のみ保持)
  const visitingPatients = new Map<string, ForecastVisitInput>();
  for (const visit of [...input.visits].sort(
    (a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime(),
  )) {
    if (!visitingPatients.has(visit.patientId)) {
      visitingPatients.set(visit.patientId, visit);
    }
  }

  // 薬剤ベース名ごとの必要量見込み(1日量 × 7日 × 該当患者ぶんの合算)
  const requiredByDrug = new Map<string, { requiredQty: number; unit: string | null }>();
  for (const patientId of visitingPatients.keys()) {
    const lines = linesByPatient.get(patientId) ?? [];
    for (const line of lines) {
      const key = drugBaseName(line.drugName);
      if (key.length === 0) continue;
      const entry = requiredByDrug.get(key) ?? { requiredQty: 0, unit: null };
      entry.requiredQty += estimateDailyDose(line) * FORECAST_DAYS;
      entry.unit = entry.unit ?? line.unit;
      requiredByDrug.set(key, entry);
    }
  }

  // 在庫(同一ベース名は全拠点・全規格を合算)
  const stockByDrug = new Map<
    string,
    { stockQty: number; unit: string | null; nameKana: string | null }
  >();
  for (const stock of input.stocks) {
    const key = drugBaseName(stock.drugName);
    if (key.length === 0) continue;
    const entry = stockByDrug.get(key) ?? { stockQty: 0, unit: null, nameKana: null };
    entry.stockQty += stock.stockQty ?? 0;
    entry.unit = entry.unit ?? stock.unit;
    entry.nameKana = entry.nameKana ?? stock.drugNameKana;
    stockByDrug.set(key, entry);
  }

  const drugs: DrugForecastRow[] = [...requiredByDrug.entries()]
    .filter(([key, entry]) => entry.requiredQty > 0 && stockByDrug.has(key))
    .map(([key, entry]) => {
      const stock = stockByDrug.get(key)!;
      const requiredQty = Math.ceil(entry.requiredQty);
      const row: DrugForecastRow = {
        drugKey: key,
        requiredQty,
        stockQty: stock.stockQty,
        unit: entry.unit ?? stock.unit ?? '錠',
        status: classifyStockStatus(requiredQty, stock.stockQty),
      };
      return { sortKana: stock.nameKana ?? key, row };
    })
    // 五十音順(カナ名があればカナで)
    .sort((a, b) => a.sortKana.localeCompare(b.sortKana, 'ja'))
    .map((item) => item.row);

  const shortageDrugKeys = new Set(
    drugs.filter((drug) => drug.status !== 'sufficient').map((drug) => drug.drugKey),
  );

  const usesShortageDrug = (patientId: string): boolean =>
    (linesByPatient.get(patientId) ?? []).some((line) =>
      shortageDrugKeys.has(drugBaseName(line.drugName)),
    );

  // 影響する患者さん: 個人はそのまま、施設バッチは 1 カードに集約
  const cardsByKey = new Map<string, AffectedPatientCard>();
  for (const visit of visitingPatients.values()) {
    if (!usesShortageDrug(visit.patientId)) continue;
    if (visit.facilityBatch) {
      const key = `facility-batch:${visit.facilityBatch.id}`;
      if (!cardsByKey.has(key)) {
        cardsByKey.set(key, {
          key,
          label: `${visit.facilityBatch.facilityName} ${visit.facilityBatch.patientCount}名`,
          firstVisitDateKey: formatUtcDateKey(visit.scheduledDate),
          isFacilityBatch: true,
        });
      }
      continue;
    }
    const key = `patient:${visit.patientId}`;
    if (!cardsByKey.has(key)) {
      cardsByKey.set(key, {
        key,
        label: visit.patientName,
        firstVisitDateKey: formatUtcDateKey(visit.scheduledDate),
        isFacilityBatch: false,
      });
    }
  }

  const patients = [...cardsByKey.values()].sort(
    (a, b) =>
      a.firstVisitDateKey.localeCompare(b.firstVisitDateKey) ||
      a.label.localeCompare(b.label, 'ja'),
  );

  return { drugs, patients };
}
