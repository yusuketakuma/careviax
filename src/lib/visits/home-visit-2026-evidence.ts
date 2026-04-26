import type {
  HomeVisit2026Evidence,
  InitialTransitionManagementEvidence,
  MultiStaffVisitEvidence,
  PhysicianSimultaneousVisitEvidence,
  StructuredSoap,
} from '@/types/structured-soap';

export type HomeVisit2026EvidenceSeverity = 'urgent' | 'high' | 'normal';

export type HomeVisit2026EvidenceItem = {
  key: string;
  label: string;
  description: string;
  done: boolean;
  required: boolean;
  severity: HomeVisit2026EvidenceSeverity;
};

export type HomeVisit2026BillingBlocker = {
  key: string;
  reason: string;
  severity?: HomeVisit2026EvidenceSeverity;
};

export type HomeVisit2026ReadinessInput = {
  structuredSoap?: Partial<StructuredSoap> | null;
  visitType?: string | null;
  residualMedicationCount?: number;
  billingBlockers?: HomeVisit2026BillingBlocker[];
  intakeInitialTransitionExpected?: boolean | null;
};

export type HomeVisit2026BillingEligibility = {
  physicianSimultaneousEligible: boolean;
  multiStaffVisitEligible: boolean;
  initialTransitionEligible: boolean;
};

export function readHomeVisit2026Evidence(
  structuredSoap?: Partial<StructuredSoap> | null,
): HomeVisit2026Evidence {
  return structuredSoap?.home_visit_2026 ?? {};
}

function hasText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasArrayValues(values: string[] | undefined) {
  return Array.isArray(values) && values.some((value) => hasText(value));
}

function hasMedicationStatus(structuredSoap?: Partial<StructuredSoap> | null) {
  const status = structuredSoap?.objective?.medication_status;
  return hasText(status) && status !== 'free_text_only';
}

function hasAdverseEventEvidence(structuredSoap?: Partial<StructuredSoap> | null) {
  const objective = structuredSoap?.objective;
  if (!objective) return false;
  if (hasArrayValues(objective.side_effect_checks)) return true;
  if (objective.adverse_events?.has_events != null) return true;
  return hasText(objective.adverse_events?.details);
}

function hasPolypharmacyEvidence(structuredSoap?: Partial<StructuredSoap> | null) {
  const problemChecks = structuredSoap?.assessment?.problem_checks ?? [];
  return problemChecks.some((value) =>
    [
      'interaction_risk',
      'duplicate_medication',
      'dose_inappropriate',
      'side_effect_suspected',
      'drug_related_geriatric',
      'adherence_decline',
    ].includes(value),
  );
}

function hasInterventionEvidence(structuredSoap?: Partial<StructuredSoap> | null) {
  const plan = structuredSoap?.plan;
  if (!plan) return false;
  return (
    hasArrayValues(plan.intervention_checks) ||
    hasText(plan.free_text) ||
    hasText(plan.prescription_proposal) ||
    hasText(plan.physician_report_items) ||
    hasText(plan.care_manager_report_items) ||
    hasText(plan.care_service_coordination)
  );
}

export function isPhysicianSimultaneousEligible(
  evidence?: PhysicianSimultaneousVisitEvidence | null,
) {
  if (!evidence?.performed) return false;
  return Boolean(
    evidence.patient_consent &&
    hasText(evidence.physician_name) &&
    evidence.medication_adjustment_discussed &&
    hasText(evidence.discussion_summary) &&
    evidence.same_day_exclusion_checked,
  );
}

export function isMultiStaffVisitEligible(evidence?: MultiStaffVisitEvidence | null) {
  if (!evidence?.performed) return false;
  return Boolean(
    evidence.patient_consent &&
    evidence.physician_need_confirmed &&
    hasText(evidence.safety_reason) &&
    hasText(evidence.companion_name) &&
    hasText(evidence.necessity_summary),
  );
}

export function isInitialTransitionEligible(evidence?: InitialTransitionManagementEvidence | null) {
  if (!evidence?.target) return false;
  return Boolean(
    evidence.pre_visit_environment_assessed &&
    evidence.medication_risk_assessed &&
    hasText(evidence.transition_support_summary),
  );
}

export function getHomeVisit2026BillingEligibility(
  structuredSoap?: Partial<StructuredSoap> | null,
): HomeVisit2026BillingEligibility {
  const evidence = readHomeVisit2026Evidence(structuredSoap);
  return {
    physicianSimultaneousEligible: isPhysicianSimultaneousEligible(evidence.physician_simultaneous),
    multiStaffVisitEligible: isMultiStaffVisitEligible(evidence.multi_staff_visit),
    initialTransitionEligible: isInitialTransitionEligible(evidence.initial_transition_management),
  };
}

function buildPhysicianSimultaneousItems(
  evidence: PhysicianSimultaneousVisitEvidence | undefined,
): HomeVisit2026EvidenceItem[] {
  if (!evidence?.performed) return [];
  return [
    {
      key: 'physician_simultaneous_consent',
      label: '医師同時訪問の同意',
      description: '患者または家族等の同意を得たことを残します。',
      done: Boolean(evidence.patient_consent),
      required: true,
      severity: 'high',
    },
    {
      key: 'physician_simultaneous_physician',
      label: '同時訪問した医師',
      description: '主治医名と医療機関を記録します。',
      done: hasText(evidence.physician_name),
      required: true,
      severity: 'high',
    },
    {
      key: 'physician_simultaneous_discussion',
      label: '残薬・薬物療法最適化の協議',
      description: '残薬、服薬状況、副作用、剤形・用法変更などの協議内容を記録します。',
      done: Boolean(
        evidence.medication_adjustment_discussed && hasText(evidence.discussion_summary),
      ),
      required: true,
      severity: 'high',
    },
    {
      key: 'physician_simultaneous_exclusion',
      label: '同日併算定制限の確認',
      description: '在宅患者緊急時等共同指導料・在宅移行初期管理料との同日重複を確認します。',
      done: Boolean(evidence.same_day_exclusion_checked),
      required: true,
      severity: 'normal',
    },
  ];
}

function buildMultiStaffItems(
  evidence: MultiStaffVisitEvidence | undefined,
): HomeVisit2026EvidenceItem[] {
  if (!evidence?.performed) return [];
  return [
    {
      key: 'multi_staff_consent',
      label: '複数名訪問の同意',
      description: '患者または家族等の同意を得たことを残します。',
      done: Boolean(evidence.patient_consent),
      required: true,
      severity: 'high',
    },
    {
      key: 'multi_staff_physician_need',
      label: '医師が必要性を認めた記録',
      description: '薬剤師側の利便性ではなく、安全・確実な実施のための必要性を確認します。',
      done: Boolean(evidence.physician_need_confirmed),
      required: true,
      severity: 'high',
    },
    {
      key: 'multi_staff_reason',
      label: '安全上の必要性',
      description: '興奮、攻撃性、強い不安など単独訪問では実施担保が難しい理由を記録します。',
      done: hasText(evidence.safety_reason) && hasText(evidence.necessity_summary),
      required: true,
      severity: 'high',
    },
    {
      key: 'multi_staff_companion',
      label: '同行者',
      description: '同行した職員名と役割を記録します。',
      done: hasText(evidence.companion_name),
      required: true,
      severity: 'normal',
    },
  ];
}

function buildInitialTransitionItems(
  evidence: InitialTransitionManagementEvidence | undefined,
): HomeVisit2026EvidenceItem[] {
  if (!evidence?.target) return [];
  return [
    {
      key: 'initial_transition_environment',
      label: '初期移行の生活環境確認',
      description: '初回算定月に必要な患家・生活環境・服薬支援体制の確認を残します。',
      done: Boolean(evidence.pre_visit_environment_assessed),
      required: true,
      severity: 'high',
    },
    {
      key: 'initial_transition_medication_risk',
      label: '初期移行の薬学的リスク確認',
      description: '退院直後や在宅移行時の副作用、残薬、服薬困難、相互作用リスクを確認します。',
      done: Boolean(evidence.medication_risk_assessed),
      required: true,
      severity: 'high',
    },
    {
      key: 'initial_transition_summary',
      label: '初期移行支援の要点',
      description: '初回訪問前後で共有すべき薬学的管理の要点を記録します。',
      done: hasText(evidence.transition_support_summary),
      required: true,
      severity: 'normal',
    },
  ];
}

export function buildHomeVisit2026ReadinessItems({
  structuredSoap,
  visitType,
  residualMedicationCount = 0,
  billingBlockers = [],
  intakeInitialTransitionExpected,
}: HomeVisit2026ReadinessInput): HomeVisit2026EvidenceItem[] {
  const evidence = readHomeVisit2026Evidence(structuredSoap);
  const initialTransition =
    evidence.initial_transition_management ??
    (visitType === 'initial' || intakeInitialTransitionExpected ? { target: true } : undefined);

  const baseItems: HomeVisit2026EvidenceItem[] = [
    {
      key: 'medication_review',
      label: '服薬状況の確認',
      description: '服薬状況、アドヒアランス、服薬支援の状態を残します。',
      done: Boolean(evidence.medication_review_completed || hasMedicationStatus(structuredSoap)),
      required: true,
      severity: 'high',
    },
    {
      key: 'residual_medication',
      label: '残薬確認',
      description: '残薬の有無と処方調整が必要な薬剤を確認します。',
      done: Boolean(evidence.residual_medication_checked || residualMedicationCount > 0),
      required: true,
      severity: 'high',
    },
    {
      key: 'adverse_event',
      label: '副作用・有害事象確認',
      description: '副作用の早期兆候、検査値、生活機能への影響を確認します。',
      done: Boolean(evidence.adverse_event_checked || hasAdverseEventEvidence(structuredSoap)),
      required: true,
      severity: 'high',
    },
    {
      key: 'polypharmacy',
      label: 'ポリファーマシー・重複相互作用確認',
      description: '重複投薬、相互作用、用量不適切、薬剤起因性老年症候群を確認します。',
      done: Boolean(evidence.polypharmacy_reviewed || hasPolypharmacyEvidence(structuredSoap)),
      required: true,
      severity: 'normal',
    },
    {
      key: 'intervention_plan',
      label: '薬学的介入と報告方針',
      description: '医師・ケアマネへ渡す提案、介入、次回計画を記録します。',
      done: hasInterventionEvidence(structuredSoap),
      required: true,
      severity: 'normal',
    },
    {
      key: 'after_hours_contact',
      label: '夜間休日連絡体制の確認',
      description: '開局時間外の調剤・訪問薬剤管理指導の連絡体制を患者側と確認します。',
      done: Boolean(evidence.after_hours_contact_confirmed),
      required: true,
      severity: 'normal',
    },
  ];

  const blockerItems = billingBlockers.map((blocker) => ({
    key: `billing_blocker:${blocker.key}`,
    label: '請求根拠ブロッカー',
    description: blocker.reason,
    done: false,
    required: true,
    severity: blocker.severity ?? 'high',
  })) satisfies HomeVisit2026EvidenceItem[];

  return [
    ...baseItems,
    ...buildInitialTransitionItems(initialTransition),
    ...buildPhysicianSimultaneousItems(evidence.physician_simultaneous),
    ...buildMultiStaffItems(evidence.multi_staff_visit),
    ...blockerItems,
  ];
}

export function summarizeHomeVisit2026Evidence(structuredSoap?: Partial<StructuredSoap> | null) {
  const evidence = readHomeVisit2026Evidence(structuredSoap);
  const lines: string[] = [];

  if (evidence.medication_review_completed) lines.push('服薬状況確認済み');
  if (evidence.residual_medication_checked) lines.push('残薬確認済み');
  if (evidence.adverse_event_checked) lines.push('副作用・有害事象確認済み');
  if (evidence.polypharmacy_reviewed) lines.push('重複投薬・相互作用確認済み');
  if (evidence.after_hours_contact_confirmed) lines.push('夜間休日連絡体制確認済み');

  if (evidence.physician_simultaneous?.performed) {
    lines.push(
      `医師同時訪問: ${[
        evidence.physician_simultaneous.physician_name,
        evidence.physician_simultaneous.discussion_summary,
      ]
        .filter(hasText)
        .join(' / ')}`,
    );
  }

  if (evidence.multi_staff_visit?.performed) {
    lines.push(
      `複数名訪問: ${[
        evidence.multi_staff_visit.safety_reason,
        evidence.multi_staff_visit.necessity_summary,
      ]
        .filter(hasText)
        .join(' / ')}`,
    );
  }

  if (evidence.initial_transition_management?.target) {
    lines.push(
      `在宅移行初期管理: ${
        evidence.initial_transition_management.transition_support_summary ?? '要点未記載'
      }`,
    );
  }

  return lines;
}
