// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PatientInsuranceCard } from './patient-insurance-card';

setupDomTestEnv();

const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const mutateMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('PatientInsuranceCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens a create form and submits a new insurance draft', () => {
    useQueryClientMock.mockReturnValue({
      invalidateQueries: vi.fn(),
    });
    useQueryMock.mockReturnValue({
      data: {
        data: {
          current: [],
          upcoming: [],
          history: [],
          all: [],
        },
      },
      isLoading: false,
      error: null,
    });
    useMutationMock.mockReturnValue({
      isPending: false,
      mutate: mutateMock,
    });

    render(<PatientInsuranceCard patientId="patient_1" orgId="org_1" />);

    expect(screen.getByRole('heading', { level: 2, name: '保険詳細' }).tagName).toBe('H2');
    fireEvent.click(screen.getByRole('button', { name: '保険追加' }));
    expect(screen.getByRole('heading', { level: 3, name: 'new-insurance' }).tagName).toBe('H3');
    fireEvent.change(screen.getByLabelText('番号'), {
      target: { value: '1234567' },
    });
    fireEvent.change(screen.getByLabelText('自己負担割合'), {
      target: { value: '30' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(mutateMock).toHaveBeenCalledWith({
      form: expect.objectContaining({
        insurance_type: 'medical',
        application_status: 'confirmed',
        number: '1234567',
        copay_ratio: '30',
        is_active: true,
      }),
    });
  });

  it('surfaces and submits pending public subsidy and care change status fields', () => {
    useQueryClientMock.mockReturnValue({
      invalidateQueries: vi.fn(),
    });
    useQueryMock.mockReturnValue({
      data: {
        data: {
          current: [
            {
              id: 'ins_public_54',
              insurance_type: 'public_subsidy',
              application_status: 'applying',
              application_submitted_at: '2026-06-01T00:00:00.000Z',
              decision_at: null,
              public_program_code: '54',
              previous_care_level: null,
              provisional_care_level: null,
              confirmed_care_level: null,
              insurer_number: null,
              symbol: null,
              number: null,
              branch_number: null,
              copay_ratio: null,
              valid_from: '2026-06-01T00:00:00.000Z',
              valid_until: null,
              is_active: true,
              notes: '指定難病申請中',
            },
            {
              id: 'ins_care_change',
              insurance_type: 'care',
              application_status: 'change_pending',
              application_submitted_at: '2026-06-01T00:00:00.000Z',
              decision_at: null,
              public_program_code: null,
              previous_care_level: 'care_1',
              provisional_care_level: 'care_2',
              confirmed_care_level: null,
              insurer_number: '137000',
              symbol: null,
              number: null,
              branch_number: null,
              copay_ratio: null,
              valid_from: '2026-06-01T00:00:00.000Z',
              valid_until: null,
              is_active: true,
              notes: '区分変更中',
            },
          ],
          upcoming: [],
          history: [],
          all: [],
        },
      },
      isLoading: false,
      error: null,
    });
    useMutationMock.mockReturnValue({
      isPending: false,
      mutate: mutateMock,
    });

    render(<PatientInsuranceCard patientId="patient_1" orgId="org_1" />);

    expect(screen.getByText('申請中')).toBeTruthy();
    expect(screen.getAllByText('区分変更中').length).toBeGreaterThan(0);
    expect(screen.getByText('54')).toBeTruthy();
    expect(screen.getByText(/変更前 要介護1 \/ 暫定 要介護2 \/ 確定/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '保険追加' }));
    fireEvent.change(screen.getByLabelText('保険種別'), {
      target: { value: 'public_subsidy' },
    });
    fireEvent.change(screen.getByLabelText('資格状態'), {
      target: { value: 'applying' },
    });
    fireEvent.change(screen.getByLabelText('公費制度コード'), {
      target: { value: '21' },
    });
    fireEvent.change(screen.getByLabelText('申請日'), {
      target: { value: '2026-06-08' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(mutateMock).toHaveBeenCalledWith({
      form: expect.objectContaining({
        insurance_type: 'public_subsidy',
        application_status: 'applying',
        public_program_code: '21',
        application_submitted_at: '2026-06-08',
      }),
    });
  });
});
