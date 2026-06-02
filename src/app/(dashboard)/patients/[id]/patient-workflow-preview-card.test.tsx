// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PatientWorkflowPreviewCard } from './patient-workflow-preview-card';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('PatientWorkflowPreviewCard', () => {
  it('renders visit, report, and communication preview sections', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({
      data: {
        visit_preparation: {
          onboarding_readiness: {
            consent_obtained: true,
            emergency_contact_set: true,
            primary_physician_set: true,
            management_plan_approved: false,
          },
          scheduling_preview: {
            preferred_weekdays: [1, 3],
            preferred_time_from: '1970-01-01T09:00:00.000Z',
            preferred_time_to: '1970-01-01T12:00:00.000Z',
            phone_contact_from: null,
            phone_contact_to: null,
            facility_time_from: null,
            facility_time_to: null,
            family_presence_required: false,
            visit_buffer_minutes: 30,
            preferred_contact_name: '長男 山田',
            preferred_contact_phone: '090-1111-2222',
            visit_before_contact_required: true,
            first_visit_preferred_date: null,
            first_visit_time_slot: null,
            first_visit_time_note: null,
            parking_available: true,
            primary_contact_preference: 'phone',
            mcs_linked: true,
          },
          baseline_context: {
            primary_disease: '心不全',
            care_level: 'care_3',
            adl_level: 'b',
            dementia_level: 'ii',
            money_management: 'family',
            family_key_person: '長男 山田',
            medication_support_methods: ['unit_dose'],
            special_medical_procedures: ['narcotics'],
            infection_isolation: null,
            narcotics_base: true,
            narcotics_rescue: false,
            residual_medication_status: '調整中',
          },
          latest_labs: [],
          blockers: ['承認済み管理計画書がありません。'],
        },
        report_targets: [
          {
            key: 'physician_report',
            label: '医師向け報告',
            available: true,
            source: 'care_team',
            recipient_name: '主治医 佐藤',
            recipient_organization: '佐藤医院',
            contact: 'TEL 03-0000-1111',
          },
        ],
        communication_priority: {
          preferred_contact_method: 'phone',
          effective_channel: 'phone',
          visit_before_contact_required: true,
          pharmacy_decision_due_date: null,
          targets: [
            {
              key: 'family',
              recipientRole: 'family_share',
              recipientName: '長男 山田',
              contact: '090-1111-2222',
              priority_order: 1,
            },
          ],
          warnings: ['患者・家族への事前連絡を優先します。'],
        },
      },
      isLoading: false,
      error: null,
    });

    render(<PatientWorkflowPreviewCard patientId="patient_1" />);

    expect(
      screen.getByRole('heading', { level: 2, name: '訪問・報告・連携プレビュー' }).tagName,
    ).toBe('H2');
    expect(screen.getByRole('heading', { name: '訪問準備プレビュー' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '報告先マトリクス' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '連携優先順位プレビュー' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '患者編集' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '同意記録' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'MCS連携' })).toBeTruthy();
    expect(screen.getByText('医師向け報告')).toBeTruthy();
    expect(screen.getByText('患者情報')).toBeTruthy();
    expect(screen.getByText(/佐藤医院/)).toBeTruthy();
    expect(screen.getByText('患者・家族への事前連絡を優先します。')).toBeTruthy();
  });
});
