import type { StructuredSoap } from '@/types/structured-soap';
import { VISIT_RECORD_STEPS, type VisitRecordStepId } from './visit-step-nav';

/**
 * p0_23「訪問モード Smartphone」のモバイルウィザード用の純関数群。
 * - 服薬 3 択(きちんと/ときどき/ほとんど)→ 既存 structured_soap.objective への射影
 * - ステップごとのセクション表示制御(<md のみ hidden)
 * - 未同期写真ドラフト(p0_48 evidence-drafts)の件数集計
 */

export type MedicationAdherenceChoice = 'well' | 'sometimes_missed' | 'poor';

export const MEDICATION_ADHERENCE_CHOICES: ReadonlyArray<{
  value: MedicationAdherenceChoice;
  label: string;
}> = [
  { value: 'well', label: 'きちんと飲めている' },
  { value: 'sometimes_missed', label: 'ときどき忘れる' },
  { value: 'poor', label: 'ほとんど飲めていない' },
];

/**
 * 3 択 → 既存フィールドの射影。新規フィールドは作らず、
 * 厚労省評価シート準拠の medication_status(soap-options.ts)と
 * adherence_score(1-5)の既存ペアへ書き込む。
 * - きちんと飲めている → 全量服用 / 5(良好)
 * - ときどき忘れる   → 飲み忘れあり / 3(やや不良)
 * - ほとんど飲めていない → 飲み忘れあり / 2(不良)
 */
const ADHERENCE_CHOICE_PROJECTION: Record<
  MedicationAdherenceChoice,
  { medication_status: string; adherence_score: 1 | 2 | 3 | 4 | 5 }
> = {
  well: { medication_status: 'full_compliance', adherence_score: 5 },
  sometimes_missed: { medication_status: 'missed_doses', adherence_score: 3 },
  poor: { medication_status: 'missed_doses', adherence_score: 2 },
};

export function applyMedicationAdherenceChoice(
  soap: StructuredSoap,
  choice: MedicationAdherenceChoice,
): StructuredSoap {
  const projection = ADHERENCE_CHOICE_PROJECTION[choice];
  return {
    ...soap,
    objective: {
      ...soap.objective,
      medication_status: projection.medication_status,
      adherence_score: projection.adherence_score,
    },
  };
}

/**
 * 既存の structured_soap から選択中の 3 択を逆引きする。
 * 射影ペア以外(未入力 free_text_only / 一部残薬あり / 拒薬 など)は
 * 入力内容を誤って上書き表示しないよう未選択(null)とする。
 */
export function deriveMedicationAdherenceChoice(
  objective: Pick<StructuredSoap['objective'], 'medication_status' | 'adherence_score'> | undefined,
): MedicationAdherenceChoice | null {
  if (!objective) return null;
  if (objective.medication_status === 'full_compliance') return 'well';
  if (objective.medication_status === 'missed_doses') {
    return objective.adherence_score <= 2 ? 'poor' : 'sometimes_missed';
  }
  return null;
}

/** メモ(任意)→ structured_soap.objective.free_text への射影(空文字は未設定に戻す) */
export function applyMedicationAdherenceMemo(soap: StructuredSoap, memo: string): StructuredSoap {
  return {
    ...soap,
    objective: {
      ...soap.objective,
      free_text: memo === '' ? undefined : memo,
    },
  };
}

/** この訪問(予定)に紐づく未同期写真ドラフト件数(橙バナー/未同期バッジ用) */
export function countUnsyncedEvidenceDrafts(
  summaries: ReadonlyArray<{ scheduleId: string }> | undefined,
  scheduleId: string,
): number {
  if (!summaries) return 0;
  return summaries.filter((summary) => summary.scheduleId === scheduleId).length;
}

/** モバイルヘッダの未同期バッジ件数(オフライン同期キュー+写真ドラフトの合算) */
export function resolveMobilePendingSyncCount(
  pendingSyncCount: number,
  unsyncedEvidenceCount: number,
): number {
  return Math.max(0, pendingSyncCount) + Math.max(0, unsyncedEvidenceCount);
}

/**
 * モバイルウィザードのセクション表示制御。現在ステップが sectionStepIds に
 * 含まれないセクションは <md のみ hidden(md 以上は従来どおり常時表示)。
 */
export function mobileVisitStepSectionClassName(
  activeStepId: VisitRecordStepId,
  sectionStepIds: readonly VisitRecordStepId[],
): string | undefined {
  return sectionStepIds.includes(activeStepId) ? undefined : 'max-md:hidden';
}

/** デスクトップの「保存前チェック」セクションが内包するステップ群(モバイルでは 1 ステップ 1 画面) */
export const FINAL_SECTION_STEP_IDS: readonly VisitRecordStepId[] = [
  'visit-step-receipt',
  'visit-step-next-visit',
  'visit-step-residual',
  'visit-step-evidence',
  'visit-step-final-check',
];

/** target(p0_23)の見出し表記に合わせるステップ別の上書き */
const MOBILE_STEP_HEADING_OVERRIDES: Partial<Record<VisitRecordStepId, string>> = {
  'visit-step-soap': '服薬・副作用確認',
};

export function resolveMobileVisitStepHeading(stepId: VisitRecordStepId): string {
  const override = MOBILE_STEP_HEADING_OVERRIDES[stepId];
  if (override) return override;
  return VISIT_RECORD_STEPS.find((step) => step.id === stepId)?.label ?? '';
}
