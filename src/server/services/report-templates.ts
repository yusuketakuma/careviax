// ─── Report Template Builders ────────────────────────────────────────────────
// 訪問記録の structured_soap から医師向け・ケアマネ向け報告書コンテンツを生成する
// 厚労省「在宅患者訪問薬剤管理指導ガイド」薬学的評価シート7項目準拠

import type { StructuredSoap } from '@/types/structured-soap';
import type { PhysicianReportContent, CareManagerReportContent } from '@/types/care-report-content';
import {
  getSoapLabel,
  ADHERENCE_LABELS,
} from '@/lib/constants/soap-options';
import {
  buildAssessmentText,
  buildPlanText,
  joinLabels,
} from '@/lib/utils/soap-text-builder';

// ─── 共通ヘルパー ──────────────────────────────────────────────────────────────

function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function buildLabValuesText(labValues: StructuredSoap['objective']['lab_values']): string | undefined {
  if (!labValues) return undefined;
  const parts: string[] = [];
  if (labValues.hba1c != null) parts.push(`HbA1c ${labValues.hba1c}%`);
  if (labValues.egfr != null) parts.push(`eGFR ${labValues.egfr}`);
  if (labValues.k != null) parts.push(`K ${labValues.k}mEq/L`);
  if (labValues.na != null) parts.push(`Na ${labValues.na}mEq/L`);
  if (labValues.alb != null) parts.push(`Alb ${labValues.alb}g/dL`);
  if (labValues.plt != null) parts.push(`PLT ${labValues.plt}万/μL`);
  if (labValues.pt_inr != null) parts.push(`PT-INR ${labValues.pt_inr}`);
  if (labValues.free_text) parts.push(labValues.free_text);
  return parts.length > 0 ? parts.join('、') : undefined;
}

function buildFunctionalAreaText(values: string[]): string {
  if (values.length === 0 || values.every((v) => v === 'no_issues')) {
    return '問題なし';
  }
  return joinLabels(values.filter((v) => v !== 'no_issues'));
}

// ─── 機能評価 → ケアマネ向け生活機能影響テキスト ─────────────────────────────

function buildSleepImpactText(values: string[]): string {
  if (values.length === 0 || values.every((v) => v === 'no_issues')) {
    return '問題なし';
  }
  const issues = values.filter((v) => v !== 'no_issues');
  const parts: string[] = [];
  if (issues.includes('difficulty_falling_asleep')) {
    parts.push('入眠困難あり。睡眠薬の影響による日中傾眠に注意。');
  }
  if (issues.includes('nocturnal_awakening')) {
    parts.push('中途覚醒あり。睡眠の質低下による日中活動への影響に注意。');
  }
  if (issues.includes('early_awakening')) {
    parts.push('早朝覚醒あり。');
  }
  if (issues.includes('daytime_drowsiness')) {
    parts.push('日中傾眠あり。転倒リスクに注意。');
  }
  return parts.length > 0 ? parts.join('') : `睡眠問題あり（${joinLabels(issues)}）。`;
}

function buildCognitionImpactText(values: string[]): string {
  if (values.length === 0 || values.every((v) => v === 'no_issues')) {
    return '問題なし';
  }
  const issues = values.filter((v) => v !== 'no_issues');
  const parts: string[] = [];
  if (issues.includes('memory_decline')) {
    parts.push('記憶力低下あり。服薬忘れのリスクがあるため、服薬支援が必要。');
  }
  if (issues.includes('disorientation')) {
    parts.push('見当識障害あり。服薬管理の支援強化が必要。');
  }
  if (issues.includes('delirium')) {
    parts.push('せん妄あり。薬剤性せん妄の可能性を評価中。');
  }
  if (issues.includes('sensory_decline')) {
    parts.push('視力・聴力低下あり。服薬説明の工夫が必要。');
  }
  return parts.length > 0 ? parts.join('') : `認知機能問題あり（${joinLabels(issues)}）。`;
}

function buildDietImpactText(values: string[]): string {
  if (values.length === 0 || values.every((v) => v === 'no_issues')) {
    return '問題なし';
  }
  const issues = values.filter((v) => v !== 'no_issues');
  const parts: string[] = [];
  if (issues.includes('appetite_loss')) {
    parts.push('食欲低下あり。薬剤の副作用の可能性を評価中。');
  }
  if (issues.includes('dysphagia')) {
    parts.push('嚥下困難あり。錠剤服用に注意が必要。一包化・粉砕の検討を推奨。');
  }
  if (issues.includes('dry_mouth')) {
    parts.push('口腔乾燥あり。抗コリン薬の影響を確認中。');
  }
  if (issues.includes('taste_disorder')) {
    parts.push('味覚異常あり。亜鉛欠乏または薬剤性の可能性を評価中。');
  }
  return parts.length > 0 ? parts.join('') : `食事・口腔問題あり（${joinLabels(issues)}）。`;
}

function buildMobilityImpactText(values: string[]): string {
  if (values.length === 0 || values.every((v) => v === 'no_issues')) {
    return '問題なし';
  }
  const issues = values.filter((v) => v !== 'no_issues');
  const parts: string[] = [];
  if (issues.includes('unsteadiness')) {
    parts.push('ふらつきあり。降圧薬による起立性低血圧リスクに注意。');
  }
  if (issues.includes('fall_history')) {
    parts.push('転倒歴あり。睡眠薬・降圧薬の見直しを検討中。');
  }
  if (issues.includes('grip_decline')) {
    parts.push('握力低下あり。フレイル進行に注意。');
  }
  if (issues.includes('orthostatic_hypotension')) {
    parts.push('起立性低血圧あり。降圧薬の調整を医師に提案予定。');
  }
  return parts.length > 0 ? parts.join('') : `歩行・運動問題あり（${joinLabels(issues)}）。`;
}

function buildExcretionImpactText(values: string[]): string {
  if (values.length === 0 || values.every((v) => v === 'no_issues')) {
    return '問題なし';
  }
  const issues = values.filter((v) => v !== 'no_issues');
  const parts: string[] = [];
  if (issues.includes('constipation')) {
    parts.push('便秘あり。緩下剤の適切な使用について指導済み。');
  }
  if (issues.includes('diarrhea')) {
    parts.push('下痢あり。薬剤性の可能性を評価中。');
  }
  if (issues.includes('frequent_urination')) {
    parts.push('頻尿あり。過活動膀胱治療薬の効果を確認中。');
  }
  if (issues.includes('incontinence')) {
    parts.push('尿失禁あり。服薬管理と排泄ケアの連携が必要。');
  }
  return parts.length > 0 ? parts.join('') : `排泄問題あり（${joinLabels(issues)}）。`;
}

// ─── BuildPhysicianReport の入力型 ────────────────────────────────────────────

export type PhysicianReportContext = {
  patient: {
    name: string;
    birth_date: Date | string;
    gender: string;
  };
  visitRecord: {
    visited_at: Date | string;
  };
  structuredSoap: StructuredSoap;
  prescriptionLines: Array<{
    drug_name: string;
    dose: string;
    frequency: string;
    days_supply: number;
    route?: string | null;
    dispensing_method?: string | null;
  }>;
  residualMedications: Array<{
    drug_name: string;
    remaining_quantity: number;
    excess_days: number;
    is_reduction_target: boolean;
  }>;
  prescriber: {
    name: string;
    organization_name?: string | null;
  };
  pharmacistName: string;
};

// ─── BuildCareManagerReport の入力型 ─────────────────────────────────────────

export type CareManagerReportContext = {
  patient: {
    name: string;
    birth_date: Date | string;
  };
  visitRecord: {
    visited_at: Date | string;
  };
  structuredSoap: StructuredSoap;
  prescriptionLines: Array<{
    drug_name: string;
    dose: string;
    frequency: string;
    days_supply: number;
  }>;
  residualMedications: Array<{
    drug_name: string;
    remaining_quantity: number;
    excess_days: number;
    is_reduction_target: boolean;
  }>;
  careManager: {
    name: string;
    organization_name?: string | null;
  };
  pharmacistName: string;
};

// ─── 医師向け報告書ビルダー ───────────────────────────────────────────────────

export function buildPhysicianReport(ctx: PhysicianReportContext): PhysicianReportContent {
  const { patient, visitRecord, structuredSoap, prescriptionLines, residualMedications, prescriber, pharmacistName } = ctx;
  const { subjective, objective, assessment, plan } = structuredSoap;

  const warnings: string[] = [];

  // 算定要件チェック
  if (prescriptionLines.length === 0) {
    warnings.push('処方内容が登録されていません。算定要件を満たすには処方情報の入力が必要です。');
  }
  if (!objective.medication_status || objective.adherence_score == null) {
    warnings.push('服薬状況が未入力です。算定要件を満たすには服薬状況の記録が必要です。');
  }
  if (objective.adverse_events == null) {
    warnings.push('有害事象の確認が未記録です。算定要件を満たすには有害事象チェックの入力が必要です。');
  }
  if (
    assessment.problem_checks.length === 0 ||
    (assessment.free_text == null && plan.free_text == null && plan.prescription_proposal == null)
  ) {
    warnings.push('薬学的介入内容が未記録です。算定要件を満たすには薬学的評価・介入の記録が必要です。');
  }

  // 服薬管理サマリー
  const adherenceLabel = ADHERENCE_LABELS[objective.adherence_score]?.label ?? `${objective.adherence_score}/5`;
  const complianceSummary = `服薬状況: ${getSoapLabel(objective.medication_status)}。アドヒアランス: ${adherenceLabel}(${objective.adherence_score}/5)。${subjective.free_text ?? ''}`.trim();

  // 機能評価
  const fa = objective.functional_assessment;
  const functionalAssessment: PhysicianReportContent['functional_assessment'] = {
    lab_values: buildLabValuesText(objective.lab_values),
    sleep: fa ? buildFunctionalAreaText(fa.sleep) : '記載なし',
    cognition: fa ? buildFunctionalAreaText(fa.cognition) : '記載なし',
    diet_oral: fa ? buildFunctionalAreaText(fa.diet_oral) : '記載なし',
    mobility: fa ? buildFunctionalAreaText(fa.mobility) : '記載なし',
    excretion: fa ? buildFunctionalAreaText(fa.excretion) : '記載なし',
  };

  return {
    patient: {
      name: patient.name,
      birth_date: formatDate(patient.birth_date),
      gender: patient.gender,
    },
    report_date: formatDate(new Date()),
    visit_date: formatDate(visitRecord.visited_at),
    pharmacist_name: pharmacistName,
    prescriber: {
      name: prescriber.name,
      institution: prescriber.organization_name ?? '',
    },
    prescriptions: prescriptionLines.map((line) => ({
      drug_name: line.drug_name,
      dose: line.dose,
      frequency: line.frequency,
      days: line.days_supply,
      route: line.route ?? undefined,
      dispensing_method: line.dispensing_method ?? undefined,
    })),
    medication_management: {
      compliance_summary: complianceSummary,
      adherence_score: objective.adherence_score,
      self_management: objective.self_management_ability
        ? getSoapLabel(objective.self_management_ability)
        : '記載なし',
      calendar_used: objective.medication_calendar_used ?? false,
    },
    adverse_events: {
      has_events: objective.adverse_events?.has_events ?? false,
      events: (objective.adverse_events?.events ?? []).map(getSoapLabel),
      details: objective.adverse_events?.details,
    },
    functional_assessment: functionalAssessment,
    residual_medications: residualMedications.map((r) => ({
      drug_name: r.drug_name,
      remaining_qty: r.remaining_quantity,
      excess_days: r.excess_days,
      reduction_proposal: r.is_reduction_target,
    })),
    assessment: buildAssessmentText(assessment),
    plan: buildPlanText(plan),
    prescription_proposals: plan.prescription_proposal ?? undefined,
    physician_communication: plan.physician_report_items ?? '',
    warnings,
  };
}

// ─── ケアマネ向け情報提供書ビルダー ──────────────────────────────────────────

export function buildCareManagerReport(ctx: CareManagerReportContext): CareManagerReportContent {
  const { patient, visitRecord, structuredSoap, prescriptionLines, residualMedications, careManager, pharmacistName } = ctx;
  const { objective, plan } = structuredSoap;

  const warnings: string[] = [];

  if (prescriptionLines.length === 0) {
    warnings.push('処方内容が登録されていません。正確な服薬管理情報の提供には処方情報が必要です。');
  }

  // 服薬管理サマリー
  const adherenceLabel = ADHERENCE_LABELS[objective.adherence_score]?.label ?? `${objective.adherence_score}/5`;
  const complianceSummary = `${getSoapLabel(objective.medication_status)}（アドヒアランス: ${adherenceLabel}）`;

  // 機能的影響テキスト（問題ありの項目のみ生活機能影響として変換）
  const fa = objective.functional_assessment;
  const functionalImpact: CareManagerReportContent['functional_impact'] = {
    sleep_impact: fa ? buildSleepImpactText(fa.sleep) : '記載なし',
    cognition_impact: fa ? buildCognitionImpactText(fa.cognition) : '記載なし',
    diet_impact: fa ? buildDietImpactText(fa.diet_oral) : '記載なし',
    mobility_impact: fa ? buildMobilityImpactText(fa.mobility) : '記載なし',
    excretion_impact: fa ? buildExcretionImpactText(fa.excretion) : '記載なし',
  };

  // 残薬状況
  const reductionTargets = residualMedications.filter((r) => r.is_reduction_target);
  const residualSummary =
    residualMedications.length === 0
      ? '残薬なし'
      : `残薬あり（${residualMedications.length}剤）。${reductionTargets.length > 0 ? `うち${reductionTargets.length}剤で減量調整を検討中。` : ''}`;

  // ケアサービス連携情報（plan から抽出）
  const interventions = plan.intervention_checks ?? [];
  const unitDoseProposal =
    interventions.includes('unit_dose_proposal') ||
    (plan.care_service_coordination?.includes('一包化') ?? false);
  const calendarProposal =
    interventions.includes('calendar_proposal') ||
    (plan.care_service_coordination?.includes('カレンダー') ?? false);

  // フォローアップ項目
  const followupItems: string[] = [];
  if (objective.adherence_score <= 3) {
    followupItems.push('服薬アドヒアランスの継続確認');
  }
  if (reductionTargets.length > 0) {
    followupItems.push('残薬調整の進捗確認');
  }
  if (plan.care_manager_report_items) {
    followupItems.push(plan.care_manager_report_items);
  }
  if (plan.free_text) {
    followupItems.push(plan.free_text);
  }

  return {
    patient: {
      name: patient.name,
      birth_date: formatDate(patient.birth_date),
    },
    care_manager: {
      name: careManager.name,
      organization: careManager.organization_name ?? '',
    },
    report_date: formatDate(new Date()),
    visit_date: formatDate(visitRecord.visited_at),
    pharmacist_name: pharmacistName,
    medication_management_summary: {
      total_drugs: prescriptionLines.length,
      compliance_summary: complianceSummary,
      self_management: objective.self_management_ability
        ? getSoapLabel(objective.self_management_ability)
        : '記載なし',
      calendar_used: objective.medication_calendar_used ?? false,
    },
    functional_impact: functionalImpact,
    residual_status: {
      summary: residualSummary,
      reduction_proposals: reductionTargets.map((r) => r.drug_name),
    },
    care_service_coordination: {
      medication_assistance: plan.care_service_coordination ?? '',
      unit_dose_packaging: unitDoseProposal,
      calendar_recommendation: calendarProposal,
      other_items: plan.care_manager_report_items ?? '',
    },
    next_visit_plan: {
      date: plan.next_visit_date ?? undefined,
      followup_items: followupItems,
    },
    warnings,
  };
}
