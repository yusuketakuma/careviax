import { describe, expect, it } from 'vitest';
import {
  buildRiskDedupeKey,
  compareRiskFindings,
  createRiskFinding,
  normalizeRiskActionHref,
  statusFromRiskFindings,
  summarizeRiskFindings,
  type RiskFinding,
} from './risk-finding';

function finding(overrides: Partial<RiskFinding> = {}): RiskFinding {
  return createRiskFinding({
    key: overrides.key ?? 'risk_1',
    domain: overrides.domain ?? 'billing',
    severity: overrides.severity ?? 'warning',
    title: overrides.title ?? '確認が必要です',
    detail: overrides.detail ?? '確認してください。',
    patient_id: overrides.patient_id ?? null,
    case_id: overrides.case_id ?? null,
    related_entity_type: overrides.related_entity_type ?? null,
    related_entity_id: overrides.related_entity_id ?? null,
    assigned_to: overrides.assigned_to ?? null,
    due_at: overrides.due_at ?? null,
    action_href: overrides.action_href ?? '/workflow',
    action_label: overrides.action_label ?? '確認',
    resolution_state: overrides.resolution_state,
    source: overrides.source,
  });
}

describe('risk-finding core', () => {
  it('defaults source and resolution state and rejects unsafe action hrefs', () => {
    expect(finding({ action_href: 'https://evil.example/patient' })).toMatchObject({
      action_href: '/workflow',
      resolution_state: 'open',
      source: 'computed',
    });
    expect(normalizeRiskActionHref('//evil.example')).toBe('/workflow');
    expect(normalizeRiskActionHref('/patients/patient_1')).toBe('/patients/patient_1');
  });

  it('rolls up status and counts by severity', () => {
    const findings = [
      finding({ key: 'info', severity: 'info' }),
      finding({ key: 'urgent', severity: 'urgent' }),
      finding({ key: 'blocking', severity: 'blocking' }),
      finding({ key: 'warning', severity: 'warning' }),
    ];

    expect(statusFromRiskFindings(findings)).toBe('blocked');
    expect(summarizeRiskFindings(findings)).toEqual({
      status: 'blocked',
      blocking_count: 1,
      urgent_count: 1,
      warning_count: 1,
    });
  });

  it('ignores resolved and waived findings in status rollups but keeps acknowledged active', () => {
    const findings = [
      finding({ key: 'resolved_blocker', severity: 'blocking', resolution_state: 'resolved' }),
      finding({ key: 'waived_urgent', severity: 'urgent', resolution_state: 'waived' }),
      finding({
        key: 'acknowledged_warning',
        severity: 'warning',
        resolution_state: 'acknowledged',
      }),
    ];

    expect(statusFromRiskFindings(findings)).toBe('attention');
    expect(summarizeRiskFindings(findings)).toEqual({
      status: 'attention',
      blocking_count: 0,
      urgent_count: 0,
      warning_count: 1,
    });
  });

  it('sorts by severity, domain order, due date, and key', () => {
    const sorted = [
      finding({ key: 'z', domain: 'billing', severity: 'warning', due_at: '2026-07-02' }),
      finding({
        key: 'a',
        domain: 'patient_foundation',
        severity: 'warning',
        due_at: '2026-07-02',
      }),
      finding({ key: 'b', domain: 'billing', severity: 'urgent', due_at: '2026-07-03' }),
      finding({ key: 'c', domain: 'billing', severity: 'urgent', due_at: '2026-07-01' }),
    ].sort(compareRiskFindings);

    expect(sorted.map((item) => item.key)).toEqual(['c', 'b', 'a', 'z']);
  });

  it('builds stable risk dedupe keys from entity, case, patient, or global fallback', () => {
    expect(
      buildRiskDedupeKey(
        finding({
          domain: 'billing',
          key: 'missing_visit_consent',
          patient_id: 'patient_1',
          related_entity_type: 'billing_evidence',
          related_entity_id: 'bill_1',
        }),
      ),
    ).toBe('risk:billing:missing_visit_consent:patient:patient_1:billing_evidence:bill_1');
    expect(
      buildRiskDedupeKey(finding({ domain: 'consent_plan', key: 'missing', case_id: 'case_1' })),
    ).toBe('risk:consent_plan:missing:case:case_1');
    expect(
      buildRiskDedupeKey(
        finding({
          domain: 'task_sla',
          key: 'task:task/1',
          patient_id: 'patient/1?x=1',
          related_entity_type: 'task',
          related_entity_id: 'task/1',
        }),
      ),
    ).toBe('risk:task_sla:task%3Atask%2F1:patient:patient%2F1%3Fx%3D1:task:task%2F1');
    expect(buildRiskDedupeKey(finding({ domain: 'data_quality', key: 'global' }))).toBe(
      'risk:data_quality:global:risk:global',
    );
  });
});
