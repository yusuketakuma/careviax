/**
 * p0_32 薬の安全チェックの表示モデル(純関数)。
 * 服薬課題(MedicationIssue)と CDS チェック結果(CdsAlert)を
 * 「気になる点」4 カテゴリ(飲み合わせ/用量確認/副作用疑い/重複)と
 * 「確認の流れ」4 ステップの進行状態へ射影する。
 *
 * 導出規則:
 * - 気になる点カード: 未解決(open/in_progress)の課題 + CDS アラートを
 *   カテゴリ別に束ね、カテゴリごとに 1 枚。代表テキストは課題タイトル優先
 *   (課題が無いカテゴリは CDS アラート文言)。
 * - 赤見出し: カテゴリ内に priority=critical の課題、または
 *   severity=critical の CDS アラートがあるとき。
 * - 確認の流れ: 課題 status(open→in_progress→resolved/dismissed)から導出。
 *   1. 薬歴・検査値を確認 = 課題が 1 件でも特定済み
 *   2. 処方医へ相談       = いずれかの課題が in_progress 以降へ進行
 *   3. 処方変更の結果を記録 = いずれかの課題が resolved/dismissed
 *   4. 報告書へ反映        = 全課題が resolved/dismissed
 */

export type SafetyIssueStatus = 'open' | 'in_progress' | 'resolved' | 'dismissed';
export type SafetyIssuePriority = 'critical' | 'high' | 'medium' | 'low';
export type SafetyIssueCategory =
  | 'adherence'
  | 'side_effect'
  | 'interaction'
  | 'duplicate'
  | 'other'
  | null;

export type SafetyIssueRecord = {
  id: string;
  title: string;
  description: string;
  status: SafetyIssueStatus;
  priority: SafetyIssuePriority;
  category: SafetyIssueCategory;
  identified_at: string;
};

export type SafetyCdsAlert = {
  type: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
};

/** 気になる点の表示カテゴリ(デザイン固定の 4 分類) */
export type ConcernCategory = 'interaction' | 'dose' | 'adverse' | 'duplicate';

export const CONCERN_CATEGORY_ORDER: readonly ConcernCategory[] = [
  'interaction',
  'dose',
  'adverse',
  'duplicate',
];

export const CONCERN_CATEGORY_LABELS: Record<ConcernCategory, string> = {
  interaction: '飲み合わせ',
  dose: '用量確認',
  adverse: '副作用疑い',
  duplicate: '重複',
};

export type SafetyConcern = {
  category: ConcernCategory;
  /** カテゴリ見出し(飲み合わせ/用量確認/副作用疑い/重複) */
  label: string;
  /** 代表テキスト(課題タイトル or CDS アラート文言) */
  subLabel: string;
  /** 赤見出し対象(critical 課題 or critical アラートを含む) */
  critical: boolean;
  /** 右パネル操作の対象になる課題 ID(CDS アラートのみのカテゴリは null) */
  issueId: string | null;
  /** カテゴリに束ねた課題+アラートの件数 */
  itemCount: number;
};

export type SafetyStep = {
  id: 'review_history' | 'consult_prescriber' | 'record_outcome' | 'reflect_report';
  stepNumber: number;
  label: string;
  done: boolean;
};

/** 未解決(画面に出す)課題か */
export function isUnresolvedIssue(issue: Pick<SafetyIssueRecord, 'status'>): boolean {
  return issue.status === 'open' || issue.status === 'in_progress';
}

/** 完了済み(resolved/dismissed)課題か */
export function isClosedIssue(issue: Pick<SafetyIssueRecord, 'status'>): boolean {
  return issue.status === 'resolved' || issue.status === 'dismissed';
}

/**
 * 用量確認カテゴリの判定キーワード。
 * MedicationIssue.category に「用量」区分が無いため、
 * other / 未分類の課題はタイトル・説明の文言から判定する。
 */
const DOSE_KEYWORD_PATTERN = /用量|減量|増量|過量|egfr|腎機能|pim/i;

/** 服薬課題 → 表示カテゴリ。4 分類に該当しない課題(adherence 等)は null。 */
export function mapIssueToConcernCategory(
  issue: Pick<SafetyIssueRecord, 'category' | 'title' | 'description'>,
): ConcernCategory | null {
  switch (issue.category) {
    case 'interaction':
      return 'interaction';
    case 'side_effect':
      return 'adverse';
    case 'duplicate':
      return 'duplicate';
    case 'other':
    case null:
      return DOSE_KEYWORD_PATTERN.test(`${issue.title} ${issue.description}`) ? 'dose' : null;
    default:
      // adherence はこの画面の 4 分類対象外(服薬管理画面で扱う)
      return null;
  }
}

/**
 * CDS アラート種別 → 表示カテゴリ。
 * 安全 4 分類に対応しない種別(narcotic/high_risk/lasa 等の調剤運用系)は null。
 */
export function mapAlertToConcernCategory(alertType: string): ConcernCategory | null {
  switch (alertType) {
    case 'interaction':
    case 'package_insert_contraindication':
      return 'interaction';
    case 'renal_dose':
    case 'pim_elderly':
    case 'package_insert_elderly':
    case 'max_days':
    case 'do_prescription':
      return 'dose';
    case 'package_insert_adverse_effect':
    case 'allergy_cross':
    case 'monitoring':
      return 'adverse';
    case 'duplicate':
      return 'duplicate';
    default:
      return null;
  }
}

const PRIORITY_RANK: Record<SafetyIssuePriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * 「気になる点」カード列の組み立て。
 * カテゴリ固定順(飲み合わせ→用量確認→副作用疑い→重複)で、
 * 中身のあるカテゴリだけを返す。
 */
export function buildSafetyConcerns(
  issues: SafetyIssueRecord[],
  alerts: SafetyCdsAlert[],
): SafetyConcern[] {
  const concerns: SafetyConcern[] = [];

  for (const category of CONCERN_CATEGORY_ORDER) {
    const categoryIssues = issues
      .filter(isUnresolvedIssue)
      .filter((issue) => mapIssueToConcernCategory(issue) === category)
      .sort(
        (left, right) =>
          PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority] ||
          left.identified_at.localeCompare(right.identified_at),
      );
    const categoryAlerts = alerts.filter(
      (alert) => mapAlertToConcernCategory(alert.type) === category,
    );

    if (categoryIssues.length === 0 && categoryAlerts.length === 0) continue;

    const representativeIssue = categoryIssues[0] ?? null;
    concerns.push({
      category,
      label: CONCERN_CATEGORY_LABELS[category],
      subLabel: representativeIssue?.title ?? categoryAlerts[0]?.message ?? '',
      critical:
        categoryIssues.some((issue) => issue.priority === 'critical') ||
        categoryAlerts.some((alert) => alert.severity === 'critical'),
      issueId: representativeIssue?.id ?? null,
      itemCount: categoryIssues.length + categoryAlerts.length,
    });
  }

  return concerns;
}

const SAFETY_STEP_DEFS: ReadonlyArray<Pick<SafetyStep, 'id' | 'label'>> = [
  { id: 'review_history', label: '薬歴・検査値を確認' },
  { id: 'consult_prescriber', label: '処方医へ相談' },
  { id: 'record_outcome', label: '処方変更の結果を記録' },
  { id: 'reflect_report', label: '報告書へ反映' },
];

/** 「確認の流れ」4 ステップの進行状態を課題 status から導出する。 */
export function deriveSafetySteps(
  issues: Array<Pick<SafetyIssueRecord, 'status'>>,
): SafetyStep[] {
  const hasAnyIssue = issues.length > 0;
  const anyConsulted = issues.some(
    (issue) => issue.status === 'in_progress' || isClosedIssue(issue),
  );
  const anyClosed = issues.some(isClosedIssue);
  const allClosed = hasAnyIssue && issues.every(isClosedIssue);
  const doneFlags = [hasAnyIssue, anyConsulted, anyClosed, allClosed];

  return SAFETY_STEP_DEFS.map((step, index) => ({
    ...step,
    stepNumber: index + 1,
    done: doneFlags[index] ?? false,
  }));
}
