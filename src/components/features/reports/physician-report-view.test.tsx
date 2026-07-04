// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
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
  it('renders prescriptions and residual medications through labeled data tables', () => {
    render(
      <PhysicianReportView
        content={buildContent({
          prescriptions: [
            { drug_name: '薬A', dose: '1錠', frequency: '朝', days: 14 },
            { drug_name: '薬B', dose: '2錠', frequency: '夕', days: 7 },
          ],
          residual_medications: [
            {
              drug_name: '薬A',
              remaining_qty: 12,
              excess_days: 3,
              reduction_proposal: true,
            },
          ],
        })}
      />,
    );

    const prescriptionTable = screen.getByRole('table', { name: '処方薬一覧' });
    expect(within(prescriptionTable).getByText('薬A')).toBeTruthy();
    expect(within(prescriptionTable).getByText('1錠')).toBeTruthy();
    expect(within(prescriptionTable).getByText('朝')).toBeTruthy();
    expect(within(prescriptionTable).getByText('14日')).toBeTruthy();

    const residualTable = screen.getByRole('table', { name: '残薬一覧' });
    expect(within(residualTable).getByText('薬A')).toBeTruthy();
    expect(within(residualTable).getByText('12')).toBeTruthy();
    expect(within(residualTable).getByText('3日')).toBeTruthy();
    expect(within(residualTable).getByText('提案あり')).toBeTruthy();
  });

  it('omits prescription and residual medication sections when their arrays are empty', () => {
    render(
      <PhysicianReportView
        content={buildContent({ prescriptions: [], residual_medications: [] })}
      />,
    );

    expect(screen.queryByText('処方内容')).toBeNull();
    expect(screen.queryByText('残薬状況')).toBeNull();
    expect(screen.queryByRole('table', { name: '処方薬一覧' })).toBeNull();
    expect(screen.queryByRole('table', { name: '残薬一覧' })).toBeNull();
  });

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
