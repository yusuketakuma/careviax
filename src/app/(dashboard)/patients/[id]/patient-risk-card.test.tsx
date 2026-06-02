// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PatientRiskCard } from './patient-risk-card';

setupDomTestEnv();

describe('PatientRiskCard', () => {
  it('renders the patient risk summary with a semantic section heading', () => {
    render(
      <PatientRiskCard
        riskSummary={{
          patient_id: 'patient_1',
          patient_name: '山田花子',
          level: 'high',
          score: 8,
          reasons: ['報告待ちのケアレポートがあります。'],
          unresolved_self_reports: 1,
          open_issues: 2,
          disrupted_visits_30d: 0,
          open_tasks: 3,
          pending_reports: 4,
          missing_visit_consent: false,
          missing_management_plan: true,
        }}
      />,
    );

    expect(screen.getByRole('heading', { level: 2, name: '患者リスク' }).tagName).toBe('H2');
    expect(screen.getByText('高 / 8')).toBeTruthy();
    expect(screen.getByText('報告待ちのケアレポートがあります。')).toBeTruthy();
  });
});
