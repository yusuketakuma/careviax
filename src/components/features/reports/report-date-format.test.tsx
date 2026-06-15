// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { CareManagerReportContent, PhysicianReportContent } from '@/types/care-report-content';
import { CareManagerReportView } from './care-manager-report-view';
import { PhysicianReportView } from './physician-report-view';

setupDomTestEnv();

const physicianContent: PhysicianReportContent = {
  patient: { name: '田中 一郎', birth_date: '1940-01-01', gender: 'male' },
  report_date: '2026-06-15',
  visit_date: '2026-06-14',
  pharmacist_name: '鈴木 薬剤師',
  prescriber: { name: '佐藤 医師', institution: '在宅クリニック' },
  prescriptions: [],
  medication_management: {
    compliance_summary: '全量服用。',
    adherence_score: 5,
    self_management: '支援あり',
    calendar_used: true,
  },
  adverse_events: { has_events: false, events: [] },
  functional_assessment: {
    sleep: '問題なし',
    cognition: '問題なし',
    diet_oral: '問題なし',
    mobility: '問題なし',
    excretion: '問題なし',
  },
  residual_medications: [],
  assessment: '薬学的問題なし。',
  plan: '服薬指導を継続。',
  physician_communication: '処方継続で問題ないと考えます。',
  warnings: [],
};

const careManagerContent: CareManagerReportContent = {
  patient: { name: '田中 一郎', birth_date: '1940年1月1日' },
  care_manager: { name: '高橋 ケアマネ', organization: '居宅介護支援事業所' },
  report_date: '2026年6月15日',
  visit_date: '2026年6月14日',
  pharmacist_name: '鈴木 薬剤師',
  medication_management_summary: {
    total_drugs: 1,
    compliance_summary: '全量服用。',
    self_management: '支援あり',
    calendar_used: true,
  },
  functional_impact: {
    sleep_impact: '問題なし',
    cognition_impact: '問題なし',
    diet_impact: '問題なし',
    mobility_impact: '問題なし',
    excretion_impact: '問題なし',
  },
  residual_status: { summary: '残薬なし', reduction_proposals: [] },
  care_service_coordination: {
    medication_assistance: '服薬時の声かけを継続。',
    unit_dose_packaging: true,
    calendar_recommendation: true,
    other_items: '',
  },
  next_visit_plan: {
    date: '2026年6月29日',
    followup_items: ['服薬状況の継続確認'],
  },
  warnings: [],
};

describe('professional report date formatting', () => {
  it('renders ISO dates in Japanese display format for newly generated physician reports', () => {
    render(<PhysicianReportView content={physicianContent} />);

    expect(screen.getByText('2026年6月15日')).toBeTruthy();
    expect(screen.getByText('2026年6月14日')).toBeTruthy();
    expect(screen.getByText('1940年1月1日')).toBeTruthy();
  });

  it('keeps legacy Japanese date strings renderable while pharmacists edit existing drafts', () => {
    render(<CareManagerReportView content={careManagerContent} />);

    expect(screen.getByText('2026年6月15日')).toBeTruthy();
    expect(screen.getByText('2026年6月14日')).toBeTruthy();
    expect(screen.getByText('2026年6月29日')).toBeTruthy();
  });
});
