// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
        number: '1234567',
        copay_ratio: '30',
        is_active: true,
      }),
    });
  });
});
