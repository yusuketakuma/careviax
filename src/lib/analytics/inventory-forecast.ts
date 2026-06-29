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

export type UnresolvedDrugForecastReason = 'missing_code' | 'code_not_found' | 'ambiguous_code';

export type DrugResolutionStatus = 'resolved' | UnresolvedDrugForecastReason;

/** 対応バッジの表示ラベル(要発注=赤 / 発注候補=橙 / 余裕あり=中立) */
export const DRUG_FORECAST_STATUS_LABELS: Record<DrugForecastStatus, string> = {
  order_required: '要発注',
  order_candidate: '発注候補',
  sufficient: '余裕あり',
};

export type ForecastLineInput = {
  drugName: string;
  drugCode?: string | null;
  drugMasterId?: string | null;
  drugResolutionStatus?: DrugResolutionStatus;
  dose: string;
  frequency: string;
  days: number;
  quantity: number | null;
  unit: string | null;
  startDate: Date | null;
  endDate: Date | null;
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
  drugCode?: string | null;
  drugMasterId?: string | null;
  /** 五十音順ソート用のカナ名(DrugMaster.drug_name_kana) */
  drugNameKana: string | null;
  unit: string | null;
  stockQty: number | null;
};

export type DrugForecastRow = {
  /** 内部集計キー。master:<DrugMaster.id> を優先し、次に code:<YJ/receipt/HOT> を使う。 */
  drugIdentityKey: string;
  /** YJコード。未解決名フォールバックでは null。 */
  drugCode: string | null;
  /** 規格・剤形を除いた薬剤ベース名(表示キー) */
  drugKey: string;
  /** 来週 7 日分の必要量見込み(切り上げ整数) */
  requiredQty: number;
  /** 在庫数量(全拠点合算。未入力は 0) */
  stockQty: number;
  unit: string;
  status: DrugForecastStatus;
};

export type UnresolvedDrugForecastRow = {
  drugIdentityKey: string;
  drugCode: string | null;
  reason: UnresolvedDrugForecastReason;
  drugKey: string;
  requiredQty: number;
  unit: string;
  affectedPatientCount: number;
};

export type InventoryForecastRunOutBasis =
  | 'line_end_date'
  | 'line_start_date_plus_days'
  | 'unknown';

export type InventoryForecastUrgency = 'critical' | 'warning' | 'normal' | 'unknown';

export type PatientDrugShortageDetail = {
  drugIdentityKey: string;
  drugCode: string | null;
  drugKey: string;
  requiredQty: number;
  stockQty: number;
  unit: string;
  status: Exclude<DrugForecastStatus, 'sufficient'>;
  affectedPatientCount: number;
  runOutDateKey: string | null;
  runOutBasis: InventoryForecastRunOutBasis;
  urgency: InventoryForecastUrgency;
};

export type AffectedPatientCard = {
  /** patient:<id> または facility-batch:<id> */
  key: string;
  /** 施設バッチ集約の場合は null */
  patientId: string | null;
  /** 「田中 一郎」「施設A 5名」など(敬称はクライアント側で付与) */
  label: string;
  /** 最初の来週訪問日(YYYY-MM-DD) */
  firstVisitDateKey: string;
  isFacilityBatch: boolean;
  /** 施設バッチ全体の人数。個人カードは null。 */
  facilityPatientCount: number | null;
  /** このカードで不足薬根拠がある患者数。施設バッチでは全体人数と異なることがある。 */
  shortagePatientCount: number;
  /** 直近処方明細を取得でき、このカードの不足判定に使った患者数。 */
  dataBackedPatientCount: number;
  /** 不足側の薬剤ベース名。施設バッチでは対象患者の不足薬を集約する。 */
  shortageDrugKeys: string[];
  /** 対象不足薬のうち最も早い服用終了見込み日。施設バッチでは最短値。 */
  runOutDateKey: string | null;
  runOutBasis: InventoryForecastRunOutBasis;
  /** 最短服用終了見込み日と初回訪問日から導く表示用緊急度。 */
  urgency: InventoryForecastUrgency;
  shortageDetails: PatientDrugShortageDetail[];
};

export type InventoryForecastSummary = {
  drugs: DrugForecastRow[];
  patients: AffectedPatientCard[];
  unresolvedDrugs: UnresolvedDrugForecastRow[];
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

function isValidDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function compareNullableDateKeys(left: string | null, right: string | null): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left.localeCompare(right);
}

export function resolveLineRunOut(input: {
  line: Pick<ForecastLineInput, 'days' | 'startDate' | 'endDate'>;
}): {
  runOutDateKey: string | null;
  basis: InventoryForecastRunOutBasis;
} {
  if (isValidDate(input.line.endDate)) {
    return { runOutDateKey: formatUtcDateKey(input.line.endDate), basis: 'line_end_date' };
  }

  if (input.line.days > 0 && isValidDate(input.line.startDate)) {
    const startDateKey = formatUtcDateKey(input.line.startDate);
    const runOutDate = addUtcDays(utcDateFromLocalKey(startDateKey), input.line.days - 1);
    return {
      runOutDateKey: formatUtcDateKey(runOutDate),
      basis: 'line_start_date_plus_days',
    };
  }

  return { runOutDateKey: null, basis: 'unknown' };
}

export function resolveInventoryForecastUrgency(input: {
  runOutDateKey: string | null;
  firstVisitDateKey: string;
}): InventoryForecastUrgency {
  if (input.runOutDateKey == null) return 'unknown';
  if (input.runOutDateKey <= input.firstVisitDateKey) return 'critical';
  const warningUntil = formatUtcDateKey(
    addUtcDays(utcDateFromLocalKey(input.firstVisitDateKey), FORECAST_DAYS),
  );
  return input.runOutDateKey <= warningUntil ? 'warning' : 'normal';
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

function normalizeDrugCode(code?: string | null): string | null {
  return code?.trim() || null;
}

function normalizeDrugMasterId(id?: string | null): string | null {
  return id?.trim() || null;
}

function forecastDrugIdentity(input: {
  drugName: string;
  drugCode?: string | null;
  drugMasterId?: string | null;
  drugResolutionStatus?: DrugResolutionStatus;
}): {
  identityKey: string;
  drugCode: string | null;
  drugKey: string;
  isResolved: boolean;
  unresolvedReason: UnresolvedDrugForecastReason | null;
} {
  const drugMasterId = normalizeDrugMasterId(input.drugMasterId);
  const drugCode = normalizeDrugCode(input.drugCode);
  const drugKey = drugBaseName(input.drugName);
  const status = input.drugResolutionStatus;
  const codeIsResolved = status == null || status === 'resolved';
  const isResolved = Boolean(drugMasterId || (drugCode && codeIsResolved));
  const unresolvedReason: UnresolvedDrugForecastReason | null = isResolved
    ? null
    : status === 'code_not_found' || status === 'ambiguous_code'
      ? status
      : 'missing_code';
  return {
    identityKey: drugMasterId
      ? `master:${drugMasterId}`
      : isResolved && drugCode
        ? `code:${drugCode}`
        : '',
    drugCode,
    drugKey,
    isResolved,
    unresolvedReason,
  };
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

/** 患者ごとに最新(処方日 → 取込日時の降順)の処方取込 1 件を選ぶ。 */
export function selectLatestIntakeByPatient(
  intakes: ForecastIntakeInput[],
): Map<string, ForecastIntakeInput> {
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
  return latestByPatient;
}

/** 患者ごとに最新(処方日 → 取込日時の降順)の処方取込 1 件の明細を選ぶ。 */
export function selectLatestLinesByPatient(
  intakes: ForecastIntakeInput[],
): Map<string, ForecastLineInput[]> {
  const latestByPatient = selectLatestIntakeByPatient(intakes);
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

function shortageStatusPriority(status: Exclude<DrugForecastStatus, 'sufficient'>): number {
  return status === 'order_required' ? 0 : 1;
}

function urgencyPriority(urgency: InventoryForecastUrgency): number {
  switch (urgency) {
    case 'critical':
      return 0;
    case 'warning':
      return 1;
    case 'normal':
      return 2;
    case 'unknown':
      return 3;
  }
}

function sortShortageDetails(details: PatientDrugShortageDetail[]): PatientDrugShortageDetail[] {
  return [...details].sort(
    (left, right) =>
      shortageStatusPriority(left.status) - shortageStatusPriority(right.status) ||
      urgencyPriority(left.urgency) - urgencyPriority(right.urgency) ||
      compareNullableDateKeys(left.runOutDateKey, right.runOutDateKey) ||
      left.drugKey.localeCompare(right.drugKey, 'ja') ||
      left.drugIdentityKey.localeCompare(right.drugIdentityKey),
  );
}

function summarizeShortageDetails(
  details: PatientDrugShortageDetail[],
): Pick<
  AffectedPatientCard,
  'shortageDrugKeys' | 'runOutDateKey' | 'runOutBasis' | 'urgency' | 'shortageDetails'
> {
  const sortedDetails = sortShortageDetails(details);
  const earliestRunOut =
    [...sortedDetails]
      .filter((detail) => detail.runOutDateKey != null)
      .sort((left, right) => compareNullableDateKeys(left.runOutDateKey, right.runOutDateKey))[0] ??
    null;
  const highestUrgency = [...sortedDetails].sort(
    (left, right) => urgencyPriority(left.urgency) - urgencyPriority(right.urgency),
  )[0];

  return {
    shortageDrugKeys: sortedDetails.map((detail) => detail.drugKey),
    runOutDateKey: earliestRunOut?.runOutDateKey ?? null,
    runOutBasis: earliestRunOut?.runOutBasis ?? 'unknown',
    urgency: highestUrgency?.urgency ?? 'unknown',
    shortageDetails: sortedDetails,
  };
}

function mergeShortageDetails(
  existing: PatientDrugShortageDetail[],
  incoming: PatientDrugShortageDetail[],
): PatientDrugShortageDetail[] {
  const detailsByDrug = new Map<string, PatientDrugShortageDetail>();

  for (const detail of [...existing, ...incoming]) {
    const current = detailsByDrug.get(detail.drugIdentityKey);
    if (!current) {
      detailsByDrug.set(detail.drugIdentityKey, { ...detail });
      continue;
    }

    const useIncomingRunOut =
      compareNullableDateKeys(detail.runOutDateKey, current.runOutDateKey) < 0;
    detailsByDrug.set(detail.drugIdentityKey, {
      ...current,
      requiredQty: current.requiredQty + detail.requiredQty,
      affectedPatientCount: current.affectedPatientCount + detail.affectedPatientCount,
      status:
        shortageStatusPriority(detail.status) < shortageStatusPriority(current.status)
          ? detail.status
          : current.status,
      runOutDateKey: useIncomingRunOut ? detail.runOutDateKey : current.runOutDateKey,
      runOutBasis: useIncomingRunOut ? detail.runOutBasis : current.runOutBasis,
      urgency:
        urgencyPriority(detail.urgency) < urgencyPriority(current.urgency)
          ? detail.urgency
          : current.urgency,
    });
  }

  return sortShortageDetails([...detailsByDrug.values()]);
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
  const latestIntakeByPatient = selectLatestIntakeByPatient(input.intakes);
  const linesByPatient = new Map(
    [...latestIntakeByPatient.entries()].map(([patientId, intake]) => [patientId, intake.lines]),
  );

  // 来週訪問のある患者(重複訪問は最初の日付のみ保持)
  const visitingPatients = new Map<string, ForecastVisitInput>();
  for (const visit of [...input.visits].sort(
    (a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime(),
  )) {
    if (!visitingPatients.has(visit.patientId)) {
      visitingPatients.set(visit.patientId, visit);
    }
  }

  // 解決済み薬剤コードごとの必要量見込み(1日量 × 7日 × 該当患者ぶんの合算)
  const requiredByDrug = new Map<
    string,
    { drugKey: string; drugCode: string | null; requiredQty: number; unit: string | null }
  >();
  const unresolvedByDrug = new Map<
    string,
    {
      drugIdentityKey: string;
      drugCode: string | null;
      reason: UnresolvedDrugForecastReason;
      drugKey: string;
      requiredQty: number;
      unit: string;
      patientIds: Set<string>;
    }
  >();
  for (const patientId of visitingPatients.keys()) {
    const lines = linesByPatient.get(patientId) ?? [];
    for (const line of lines) {
      const identity = forecastDrugIdentity(line);
      if (identity.drugKey.length === 0) continue;
      if (!identity.isResolved) {
        const unresolvedReason = identity.unresolvedReason ?? 'missing_code';
        const unresolvedKey = identity.drugCode
          ? `unresolved-code:${identity.drugCode}`
          : `unresolved-name:${identity.drugKey}`;
        const entry = unresolvedByDrug.get(unresolvedKey) ?? {
          drugIdentityKey: unresolvedKey,
          drugCode: identity.drugCode,
          reason: unresolvedReason,
          drugKey: identity.drugKey,
          requiredQty: 0,
          unit: line.unit ?? '錠',
          patientIds: new Set<string>(),
        };
        entry.requiredQty += estimateDailyDose(line) * FORECAST_DAYS;
        entry.patientIds.add(patientId);
        unresolvedByDrug.set(unresolvedKey, entry);
        continue;
      }
      const entry = requiredByDrug.get(identity.identityKey) ?? {
        drugKey: identity.drugKey,
        drugCode: identity.drugCode,
        requiredQty: 0,
        unit: null,
      };
      entry.requiredQty += estimateDailyDose(line) * FORECAST_DAYS;
      entry.unit = entry.unit ?? line.unit;
      requiredByDrug.set(identity.identityKey, entry);
    }
  }

  // 在庫(同一 DrugMaster / コードは全拠点合算。未解決名では自動突合しない)
  const stockByDrug = new Map<
    string,
    {
      drugKey: string;
      drugCode: string | null;
      stockQty: number;
      unit: string | null;
      nameKana: string | null;
    }
  >();
  for (const stock of input.stocks) {
    const identity = forecastDrugIdentity(stock);
    if (identity.drugKey.length === 0 || !identity.isResolved) continue;
    const entry = stockByDrug.get(identity.identityKey) ?? {
      drugKey: identity.drugKey,
      drugCode: identity.drugCode,
      stockQty: 0,
      unit: null,
      nameKana: null,
    };
    entry.stockQty += stock.stockQty ?? 0;
    entry.unit = entry.unit ?? stock.unit;
    entry.nameKana = entry.nameKana ?? stock.drugNameKana;
    stockByDrug.set(identity.identityKey, entry);
  }

  const drugs: DrugForecastRow[] = [...requiredByDrug.entries()]
    .filter(([key, entry]) => entry.requiredQty > 0 && stockByDrug.has(key))
    .map(([key, entry]) => {
      const stock = stockByDrug.get(key)!;
      const requiredQty = Math.ceil(entry.requiredQty);
      const row: DrugForecastRow = {
        drugIdentityKey: key,
        drugCode: entry.drugCode ?? stock.drugCode,
        drugKey: entry.drugKey,
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

  const shortageDrugIdentityKeys = new Set(
    drugs.filter((drug) => drug.status !== 'sufficient').map((drug) => drug.drugIdentityKey),
  );
  const shortageRowsByDrug = new Map(
    drugs
      .filter(
        (drug): drug is DrugForecastRow & { status: Exclude<DrugForecastStatus, 'sufficient'> } =>
          drug.status !== 'sufficient',
      )
      .map((drug) => [drug.drugIdentityKey, drug]),
  );

  const usesShortageDrug = (patientId: string): boolean =>
    (linesByPatient.get(patientId) ?? []).some((line) => {
      const identity = forecastDrugIdentity(line);
      if (!identity.isResolved) return false;
      return shortageDrugIdentityKeys.has(identity.identityKey);
    });

  const shortageDetailsForPatient = (
    patientId: string,
    firstVisitDateKey: string,
  ): PatientDrugShortageDetail[] => {
    const intake = latestIntakeByPatient.get(patientId);
    if (!intake) return [];

    const detailAccumulators = new Map<
      string,
      Omit<PatientDrugShortageDetail, 'requiredQty'> & { requiredQty: number }
    >();

    for (const line of intake.lines) {
      const identity = forecastDrugIdentity(line);
      if (!identity.isResolved) continue;
      const shortageRow = shortageRowsByDrug.get(identity.identityKey);
      if (!shortageRow) continue;

      const dailyQty = estimateDailyDose(line);
      const runOut = resolveLineRunOut({ line });
      const current = detailAccumulators.get(identity.identityKey);
      const useIncomingRunOut =
        current == null || compareNullableDateKeys(runOut.runOutDateKey, current.runOutDateKey) < 0;
      const baseDetail = current ?? {
        drugIdentityKey: identity.identityKey,
        drugCode: identity.drugCode ?? shortageRow.drugCode,
        drugKey: identity.drugKey,
        requiredQty: 0,
        stockQty: shortageRow.stockQty,
        unit: line.unit ?? shortageRow.unit,
        status: shortageRow.status,
        affectedPatientCount: 1,
        runOutDateKey: runOut.runOutDateKey,
        runOutBasis: runOut.basis,
        urgency: resolveInventoryForecastUrgency({
          runOutDateKey: runOut.runOutDateKey,
          firstVisitDateKey,
        }),
      };

      detailAccumulators.set(identity.identityKey, {
        ...baseDetail,
        requiredQty: baseDetail.requiredQty + dailyQty * FORECAST_DAYS,
        runOutDateKey: useIncomingRunOut ? runOut.runOutDateKey : baseDetail.runOutDateKey,
        runOutBasis: useIncomingRunOut ? runOut.basis : baseDetail.runOutBasis,
        urgency: useIncomingRunOut
          ? resolveInventoryForecastUrgency({
              runOutDateKey: runOut.runOutDateKey,
              firstVisitDateKey,
            })
          : baseDetail.urgency,
      });
    }

    return sortShortageDetails(
      [...detailAccumulators.values()].map((detail) => ({
        ...detail,
        requiredQty: Math.ceil(detail.requiredQty),
      })),
    );
  };

  // 影響する患者さん: 個人はそのまま、施設バッチは 1 カードに集約
  const cardsByKey = new Map<string, AffectedPatientCard>();
  for (const visit of visitingPatients.values()) {
    if (!usesShortageDrug(visit.patientId)) continue;
    const firstVisitDateKey = formatUtcDateKey(visit.scheduledDate);
    const shortageDetails = shortageDetailsForPatient(visit.patientId, firstVisitDateKey);
    const shortageSummary = summarizeShortageDetails(shortageDetails);
    if (visit.facilityBatch) {
      const key = `facility-batch:${visit.facilityBatch.id}`;
      const current = cardsByKey.get(key);
      if (!current) {
        cardsByKey.set(key, {
          key,
          patientId: null,
          label: `${visit.facilityBatch.facilityName} ${visit.facilityBatch.patientCount}名`,
          firstVisitDateKey,
          isFacilityBatch: true,
          facilityPatientCount: visit.facilityBatch.patientCount,
          shortagePatientCount: shortageDetails.length > 0 ? 1 : 0,
          dataBackedPatientCount: shortageDetails.length > 0 ? 1 : 0,
          ...shortageSummary,
        });
      } else {
        const mergedDetails = mergeShortageDetails(current.shortageDetails, shortageDetails);
        cardsByKey.set(key, {
          ...current,
          shortagePatientCount: current.shortagePatientCount + (shortageDetails.length > 0 ? 1 : 0),
          dataBackedPatientCount:
            current.dataBackedPatientCount + (shortageDetails.length > 0 ? 1 : 0),
          ...summarizeShortageDetails(mergedDetails),
        });
      }
      continue;
    }
    const key = `patient:${visit.patientId}`;
    if (!cardsByKey.has(key)) {
      cardsByKey.set(key, {
        key,
        patientId: visit.patientId,
        label: visit.patientName,
        firstVisitDateKey,
        isFacilityBatch: false,
        facilityPatientCount: null,
        shortagePatientCount: shortageDetails.length > 0 ? 1 : 0,
        dataBackedPatientCount: shortageDetails.length > 0 ? 1 : 0,
        ...shortageSummary,
      });
    }
  }

  const patients = [...cardsByKey.values()].sort(
    (a, b) =>
      a.firstVisitDateKey.localeCompare(b.firstVisitDateKey) ||
      a.label.localeCompare(b.label, 'ja'),
  );

  const unresolvedDrugs: UnresolvedDrugForecastRow[] = [...unresolvedByDrug.values()]
    .map((row) => ({
      drugIdentityKey: row.drugIdentityKey,
      drugCode: row.drugCode,
      reason: row.reason,
      drugKey: row.drugKey,
      requiredQty: Math.ceil(row.requiredQty),
      unit: row.unit,
      affectedPatientCount: row.patientIds.size,
    }))
    .sort(
      (left, right) =>
        left.drugKey.localeCompare(right.drugKey, 'ja') ||
        left.drugIdentityKey.localeCompare(right.drugIdentityKey),
    );

  return { drugs, patients, unresolvedDrugs };
}
