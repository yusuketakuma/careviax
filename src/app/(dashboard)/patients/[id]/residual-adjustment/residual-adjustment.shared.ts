/**
 * p0_31 残薬調整フローの表示モデル(純関数)。
 * ResidualMedication のフィールドだけから「残 N日」ラベル・調整案テーブル
 * (残薬/今回処方/提案)・確定時の介入記録文を導出する。
 *
 * 導出規則(表示用ヒューリスティック):
 * - 残日数 = remaining_days(無ければ excess_days)
 * - 1日量 = remaining_quantity ÷ 残日数
 * - 今回処方日数 = prescribed_quantity ÷ 1日量(四捨五入)
 * - 提案: 残日数 >= 今回処方日数 →「今回は中止・回収」/
 *         それ未満 →「(今回処方日数 - 残日数)日分へ調整」
 * - 今回処方が無い(prescribed_quantity 無し)薬剤は調整対象外(確認カードのみ)
 * - 減数禁止(麻薬/抗がん剤)はテーブルに載せず「止まっている理由」へ回す
 */

export type ResidualMedicationRecord = {
  id: string;
  visit_record_id: string;
  drug_name: string;
  prescribed_quantity: number | null;
  remaining_quantity: number;
  remaining_days: number | null;
  excess_days: number | null;
  is_reduction_target: boolean;
  is_prohibited_reduction: boolean;
  created_at: string;
};

export type ResidualAdjustmentProposal =
  | { kind: 'stop_and_collect'; label: string }
  | { kind: 'reduce_days'; adjustedDays: number; label: string };

export type ResidualAdjustmentRow = {
  id: string;
  drugName: string;
  remainingDays: number;
  prescribedDays: number;
  proposal: ResidualAdjustmentProposal;
};

export type ResidualAdjustmentPlan = {
  rows: ResidualAdjustmentRow[];
  /** 減数禁止(麻薬/抗がん剤)で機械提案を出せない薬剤名 */
  prohibitedDrugNames: string[];
};

/** 残日数の解決: remaining_days 優先、無ければ excess_days(余剰日数)。 */
export function resolveRemainingDays(
  record: Pick<ResidualMedicationRecord, 'remaining_days' | 'excess_days'>,
): number | null {
  if (record.remaining_days !== null && record.remaining_days >= 0) {
    return record.remaining_days;
  }
  if (record.excess_days !== null && record.excess_days >= 0) {
    return record.excess_days;
  }
  return null;
}

/** 確認カードの「残 N日」ラベル。残日数不明のときは残数量で代替する。 */
export function formatRemainingLabel(
  record: Pick<ResidualMedicationRecord, 'remaining_days' | 'excess_days' | 'remaining_quantity'>,
): string {
  const remainingDays = resolveRemainingDays(record);
  if (remainingDays !== null) return `残 ${remainingDays}日`;
  return `残数 ${record.remaining_quantity}`;
}

/**
 * 今回処方の日数換算。1日量を「残量 ÷ 残日数」から推定し、
 * 今回処方量(prescribed_quantity)を日数へ換算する。推定不能なら null。
 */
export function deriveCurrentPrescriptionDays(
  record: Pick<
    ResidualMedicationRecord,
    'prescribed_quantity' | 'remaining_quantity' | 'remaining_days' | 'excess_days'
  >,
): number | null {
  const remainingDays = resolveRemainingDays(record);
  if (remainingDays === null || remainingDays <= 0) return null;
  if (record.prescribed_quantity === null || record.prescribed_quantity <= 0) return null;
  if (record.remaining_quantity <= 0) return null;

  const dailyDose = record.remaining_quantity / remainingDays;
  const days = Math.round(record.prescribed_quantity / dailyDose);
  return days > 0 ? days : null;
}

/** 残日数と今回処方日数から調整提案を合成する。対象外は null。 */
export function buildAdjustmentProposal(args: {
  remainingDays: number | null;
  prescribedDays: number | null;
}): ResidualAdjustmentProposal | null {
  const { remainingDays, prescribedDays } = args;
  if (remainingDays === null || remainingDays <= 0) return null;
  if (prescribedDays === null || prescribedDays <= 0) return null;

  if (remainingDays >= prescribedDays) {
    return { kind: 'stop_and_collect', label: '今回は中止・回収' };
  }
  const adjustedDays = prescribedDays - remainingDays;
  return { kind: 'reduce_days', adjustedDays, label: `${adjustedDays}日分へ調整` };
}

/** 残薬記録の一覧から調整案テーブルの行と減数禁止の注意を組み立てる。 */
export function buildResidualAdjustmentPlan(
  records: ResidualMedicationRecord[],
): ResidualAdjustmentPlan {
  const rows: ResidualAdjustmentRow[] = [];
  const prohibitedDrugNames: string[] = [];

  for (const record of records) {
    const remainingDays = resolveRemainingDays(record);
    if (record.is_prohibited_reduction) {
      if (remainingDays !== null && remainingDays > 0) {
        prohibitedDrugNames.push(record.drug_name);
      }
      continue;
    }

    const prescribedDays = deriveCurrentPrescriptionDays(record);
    const proposal = buildAdjustmentProposal({ remainingDays, prescribedDays });
    if (!proposal || remainingDays === null || prescribedDays === null) continue;

    rows.push({
      id: record.id,
      drugName: record.drug_name,
      remainingDays,
      prescribedDays,
      proposal,
    });
  }

  return { rows, prohibitedDrugNames };
}

/** 「調整案を確定」時に介入記録(dose_adjustment)へ残す本文。 */
export function buildAdjustmentConfirmDescription(rows: ResidualAdjustmentRow[]): string {
  const detail = rows.map((row) => `${row.drugName}: ${row.proposal.label}`).join(' / ');
  return `残薬調整の調整案を確定。${detail}`;
}

export type PhysicianInstructionSource = {
  id: string;
  residual_adjustment: boolean | null;
  result: string | null;
  change_detail: string | null;
  inquiry_content: string;
  inquired_at: string;
  resolved_at: string | null;
};

export type PhysicianInstruction = {
  id: string;
  text: string;
  recordedAt: string;
};

/**
 * 医師の指示記録: 残薬調整の疑義照会のうち回答済み(changed/unchanged)のものを
 * 新しい順に並べる。本文は change_detail 優先、無ければ照会内容に回答区分を添える。
 */
export function pickPhysicianInstructions(
  records: PhysicianInstructionSource[],
): PhysicianInstruction[] {
  return records
    .filter(
      (record) =>
        record.residual_adjustment === true &&
        (record.result === 'changed' || record.result === 'unchanged'),
    )
    .map((record) => ({
      id: record.id,
      text:
        record.change_detail && record.change_detail.trim().length > 0
          ? record.change_detail
          : `${record.inquiry_content}(回答: ${record.result === 'changed' ? '処方変更あり' : '変更なし'})`,
      recordedAt: record.resolved_at ?? record.inquired_at,
    }))
    .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt));
}

/** 残薬写真のアップロード先 visit_record_id(最新の残薬記録の訪問を使う)。 */
export function resolveLatestVisitRecordId(records: ResidualMedicationRecord[]): string | null {
  if (records.length === 0) return null;
  const latest = [...records].sort((left, right) =>
    left.created_at.localeCompare(right.created_at),
  );
  return latest[latest.length - 1]?.visit_record_id ?? null;
}
