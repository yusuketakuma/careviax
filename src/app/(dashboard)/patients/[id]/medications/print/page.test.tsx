// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { buildPatientHref } from '@/lib/patient/navigation';
import MedicationPrintPage from './page';

setupDomTestEnv();

const useParamsMock = vi.hoisted(() => vi.fn());
const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useParams: useParamsMock,
}));

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

vi.mock('@/components/features/reports/print-layout', () => ({
  PrintLayout: ({ children }: { children: React.ReactNode }) => (
    <main data-testid="print-layout">{children}</main>
  ),
}));

vi.mock('@/components/features/workflow/print-page-toolbar', () => ({
  PrintPageToolbar: ({ backHref, backLabel }: { backHref: string; backLabel: string }) => (
    <a href={backHref}>{backLabel}</a>
  ),
}));

vi.mock('@/components/features/workflow/page-shortcut-presets', () => ({
  getPatientMedicationPrintShortcutLinks: vi.fn(() => []),
}));

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return { ...actual, buildPatientApiPath: vi.fn(actual.buildPatientApiPath) };
});

vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});

type QueryConfig = {
  queryKey: unknown[];
  queryFn: () => Promise<unknown>;
};

const patientSnapshot = {
  id: 'patient_1',
  name: '佐藤 花子',
  name_kana: 'サトウ ハナコ',
  birth_date: '1940-01-01',
};

function setRoute(patientId = 'patient_1') {
  useParamsMock.mockReturnValue({ id: patientId });
  useOrgIdMock.mockReturnValue('org_1');
}

function mockReady(patientId = 'patient_1') {
  setRoute(patientId);
  useQueryMock.mockImplementation(({ queryKey }: QueryConfig) => {
    if (queryKey[0] === 'me-org') {
      return { data: { name: '青葉薬局' }, isLoading: false, error: null };
    }
    if (queryKey[0] === 'patient-print') {
      return { data: { ...patientSnapshot, id: patientId }, isLoading: false, error: null };
    }
    return { data: { data: [] }, isLoading: false, error: null };
  });
}

describe('MedicationPrintPage', () => {
  it('builds patient and medication fetch URLs through shared/encoded URL boundaries', async () => {
    const hostilePatientId = 'pt/1?x=y#z&limit=999';
    setRoute(hostilePatientId);
    vi.mocked(buildPatientApiPath).mockReturnValueOnce('/api/patients/__helper_print__');

    const captured = new Map<string, QueryConfig>();
    useQueryMock.mockImplementation((config: QueryConfig) => {
      captured.set(String(config.queryKey[0]), config);
      return { data: undefined, isLoading: true, error: null };
    });

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<MedicationPrintPage />);

      expect(captured.get('patient-print')?.queryKey).toEqual([
        'patient-print',
        hostilePatientId,
        'org_1',
      ]);

      await captured.get('patient-print')?.queryFn();
      expect(buildPatientApiPath).toHaveBeenCalledWith(hostilePatientId);
      expect(fetchMock).toHaveBeenCalledWith('/api/patients/__helper_print__', {
        headers: { 'x-org-id': 'org_1' },
        cache: 'no-store',
      });
      expect(fetchMock).not.toHaveBeenCalledWith(
        `/api/patients/${hostilePatientId}`,
        expect.anything(),
      );

      fetchMock.mockClear();
      await captured.get('medication-print')?.queryFn();
      const [medicationUrl, medicationInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      const params = new URLSearchParams(medicationUrl.split('?')[1]);
      expect(medicationUrl.startsWith('/api/medication-profiles?')).toBe(true);
      expect(params.get('patient_id')).toBe(hostilePatientId);
      expect(params.get('is_current')).toBe('true');
      expect(params.getAll('limit')).toEqual(['200']);
      expect((medicationInit.headers as Record<string, string>)['x-org-id']).toBe('org_1');
      expect(medicationInit.cache).toBe('no-store');
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('routes the toolbar back link through the shared patient href helper', () => {
    const patientId = 'pt/1?x=y#z';
    mockReady(patientId);
    vi.mocked(buildPatientHref).mockReturnValueOnce('/patients/__helper_medications__');
    Object.defineProperty(window, 'print', { configurable: true, value: vi.fn() });

    render(<MedicationPrintPage />);

    expect(buildPatientHref).toHaveBeenCalledWith(patientId, '/medications');
    expect(screen.getByRole('link', { name: '服薬管理へ戻る' }).getAttribute('href')).toBe(
      '/patients/__helper_medications__',
    );
  });

  it('routes the error back link through the shared patient href helper', () => {
    const patientId = 'pt/1?x=y#z';
    setRoute(patientId);
    vi.mocked(buildPatientHref).mockReturnValueOnce('/patients/__helper_error__');
    useQueryMock.mockImplementation(({ queryKey }: QueryConfig) => {
      if (queryKey[0] === 'me-org') {
        return { data: { name: '青葉薬局' }, isLoading: false, error: null };
      }
      if (queryKey[0] === 'patient-print') {
        return { data: undefined, isLoading: false, error: new Error('failed') };
      }
      return { data: { data: [] }, isLoading: false, error: null };
    });

    render(<MedicationPrintPage />);

    expect(buildPatientHref).toHaveBeenCalledWith(patientId, '/medications');
    expect(screen.getByRole('link', { name: '戻る' }).getAttribute('href')).toBe(
      '/patients/__helper_error__',
    );
  });
});
