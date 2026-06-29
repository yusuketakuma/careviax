// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { PhysicianReportContent } from '@/types/care-report-content';
import { PhysicianReportView } from './physician-report-view';

setupDomTestEnv();

function buildContent(overrides: Partial<PhysicianReportContent> = {}): PhysicianReportContent {
  return {
    patient: { name: '山田太郎', birth_date: '1940-01-01', gender: 'male' },
    report_date: '2026-04-21',
    visit_date: '2026-04-20',
    pharmacist_name: '薬剤師',
    prescriber: { name: '佐藤医師', institution: '佐藤医院' },
    prescriptions: [{ drug_name: '薬A', dose: '1錠', frequency: '朝', days: 14 }],
    medication_management: {
      compliance_summary: '',
      adherence_score: 0,
      self_management: '',
      calendar_used: false,
    },
    adverse_events: { has_events: false, events: [], details: '' },
    functional_assessment: {
      sleep: '',
      cognition: '',
      diet_oral: '',
      mobility: '',
      excretion: '',
    },
    residual_medications: [],
    assessment: '',
    plan: '',
    prescription_proposals: '',
    physician_communication: '',
    warnings: [],
    ...overrides,
  };
}

describe('PhysicianReportView', () => {
  it('lists classified prescriptions under その他薬（セット外で持参） (§11-7)', () => {
    render(
      <PhysicianReportView
        content={buildContent({
          prescriptions: [
            { drug_name: '薬A', dose: '1錠', frequency: '朝', days: 14 },
            {
              drug_name: 'モーラステープ',
              dose: '1日1回',
              frequency: '患部',
              days: 14,
              route: '外用',
              outside_med_kind: 'topical',
              outside_med_label: '外用',
            },
          ],
        })}
      />,
    );

    expect(screen.getByText('その他薬（セット外で持参）')).toBeTruthy();
    // 薬剤名・分類ラベルは処方内容表とその他薬セクションの両方に出るため複数一致を許容。
    expect(screen.getAllByText('モーラステープ').length).toBeGreaterThan(0);
    expect(screen.getAllByText('外用').length).toBeGreaterThan(0);
  });

  it('omits the その他薬 section when no prescription is classified', () => {
    render(<PhysicianReportView content={buildContent()} />);

    expect(screen.queryByText('その他薬（セット外で持参）')).toBeNull();
  });
});
