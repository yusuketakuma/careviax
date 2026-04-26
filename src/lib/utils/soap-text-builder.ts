import type { StructuredSoap } from '@/types/structured-soap';
import { getSoapLabel, ADHERENCE_LABELS } from '@/lib/constants/soap-options';
import { summarizeHomeVisit2026Evidence } from '@/lib/visits/home-visit-2026-evidence';

export function joinLabels(values: string[]): string {
  return values.map(getSoapLabel).join('、');
}

export function buildSubjectiveText(s: StructuredSoap['subjective']): string {
  const parts: string[] = [];
  if (s.symptom_checks.length > 0) {
    if (s.symptom_checks.includes('no_symptoms')) {
      parts.push('自覚症状なし');
    } else {
      parts.push(`主訴: ${joinLabels(s.symptom_checks)}`);
    }
  }
  if (s.free_text) parts.push(s.free_text);
  return parts.join('。') || '記載なし';
}

export function buildObjectiveText(o: StructuredSoap['objective']): string {
  const parts: string[] = [];

  if (o.vitals) {
    const v = o.vitals;
    const vParts: string[] = [];
    if (v.systolic_bp != null && v.diastolic_bp != null)
      vParts.push(`BP ${v.systolic_bp}/${v.diastolic_bp}mmHg`);
    if (v.pulse != null) vParts.push(`P ${v.pulse}/分`);
    if (v.temperature != null) vParts.push(`T ${v.temperature}℃`);
    if (v.spo2 != null) vParts.push(`SpO2 ${v.spo2}%`);
    if (v.weight != null) vParts.push(`体重 ${v.weight}kg`);
    if (vParts.length > 0) parts.push(`バイタル: ${vParts.join(', ')}`);
  }

  if (o.lab_values) {
    const lv = o.lab_values;
    const lvParts: string[] = [];
    if (lv.hba1c != null) lvParts.push(`HbA1c ${lv.hba1c}%`);
    if (lv.egfr != null) lvParts.push(`eGFR ${lv.egfr}`);
    if (lv.k != null) lvParts.push(`K ${lv.k}mEq/L`);
    if (lv.pt_inr != null) lvParts.push(`PT-INR ${lv.pt_inr}`);
    if (lvParts.length > 0) parts.push(`検査値: ${lvParts.join(', ')}`);
    if (lv.free_text) parts.push(lv.free_text);
  }

  parts.push(`服薬状況: ${getSoapLabel(o.medication_status)}`);
  const adhLabel = ADHERENCE_LABELS[o.adherence_score]?.label ?? `${o.adherence_score}/5`;
  parts.push(`アドヒアランス: ${adhLabel}(${o.adherence_score}/5)`);

  if (o.self_management_ability) {
    parts.push(`自己管理能力: ${getSoapLabel(o.self_management_ability)}`);
  }
  if (o.medication_calendar_used != null) {
    parts.push(`服薬カレンダー: ${o.medication_calendar_used ? '使用中' : '未使用'}`);
  }

  if (o.side_effect_checks.length > 0) {
    parts.push(`副作用チェック: ${joinLabels(o.side_effect_checks)}`);
  }

  if (o.functional_assessment) {
    const fa = o.functional_assessment;
    const faItems: string[] = [];
    if (fa.sleep.length > 0 && !fa.sleep.includes('no_issues'))
      faItems.push(`睡眠: ${joinLabels(fa.sleep)}`);
    if (fa.cognition.length > 0 && !fa.cognition.includes('no_issues'))
      faItems.push(`認知: ${joinLabels(fa.cognition)}`);
    if (fa.diet_oral.length > 0 && !fa.diet_oral.includes('no_issues'))
      faItems.push(`食事口腔: ${joinLabels(fa.diet_oral)}`);
    if (fa.mobility.length > 0 && !fa.mobility.includes('no_issues'))
      faItems.push(`歩行運動: ${joinLabels(fa.mobility)}`);
    if (fa.excretion.length > 0 && !fa.excretion.includes('no_issues'))
      faItems.push(`排泄: ${joinLabels(fa.excretion)}`);
    if (faItems.length > 0) parts.push(`【機能評価】${faItems.join('。')}`);
  }

  if (o.adverse_events) {
    if (o.adverse_events.has_events) {
      parts.push(
        `薬物有害事象あり: ${joinLabels(o.adverse_events.events)}${o.adverse_events.details ? `（${o.adverse_events.details}）` : ''}`,
      );
    } else {
      parts.push('薬物有害事象なし');
    }
  }

  if (o.free_text) parts.push(o.free_text);
  return parts.join('。') || '記載なし';
}

export function buildAssessmentText(a: StructuredSoap['assessment']): string {
  const parts: string[] = [];
  if (a.problem_checks.length > 0) {
    if (a.problem_checks.includes('no_issues')) {
      parts.push('薬学的問題なし');
    } else {
      parts.push(`薬学的問題: ${joinLabels(a.problem_checks)}`);
      if (a.severity) parts.push(`重症度: ${getSoapLabel(a.severity)}`);
    }
  }
  if (a.drug_related_problems && a.drug_related_problems.length > 0) {
    parts.push(`薬剤起因性問題: ${joinLabels(a.drug_related_problems)}`);
  }
  if (a.free_text) parts.push(a.free_text);
  return parts.join('。') || '記載なし';
}

export function buildPlanText(p: StructuredSoap['plan']): string {
  const parts: string[] = [];
  if (p.intervention_checks.length > 0) {
    parts.push(`介入: ${joinLabels(p.intervention_checks)}`);
  }
  if (p.next_visit_date) parts.push(`次回訪問予定: ${p.next_visit_date}`);
  if (p.prescription_proposal) parts.push(`処方提案: ${p.prescription_proposal}`);
  if (p.physician_report_items) parts.push(`医師連絡: ${p.physician_report_items}`);
  if (p.care_manager_report_items) parts.push(`ケアマネ連絡: ${p.care_manager_report_items}`);
  if (p.care_service_coordination) parts.push(`介護連携: ${p.care_service_coordination}`);
  if (p.free_text) parts.push(p.free_text);
  return parts.join('。') || '記載なし';
}

export function buildAllSoapTexts(soap: StructuredSoap) {
  const planText = buildPlanText(soap.plan);
  const homeVisit2026Summary = summarizeHomeVisit2026Evidence(soap);

  return {
    soap_subjective: buildSubjectiveText(soap.subjective),
    soap_objective: buildObjectiveText(soap.objective),
    soap_assessment: buildAssessmentText(soap.assessment),
    soap_plan: [planText, ...homeVisit2026Summary].filter(Boolean).join('。'),
  };
}
