// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildPatientHref } from '@/lib/patient/navigation';
import { buildVisitHref, buildVisitRecordHref } from '@/lib/visits/navigation';
import { PatientVisitsPanel } from './patient-visits-panel';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('@/components/home-care/home-care-feature-board', () => ({
  HomeCareFeatureBoard: () => <div>訪問支援サマリー</div>,
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

// Actual-backed spies: keep the real encode/guard output for the hostile id and
// dot-segment assertions, and add return-value delegation teeth for the nav helpers.
vi.mock('@/lib/visits/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/visits/navigation')>();
  return {
    ...actual,
    buildVisitHref: vi.fn(actual.buildVisitHref),
    buildVisitRecordHref: vi.fn(actual.buildVisitRecordHref),
  };
});

vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});

function mockVisitQueries() {
  useOrgIdMock.mockReturnValue('org_1');
  useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === 'patient-visits-panel') {
      return { data: visitsSnapshot, isLoading: false, error: null };
    }
    return { data: { data: visitsSnapshot.visit_records }, isLoading: false, error: null };
  });
}

const visitsSnapshot = {
  monthly_visit_count: 2,
  visit_schedules: [
    {
      id: 'schedule_1',
      scheduled_date: '2026-04-10T00:00:00.000Z',
      schedule_status: 'completed',
      priority: 'normal',
      confirmed_at: '2026-04-09T10:00:00.000Z',
      route_order: 1,
      visit_record: {
        id: 'record_1',
        outcome_status: 'completed',
      },
    },
    {
      id: 'schedule_2',
      scheduled_date: '2026-04-11T00:00:00.000Z',
      schedule_status: 'ready',
      priority: 'urgent',
      confirmed_at: null,
      route_order: null,
      visit_record: null,
    },
  ],
  visit_records: [
    {
      id: 'record_1',
      schedule_id: 'schedule_1',
      visit_date: '2026-04-10T10:00:00.000Z',
      outcome_status: 'completed',
      next_visit_suggestion_date: null,
      cancellation_reason: null,
      postpone_reason: null,
      revisit_reason: null,
      created_at: '2026-04-10T10:30:00.000Z',
    },
  ],
  home_care_feature_summary: {},
};

describe('PatientVisitsPanel', () => {
  it('separates schedule-board links from visit-record links', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === 'patient-visits-panel') {
        return {
          data: visitsSnapshot,
          isLoading: false,
          error: null,
        };
      }

      return {
        data: { data: visitsSnapshot.visit_records },
        isLoading: false,
        error: null,
      };
    });

    render(
      <PatientVisitsPanel
        patientId="patient_1"
        medicalInsuranceNumber="medical_1"
        careInsuranceNumber={null}
        enabled
      />,
    );

    expect(
      screen.getAllByRole('link', { name: '2026年4月10日(金)' })[0]?.getAttribute('href'),
    ).toBe('/schedules?date=2026-04-10&tab=confirmed&schedule=schedule_1#schedule-schedule_1');
    expect(screen.getAllByRole('link', { name: '記録詳細' })[0]?.getAttribute('href')).toBe(
      '/visits/record_1',
    );
    expect(screen.getByRole('link', { name: '訪問記録入力' }).getAttribute('href')).toBe(
      '/visits/schedule_2/record',
    );
    expect(screen.getByText('完了')).toBeTruthy();
    expect(screen.getByText('至急')).toBeTruthy();
  });

  it('routes record/print links through the nav helper return values', () => {
    mockVisitQueries();

    const realVisitHref = vi.mocked(buildVisitHref).getMockImplementation();
    const realVisitRecordHref = vi.mocked(buildVisitRecordHref).getMockImplementation();
    const realPatientHref = vi.mocked(buildPatientHref).getMockImplementation();

    vi.mocked(buildVisitHref).mockImplementation(
      (id: string, suffix = '') => `/v__${id}__${suffix}`,
    );
    vi.mocked(buildVisitRecordHref).mockImplementation((id: string) => `/vr__${id}__`);
    vi.mocked(buildPatientHref).mockImplementation(
      (id: string, suffix = '') => `/p__${id}__${suffix}`,
    );
    vi.mocked(buildVisitHref).mockClear();
    vi.mocked(buildVisitRecordHref).mockClear();
    vi.mocked(buildPatientHref).mockClear();

    try {
      render(
        <PatientVisitsPanel
          patientId="patient_1"
          medicalInsuranceNumber="medical_1"
          careInsuranceNumber={null}
          enabled
        />,
      );

      // 記録詳細 (existing visit_record) -> buildVisitHref(record id)
      expect(screen.getAllByRole('link', { name: '記録詳細' })[0]?.getAttribute('href')).toBe(
        '/v__record_1__',
      );
      // 訪問記録入力 (no visit_record) -> buildVisitRecordHref(schedule id)
      expect(screen.getByRole('link', { name: '訪問記録入力' }).getAttribute('href')).toBe(
        '/vr__schedule_2__',
      );
      // 記録一覧の日付 Link -> buildVisitHref(record id)
      expect(
        screen.getAllByRole('link', { name: '2026年4月10日(金)' })[1]?.getAttribute('href'),
      ).toBe('/v__record_1__');
      // 印刷 link -> buildPatientHref(patientId, '/visit-records/print')
      expect(screen.getByRole('link', { name: '印刷' }).getAttribute('href')).toBe(
        '/p__patient_1__/visit-records/print',
      );

      expect(vi.mocked(buildVisitRecordHref).mock.calls).toContainEqual(['schedule_2']);
      expect(vi.mocked(buildVisitHref).mock.calls).toContainEqual(['record_1']);
      expect(vi.mocked(buildPatientHref).mock.calls).toContainEqual([
        'patient_1',
        '/visit-records/print',
      ]);
    } finally {
      if (realVisitHref) vi.mocked(buildVisitHref).mockImplementation(realVisitHref);
      if (realVisitRecordHref) {
        vi.mocked(buildVisitRecordHref).mockImplementation(realVisitRecordHref);
      }
      if (realPatientHref) vi.mocked(buildPatientHref).mockImplementation(realPatientHref);
      vi.clearAllMocks();
    }
  });

  it('builds the visits fetch URL with an encoded hostile patientId and org header', async () => {
    const hostileId = 'pt/1?x=y#z';
    useOrgIdMock.mockReturnValue('org_1');

    let capturedConfig: { queryKey: unknown[]; queryFn: () => Promise<unknown> } | undefined;
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
        if (Array.isArray(config.queryKey) && config.queryKey[0] === 'patient-visits-panel') {
          capturedConfig = config;
        }
        if (config.queryKey[0] === 'patient-visits-panel') {
          return { data: visitsSnapshot, isLoading: false, error: null };
        }
        return { data: { data: visitsSnapshot.visit_records }, isLoading: false, error: null };
      },
    );

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(visitsSnapshot),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(
        <PatientVisitsPanel
          patientId={hostileId}
          medicalInsuranceNumber="medical_1"
          careInsuranceNumber={null}
          enabled
        />,
      );

      // raw patientId is preserved in the cache key (not encoded)
      expect(capturedConfig?.queryKey).toEqual(['patient-visits-panel', hostileId, 'org_1']);

      await capturedConfig?.queryFn();

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/patients/${encodeURIComponent(hostileId)}/visits`);
      expect(url).not.toContain('?x=y');
      expect(url).not.toContain('#z');
      expect((init.headers as Record<string, string>)['x-org-id']).toBe('org_1');
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it.each(['.', '..'])(
    'fails closed with RangeError for exact dot-segment patientId %p',
    (dotId) => {
      mockVisitQueries();
      expect(() =>
        render(
          <PatientVisitsPanel
            patientId={dotId}
            medicalInsuranceNumber="medical_1"
            careInsuranceNumber={null}
            enabled
          />,
        ),
      ).toThrow(RangeError);
    },
  );

  it('encodes the hostile patientId into the PDF export anchor without leaking raw input', () => {
    const hostileId = 'pt/1?x=y#z';
    mockVisitQueries();

    render(
      <PatientVisitsPanel
        patientId={hostileId}
        medicalInsuranceNumber="medical_1"
        careInsuranceNumber={null}
        enabled
      />,
    );

    const exportLink = screen.getByRole('link', { name: 'PDF' });
    const href = exportLink.getAttribute('href') ?? '';
    expect(href).toBe(`/api/patients/${encodeURIComponent(hostileId)}/visit-records/pdf`);
    expect(href).not.toContain(hostileId);
    expect(href).not.toContain('?x=y');
    expect(href).not.toContain('#z');
    // raw id passed to the helper (not pre-encoded) -> no double-encode.
    expect(href).not.toContain('%25');
  });

  it('renders 44px-tall date filter inputs for touch accessibility', () => {
    mockVisitQueries();

    render(
      <PatientVisitsPanel
        patientId="patient_1"
        medicalInsuranceNumber="medical_1"
        careInsuranceNumber={null}
        enabled
      />,
    );

    expect(screen.getByLabelText('開始日').className).toContain('min-h-[44px]');
    expect(screen.getByLabelText('終了日').className).toContain('min-h-[44px]');
  });
});
