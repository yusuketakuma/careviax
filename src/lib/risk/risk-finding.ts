export const RISK_DOMAIN_ORDER = [
  'patient_foundation',
  'consent_plan',
  'medication',
  'dispensing',
  'visit_preparation',
  'visit_record',
  'report_delivery',
  'billing',
  'task_sla',
  'notification',
  'privacy_security',
  'integration',
  'data_quality',
] as const;

export type RiskDomain = (typeof RISK_DOMAIN_ORDER)[number];

export const RISK_DOMAIN_LABELS = {
  patient_foundation: '患者基盤',
  consent_plan: '同意・管理計画',
  medication: '薬剤リスク',
  dispensing: '調剤・監査',
  visit_preparation: '訪問準備',
  visit_record: '訪問記録',
  report_delivery: '報告・共有',
  billing: '算定・請求',
  task_sla: 'タスクSLA',
  notification: '通知',
  privacy_security: 'PII・監査',
  integration: '外部連携',
  data_quality: 'データ品質',
} as const satisfies Record<RiskDomain, string>;

export type RiskSeverity = 'blocking' | 'urgent' | 'warning' | 'info';
export type RiskResolutionState = 'open' | 'acknowledged' | 'resolved' | 'waived';
export type RiskFindingSource = 'computed' | 'manual' | 'external';
export type RiskCockpitStatus = 'ready' | 'attention' | 'blocked';

export type RiskFinding = {
  key: string;
  domain: RiskDomain;
  severity: RiskSeverity;
  title: string;
  detail: string;
  patient_id?: string | null;
  case_id?: string | null;
  related_entity_type?: string | null;
  related_entity_id?: string | null;
  assigned_to?: string | null;
  due_at?: string | null;
  action_href: string;
  action_label: string;
  resolution_state: RiskResolutionState;
  source: RiskFindingSource;
};

export const RISK_SEVERITY_RANK: Record<RiskSeverity, number> = {
  blocking: 0,
  urgent: 1,
  warning: 2,
  info: 3,
};

export function isRiskFindingActive(finding: Pick<RiskFinding, 'resolution_state'>) {
  return finding.resolution_state === 'open' || finding.resolution_state === 'acknowledged';
}

export function statusFromRiskFindings(findings: readonly RiskFinding[]): RiskCockpitStatus {
  const activeFindings = findings.filter(isRiskFindingActive);
  if (activeFindings.some((finding) => finding.severity === 'blocking')) return 'blocked';
  if (
    activeFindings.some(
      (finding) => finding.severity === 'urgent' || finding.severity === 'warning',
    )
  ) {
    return 'attention';
  }
  return 'ready';
}

export function compareRiskFindings(left: RiskFinding, right: RiskFinding) {
  return (
    RISK_SEVERITY_RANK[left.severity] - RISK_SEVERITY_RANK[right.severity] ||
    RISK_DOMAIN_ORDER.indexOf(left.domain) - RISK_DOMAIN_ORDER.indexOf(right.domain) ||
    (left.due_at ?? '').localeCompare(right.due_at ?? '') ||
    left.key.localeCompare(right.key)
  );
}

export function normalizeRiskActionHref(value: string | null | undefined) {
  const candidate = value?.trim();
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) return '/workflow';
  return candidate;
}

export function createRiskFinding(
  input: Omit<RiskFinding, 'resolution_state' | 'source' | 'action_href'> &
    Pick<Partial<RiskFinding>, 'resolution_state' | 'source'> & {
      action_href?: string | null;
    },
): RiskFinding {
  return {
    ...input,
    action_href: normalizeRiskActionHref(input.action_href),
    resolution_state: input.resolution_state ?? 'open',
    source: input.source ?? 'computed',
  };
}

export function buildRiskDedupeKey(
  finding: Pick<RiskFinding, 'domain' | 'key'> & {
    related_entity_type?: string | null;
    related_entity_id?: string | null;
    patient_id?: string | null;
    case_id?: string | null;
  },
) {
  const segments = ['risk', finding.domain, finding.key];

  if (finding.case_id) {
    segments.push('case', finding.case_id);
  } else if (finding.patient_id) {
    segments.push('patient', finding.patient_id);
  }

  if (finding.related_entity_type && finding.related_entity_id) {
    segments.push(finding.related_entity_type, finding.related_entity_id);
  } else if (!finding.case_id && !finding.patient_id) {
    segments.push('risk', 'global');
  }

  return segments.map(encodeRiskDedupeSegment).join(':');
}

export function summarizeRiskFindings(findings: readonly RiskFinding[]) {
  const activeFindings = findings.filter(isRiskFindingActive);
  return {
    status: statusFromRiskFindings(findings),
    blocking_count: activeFindings.filter((finding) => finding.severity === 'blocking').length,
    urgent_count: activeFindings.filter((finding) => finding.severity === 'urgent').length,
    warning_count: activeFindings.filter((finding) => finding.severity === 'warning').length,
  };
}

function encodeRiskDedupeSegment(value: string) {
  return encodeURIComponent(value);
}
