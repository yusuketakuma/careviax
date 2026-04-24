// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PrescriptionInlineDetail } from './prescription-inline-detail';

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

vi.mock('@/components/features/patients/patient-history-summary', () => ({
  PatientHistorySummary: () => <div>直近過去歴サマリー</div>,
}));

describe('PrescriptionInlineDetail', () => {
  it('shows patient history links from the prescription management detail pane', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({
      data: {
        id: 'intake_1',
        cycle_id: 'cycle_1',
        source_type: 'paper',
        prescribed_date: '2026-04-20T00:00:00.000Z',
        prescriber_name: '佐藤医師',
        prescriber_institution: '佐藤医院',
        prescriber_institution_id: null,
        prescriber_institution_ref: null,
        prescription_expiry_date: null,
        original_document_url: null,
        refill_remaining_count: null,
        refill_next_dispense_date: null,
        split_dispense_total: null,
        split_dispense_current: null,
        split_next_dispense_date: null,
        created_at: '2026-04-20T09:00:00.000Z',
        lines: [
          {
            id: 'line_1',
            line_number: 1,
            drug_name: 'アムロジピン錠5mg',
            drug_code: '2149001',
            dosage_form: '錠',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 14,
            route: 'internal',
            dispensing_method: null,
            is_generic: false,
            is_generic_name_prescription: false,
            packaging_instructions: null,
            notes: null,
          },
        ],
        cycle: {
          id: 'cycle_1',
          overall_status: 'intake_received',
          patient_id: 'patient_1',
          case_id: 'case_1',
          case_: {
            patient: {
              id: 'patient_1',
              name: '山田太郎',
              name_kana: 'ヤマダタロウ',
              birth_date: '1940-01-01T00:00:00.000Z',
              gender: 'male',
            },
          },
          inquiries: [],
        },
      },
      isLoading: false,
      error: null,
    });

    render(<PrescriptionInlineDetail intakeId="intake_1" />);

    expect(screen.getByRole('heading', { name: '患者の過去歴' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /処方歴/ }).getAttribute('href')).toBe(
      '/patients/patient_1/prescriptions',
    );
    expect(screen.getByRole('link', { name: /訪問歴/ }).getAttribute('href')).toBe(
      '/patients/patient_1?tab=visits',
    );
    expect(screen.getByRole('link', { name: /統合履歴/ }).getAttribute('href')).toBe(
      '/patients/patient_1?tab=timeline',
    );
  });
});
