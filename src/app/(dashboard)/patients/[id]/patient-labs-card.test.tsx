// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PatientLabsCard } from './patient-labs-card';

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

describe('PatientLabsCard', () => {
  it('opens a create form and submits a manual lab draft', () => {
    useQueryClientMock.mockReturnValue({
      invalidateQueries: vi.fn(),
    });
    useQueryMock.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      error: null,
    });
    useMutationMock.mockReturnValue({
      isPending: false,
      mutate: mutateMock,
    });

    render(<PatientLabsCard patientId="patient_1" orgId="org_1" />);

    fireEvent.click(screen.getByRole('button', { name: '検査値を追加' }));
    fireEvent.change(screen.getByLabelText('測定日時'), {
      target: { value: '2026-04-10T09:30' },
    });
    fireEvent.change(screen.getByLabelText('数値'), {
      target: { value: '42.1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登録する' }));

    expect(mutateMock).toHaveBeenCalled();
  });
});
