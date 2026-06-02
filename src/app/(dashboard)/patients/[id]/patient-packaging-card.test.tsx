// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());

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

import { PatientPackagingCard } from './patient-packaging-card';

setupDomTestEnv();

describe('PatientPackagingCard', () => {
  it('renders packaging settings with a semantic section heading and shared action row', () => {
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockReturnValue({
      data: {
        data: {
          packaging_profile: {
            default_packaging_method: 'medication_box',
            medication_box_color: '赤',
            notes: '朝だけ別包',
            special_instructions: '手渡し順に注意',
            cognitive_note: '飲み忘れ傾向あり',
            updated_at: '2026-06-01T10:00:00.000Z',
          },
          effective_summary: 'お薬BOX 赤',
        },
      },
      isLoading: false,
    });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    render(<PatientPackagingCard patientId="patient_1" orgId="org_1" />);

    expect(screen.getByRole('heading', { level: 2, name: '配薬設定' }).tagName).toBe('H2');
    expect(screen.getByText('お薬BOX')).toBeTruthy();
    expect(screen.getByText('BOX色 赤')).toBeTruthy();
    expect(screen.getByRole('button', { name: '保存' })).toBeTruthy();
  });
});
