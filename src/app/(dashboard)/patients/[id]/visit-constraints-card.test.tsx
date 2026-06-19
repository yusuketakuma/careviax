// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useMutation: useMutationMock,
  useQuery: useQueryMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { VisitConstraintsCard } from './visit-constraints-card';

setupDomTestEnv();

describe('VisitConstraintsCard', () => {
  it('renders visit constraints with a semantic section heading and shared action row', () => {
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockReturnValue({
      data: {
        data: {
          scheduling_preference: {
            preferred_weekdays: [1, 3],
            preferred_time_from: '2026-06-01T09:00:00.000Z',
            preferred_time_to: '2026-06-01T11:00:00.000Z',
            phone_contact_from: '2026-06-01T13:00:00.000Z',
            phone_contact_to: '2026-06-01T16:00:00.000Z',
            facility_time_from: null,
            facility_time_to: null,
            family_presence_required: true,
            visit_buffer_minutes: 15,
            preferred_contact_name: '山田花子',
            preferred_contact_phone: '090-0000-0000',
            notes: '玄関で電話',
          },
          residence: {
            lat: 35.1,
            lng: 139.1,
            geocode_status: 'verified',
            geocode_source: 'manual',
            geocode_accuracy: 'rooftop',
            geocoded_at: '2026-06-01T10:00:00.000Z',
          },
        },
      },
      isLoading: false,
    });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    render(<VisitConstraintsCard patientId="patient_1" orgId="org_1" />);

    expect(screen.getByRole('heading', { level: 2, name: '訪問条件・連絡制約' }).tagName).toBe(
      'H2',
    );
    expect(screen.getAllByText('月').length).toBeGreaterThan(0);
    expect(screen.getAllByText('水').length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue('山田花子')).toBeTruthy();
    expect(screen.getByRole('button', { name: '保存' })).toBeTruthy();
  });

  it('shows an error state instead of an empty editable form when constraints fail to load', () => {
    const refetch = vi.fn();
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    render(<VisitConstraintsCard patientId="patient_1" orgId="org_1" />);

    expect(screen.getByText('取得できません')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '訪問条件を表示できません' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '再試行' })).toBeTruthy();
    expect(screen.queryByText('曜日希望は未設定です')).toBeNull();
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
