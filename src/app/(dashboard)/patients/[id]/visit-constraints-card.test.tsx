// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';

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

type CapturedConfig = {
  queryKey?: unknown[];
  queryFn?: () => Promise<unknown>;
  mutationFn?: () => Promise<unknown>;
  onSuccess?: () => Promise<void> | void;
};

const VISIT_CONSTRAINTS_RESPONSE = {
  data: {
    scheduling_preference: {
      preferred_weekdays: [1, 3],
      preferred_time_from: '2026-06-01T09:00:00.000Z',
      preferred_time_to: '2026-06-01T11:00:00.000Z',
      phone_contact_from: '2026-06-01T13:00:00.000Z',
      phone_contact_to: '2026-06-01T16:00:00.000Z',
      facility_time_from: '2026-06-01T08:30:00.000Z',
      facility_time_to: '2026-06-01T12:30:00.000Z',
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
};

function captureConfigs() {
  const invalidateQueries = vi.fn();
  const queryConfigs: CapturedConfig[] = [];
  const mutationConfigs: CapturedConfig[] = [];
  useQueryClientMock.mockReturnValue({ invalidateQueries });
  useQueryMock.mockImplementation((config: CapturedConfig) => {
    queryConfigs.push(config);
    return { data: VISIT_CONSTRAINTS_RESPONSE, isLoading: false, isError: false };
  });
  useMutationMock.mockImplementation((config: CapturedConfig) => {
    mutationConfigs.push(config);
    return { mutate: vi.fn(), isPending: false };
  });
  return { invalidateQueries, mutationConfigs, queryConfigs };
}

function okFetch() {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('VisitConstraintsCard', () => {
  it('renders visit constraints with a semantic section heading and shared action row', () => {
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockReturnValue({
      data: VISIT_CONSTRAINTS_RESPONSE,
      isLoading: false,
    });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    render(<VisitConstraintsCard patientId="patient_1" orgId="org_1" />);

    expect(screen.getByRole('heading', { level: 2, name: '訪問条件・連絡制約' }).tagName).toBe(
      'H2',
    );
    expect(screen.getAllByText('月').length).toBeGreaterThan(0);
    expect(screen.getAllByText('水').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('訪問希望時間帯 開始')).toBeTruthy();
    expect(screen.getByLabelText('訪問希望時間帯 終了')).toBeTruthy();
    expect(screen.getByLabelText('電話連絡可能時間 開始')).toBeTruthy();
    expect(screen.getByLabelText('電話連絡可能時間 終了')).toBeTruthy();
    expect(screen.getByLabelText('施設受入時間 開始')).toBeTruthy();
    expect(screen.getByLabelText('施設受入時間 終了')).toBeTruthy();
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

  it('fetches visit constraints from an encoded patient path with org headers and a raw query key', async () => {
    const hostileId = 'pt/1?x=y#z';
    const { queryConfigs } = captureConfigs();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    render(<VisitConstraintsCard patientId={hostileId} orgId="org_1" />);

    expect(queryConfigs[0]?.queryKey).toEqual(['visit-constraints', 'org_1', hostileId]);
    await queryConfigs[0]?.queryFn?.();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/patients/${encodeURIComponent(hostileId)}/visit-constraints`);
    expect(url).not.toContain('?x=y');
    expect(url).not.toContain('#z');
    expect(url).not.toContain('%25');
    expect(init.headers).toEqual(buildOrgHeaders('org_1'));
  });

  it('saves visit constraints to an encoded patient path with JSON org headers and an exact raw body', async () => {
    const hostileId = 'pt/1?x=y#z';
    const { mutationConfigs } = captureConfigs();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    render(<VisitConstraintsCard patientId={hostileId} orgId="org_1" />);

    await mutationConfigs[0]?.mutationFn?.();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/patients/${encodeURIComponent(hostileId)}/visit-constraints`);
    expect(url).not.toContain('?x=y');
    expect(url).not.toContain('#z');
    expect(url).not.toContain('%25');
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual(buildOrgJsonHeaders('org_1'));
    const body = init.body as string;
    expect(body).not.toContain(hostileId);
    expect(JSON.parse(body)).toEqual({
      preferred_weekdays: [1, 3],
      preferred_time_from: '09:00',
      preferred_time_to: '11:00',
      phone_contact_from: '13:00',
      phone_contact_to: '16:00',
      facility_time_from: '08:30',
      facility_time_to: '12:30',
      family_presence_required: true,
      visit_buffer_minutes: 15,
      preferred_contact_name: '山田花子',
      preferred_contact_phone: '090-0000-0000',
      notes: '玄関で電話',
      residence_lat: 35.1,
      residence_lng: 139.1,
      geocode_status: 'verified',
      geocode_source: 'manual',
      geocode_accuracy: 'rooftop',
    });
  });

  it('invalidates visit constraint caches with the raw patient id after save', async () => {
    const hostileId = 'pt/1?x=y#z';
    const { invalidateQueries, mutationConfigs } = captureConfigs();

    render(<VisitConstraintsCard patientId={hostileId} orgId="org_1" />);

    await mutationConfigs[0]?.onSuccess?.();

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['visit-constraints', 'org_1', hostileId],
    });
    expect(
      invalidateQueries.mock.calls.some((args) =>
        JSON.stringify(args[0]).includes(encodeURIComponent(hostileId)),
      ),
    ).toBe(false);
  });

  it.each(['.', '..'])(
    'fails closed without fetching for exact dot-segment patientId %p',
    async (dotId) => {
      const { mutationConfigs, queryConfigs } = captureConfigs();
      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);

      render(<VisitConstraintsCard patientId={dotId} orgId="org_1" />);

      await expect(queryConfigs[0]?.queryFn?.()).rejects.toThrow(RangeError);
      await expect(mutationConfigs[0]?.mutationFn?.()).rejects.toThrow(RangeError);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
