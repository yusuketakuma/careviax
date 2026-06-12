// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { ReportEditForm } from './report-edit-form';
import type { CareManagerReportContent, PhysicianReportContent } from '@/types/care-report-content';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const invalidateQueriesMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: { mutationFn: () => Promise<unknown> }) => ({
    mutate: () => void options.mutationFn(),
    isPending: false,
  }),
  useQueryClient: () => ({
    invalidateQueries: invalidateQueriesMock,
  }),
}));

const physicianContent: PhysicianReportContent = {
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
};

const careManagerContent: CareManagerReportContent = {
  patient: { name: '山田太郎', birth_date: '1940-01-01' },
  care_manager: { name: '田中ケアマネ', organization: '支援事業所' },
  report_date: '2026-04-21',
  visit_date: '2026-04-20',
  pharmacist_name: '薬剤師',
  medication_management_summary: {
    total_drugs: 0,
    compliance_summary: '',
    self_management: '',
    calendar_used: false,
  },
  functional_impact: {
    sleep_impact: '',
    cognition_impact: '',
    diet_impact: '',
    mobility_impact: '',
    excretion_impact: '',
  },
  residual_status: { summary: '', reduction_proposals: [] },
  care_service_coordination: {
    medication_assistance: '',
    unit_dose_packaging: false,
    calendar_recommendation: false,
    other_items: '',
  },
  next_visit_plan: { followup_items: [] },
  warnings: [],
};

describe('ReportEditForm', () => {
  it('exposes physician report fields needed for billing-compliant completion', () => {
    useOrgIdMock.mockReturnValue('org_1');

    render(
      <ReportEditForm reportId="report_1" reportType="physician_report" content={physicianContent} />,
    );

    expect(screen.getByText('算定要件を満たすための編集ナビ')).toBeTruthy();
    expect(screen.getByText('未入力: 服薬状況が記載されている')).toBeTruthy();
    expect(screen.getByText('服薬状況')).toBeTruthy();
    expect(screen.getByText('有害事象・副作用確認')).toBeTruthy();
    expect(screen.getByText('睡眠・生活リズム')).toBeTruthy();
    expect(screen.getByText('処方医への連絡事項')).toBeTruthy();
  });

  it('exposes care-manager report fields for residual, functional, and care-service coordination', () => {
    useOrgIdMock.mockReturnValue('org_1');

    render(
      <ReportEditForm
        reportId="report_1"
        reportType="care_manager_report"
        content={careManagerContent}
      />,
    );

    expect(screen.getByText('未入力: 服薬管理状況が記載されている')).toBeTruthy();
    expect(screen.getByText('服薬管理状況')).toBeTruthy();
    expect(screen.getByText('睡眠への影響')).toBeTruthy();
    expect(screen.getByText('残薬状況（概要）')).toBeTruthy();
    expect(screen.getByText('服薬介助・介護サービスへの依頼')).toBeTruthy();
    expect(screen.getByText('次回訪問予定日')).toBeTruthy();
  });
});
