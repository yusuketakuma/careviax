// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { buildPatientHref } from '@/lib/patient/navigation';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const patientFormMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('@/components/features/patients/patient-form', () => ({
  PatientForm: (props: unknown) => {
    patientFormMock(props);
    return <div>patient form</div>;
  },
}));

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return { ...actual, buildPatientApiPath: vi.fn(actual.buildPatientApiPath) };
});

vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});

import { PatientEditContent } from './patient-edit-content';

setupDomTestEnv();

describe('PatientEditContent patient overview fetch', () => {
  it('shows a patient-edit skeleton instead of a generic spinner while loading', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    render(<PatientEditContent patientId="patient_1" />);

    expect(screen.getByRole('status', { name: '患者編集フォームを読み込み中' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByText('読み込み中...', { selector: 'p' })).toBeNull();
    expect(screen.queryByText('patient form')).toBeNull();
    expect(patientFormMock).not.toHaveBeenCalled();
  });

  it('routes patient overview reads through the shared patient API path helper', async () => {
    const patientId = 'patient_1';
    vi.mocked(buildPatientApiPath).mockReturnValueOnce(
      '/api/patients/__helper_patient_1__/overview',
    );
    useOrgIdMock.mockReturnValue('org_1');

    let captured: { queryKey: unknown[]; queryFn: () => Promise<unknown> } | undefined;
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
        captured = config;
        return { data: undefined, isLoading: true, error: null };
      },
    );

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientEditContent patientId={patientId} />);

      expect(captured?.queryKey).toEqual(['patient-overview', patientId, 'org_1']);
      expect(captured).toMatchObject({
        enabled: true,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
      });

      await captured?.queryFn?.();

      expect(buildPatientApiPath).toHaveBeenCalledWith(patientId, '/overview');
      expect(fetchMock).toHaveBeenCalledWith('/api/patients/__helper_patient_1__/overview', {
        headers: { 'x-org-id': 'org_1' },
      });
      expect(fetchMock).not.toHaveBeenCalledWith(`/api/patients/${patientId}/overview`, {
        headers: { 'x-org-id': 'org_1' },
      });
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('routes the successful edit redirect through the shared patient href helper', () => {
    const patientId = 'patient_1';
    vi.mocked(buildPatientHref).mockReturnValueOnce('/patients/__helper_patient_1__');
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({
      data: {
        name: '患者',
        name_kana: 'カンジャ',
        birth_date: '1980-01-01T00:00:00.000Z',
        gender: 'male',
        phone: null,
        medical_insurance_number: null,
        care_insurance_number: null,
        billing_support_flag: false,
        allergy_info: null,
        notes: null,
        updated_at: '2026-03-30T09:00:00.000Z',
        primary_pharmacist_id: null,
        backup_pharmacist_id: null,
        primary_staff_id: null,
        backup_staff_id: null,
        residences: [],
        cases: [],
        scheduling_preference: null,
      },
      isLoading: false,
      error: null,
    });

    render(<PatientEditContent patientId={patientId} />);

    expect(buildPatientHref).toHaveBeenCalledWith(patientId);
    expect(patientFormMock).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId,
        redirectTo: '/patients/__helper_patient_1__',
        expectedUpdatedAt: '2026-03-30T09:00:00.000Z',
      }),
    );
    expect(patientFormMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        redirectTo: `/patients/${patientId}`,
      }),
    );
  });

  it('keeps hostile patient ids encoded in the URL path segment only', async () => {
    const hostileId = 'pt/1?x=y#z';
    useOrgIdMock.mockReturnValue('org_1');

    let captured: { queryKey: unknown[]; queryFn: () => Promise<unknown> } | undefined;
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
        captured = config;
        return { data: undefined, isLoading: true, error: null };
      },
    );

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientEditContent patientId={hostileId} />);

      expect(captured?.queryKey).toEqual(['patient-overview', hostileId, 'org_1']);

      await captured?.queryFn?.();

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/patients/${encodeURIComponent(hostileId)}/overview`);
      expect(url).not.toContain('?x=y');
      expect(url).not.toContain('#z');
      expect(url).not.toContain('%25');
      expect(init.headers).toEqual({ 'x-org-id': 'org_1' });
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it.each(['.', '..'])(
    'fails closed without fetching for exact dot-segment patientId %p',
    async (dotId) => {
      useOrgIdMock.mockReturnValue('org_1');

      let captured: { queryKey: unknown[]; queryFn: () => Promise<unknown> } | undefined;
      useQueryMock.mockImplementation(
        (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
          captured = config;
          return { data: undefined, isLoading: true, error: null };
        },
      );

      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);

      try {
        render(<PatientEditContent patientId={dotId} />);
        await expect(captured?.queryFn?.()).rejects.toThrow(RangeError);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
      }
    },
  );
});
