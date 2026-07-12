// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { buildPatientHref } from '@/lib/patient/navigation';
import { jsonResponse } from '@/test/fetch-test-utils';
import { CompareBoard } from './compare-board';
import type { PatientOverview } from '../[id]/patient-detail.types';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useQueriesMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useQueries: useQueriesMock,
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
  enabled?: boolean;
};

const overview = {
  id: 'patient_1',
  name: '佐藤 花子',
  workspace: null,
} as PatientOverview;

function buildOverviewPayload() {
  return {
    id: 'patient_1',
    name: '佐藤 花子',
    unused_sensitive_field: 'must-not-enter-compare-cache',
    workspace: {
      overall_status: 'dispensed',
      exception_status: null,
      action_context: {
        patient_id: 'patient_1',
        prescription_intake_id: 'intake_1',
        visit_schedule_id: null,
        visit_record_id: null,
        report_id: null,
      },
      current_intake: {
        id: 'intake_1',
        prescribed_date: '2026-07-12T00:00:00.000Z',
        prescription_category: 'regular',
        unused_prescriber: 'must-not-enter-compare-cache',
      },
      today_tasks: [
        {
          time_label: '期限 12:00',
          label: '調剤監査',
          due_time: '12:00',
          unused_href: '/audit',
        },
      ],
      open_exceptions: [
        {
          id: 'exception_1',
          description: '監査待ち',
          severity: 'warning',
          unused_type: 'audit_pending',
        },
      ],
      previous_medication: {
        start: '2026-06-01T00:00:00.000Z',
        end: '2026-06-30T00:00:00.000Z',
      },
      current_medication: {
        start: '2026-07-01T00:00:00.000Z',
        end: '2026-07-31T00:00:00.000Z',
      },
      unused_safety: { allergy: 'must-not-enter-compare-cache' },
    },
  };
}

function mockBoard() {
  useOrgIdMock.mockReturnValue('org_1');
  useQueryMock.mockReturnValue({
    data: { cards: [] },
    isLoading: false,
    error: null,
  });
}

describe('CompareBoard', () => {
  it('retains only the patient overview fields consumed by comparison cards', async () => {
    mockBoard();
    let capturedQueries: QueryConfig[] = [];
    useQueriesMock.mockImplementation(({ queries }: { queries: QueryConfig[] }) => {
      capturedQueries = queries;
      return queries.map(() => ({ data: undefined, isLoading: true, error: null }));
    });
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: buildOverviewPayload() })),
    );

    try {
      render(<CompareBoard requestedPatientIds={['patient_1']} />);

      await expect(capturedQueries[0]?.queryFn()).resolves.toEqual({
        id: 'patient_1',
        name: '佐藤 花子',
        workspace: {
          overall_status: 'dispensed',
          exception_status: null,
          action_context: {
            patient_id: 'patient_1',
            prescription_intake_id: 'intake_1',
            visit_schedule_id: null,
            visit_record_id: null,
            report_id: null,
          },
          current_intake: {
            id: 'intake_1',
            prescribed_date: '2026-07-12T00:00:00.000Z',
            prescription_category: 'regular',
          },
          today_tasks: [{ time_label: '期限 12:00', label: '調剤監査', due_time: '12:00' }],
          open_exceptions: [{ id: 'exception_1', description: '監査待ち', severity: 'warning' }],
          previous_medication: {
            start: '2026-06-01T00:00:00.000Z',
            end: '2026-06-30T00:00:00.000Z',
          },
          current_medication: {
            start: '2026-07-01T00:00:00.000Z',
            end: '2026-07-31T00:00:00.000Z',
          },
        },
      });
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it.each([
    [
      'mixed root fields',
      () => ({ data: buildOverviewPayload(), legacy_patient: buildOverviewPayload() }),
    ],
    [
      'patient-mismatched workspace context',
      () => {
        const payload = buildOverviewPayload();
        payload.workspace.action_context.patient_id = 'another_patient';
        return { data: payload };
      },
    ],
    [
      'unexpected overview patient',
      () => {
        const payload = buildOverviewPayload();
        payload.id = 'another_patient';
        payload.workspace.action_context.patient_id = 'another_patient';
        return { data: payload };
      },
    ],
    [
      'invalid prescription timestamp',
      () => {
        const payload = buildOverviewPayload();
        payload.workspace.current_intake.prescribed_date = 'not-a-timestamp';
        return { data: payload };
      },
    ],
    [
      'unknown exception severity',
      () => {
        const payload = buildOverviewPayload();
        payload.workspace.open_exceptions[0] = {
          ...payload.workspace.open_exceptions[0],
          severity: 'unknown',
        };
        return { data: payload };
      },
    ],
  ])('rejects malformed compare overview 2xx payloads: %s', async (_label, buildPayload) => {
    mockBoard();
    let capturedQueries: QueryConfig[] = [];
    useQueriesMock.mockImplementation(({ queries }: { queries: QueryConfig[] }) => {
      capturedQueries = queries;
      return queries.map(() => ({ data: undefined, isLoading: true, error: null }));
    });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(buildPayload())));

    try {
      render(<CompareBoard requestedPatientIds={['patient_1']} />);

      await expect(capturedQueries[0]?.queryFn()).rejects.toThrow('患者情報の取得に失敗しました');
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('routes patient overview fetches through the shared patient API path helper', async () => {
    const patientId = 'pt/1?x=y#z';
    mockBoard();
    vi.mocked(buildPatientApiPath).mockReturnValueOnce('/api/patients/__helper_overview__');

    let capturedQueries: QueryConfig[] = [];
    useQueriesMock.mockImplementation(({ queries }: { queries: QueryConfig[] }) => {
      capturedQueries = queries;
      return queries.map(() => ({ data: undefined, isLoading: true, error: null }));
    });

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: { ...overview, id: patientId } }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<CompareBoard requestedPatientIds={[patientId]} />);

      expect(capturedQueries[0]?.queryKey).toEqual(['patient-overview', patientId, 'org_1']);
      await capturedQueries[0]?.queryFn();

      expect(buildPatientApiPath).toHaveBeenCalledWith(patientId, '/overview');
      expect(fetchMock).toHaveBeenCalledWith('/api/patients/__helper_overview__', {
        headers: { 'x-org-id': 'org_1' },
      });
      expect(fetchMock).not.toHaveBeenCalledWith(
        `/api/patients/${patientId}/overview`,
        expect.anything(),
      );
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('keeps API messages from failed patient overview fetches', async () => {
    mockBoard();

    let capturedQueries: QueryConfig[] = [];
    useQueriesMock.mockImplementation(({ queries }: { queries: QueryConfig[] }) => {
      capturedQueries = queries;
      return queries.map(() => ({ data: undefined, isLoading: true, error: null }));
    });

    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ message: '比較用患者情報APIからの詳細エラー' }, 500)),
    );

    try {
      render(<CompareBoard requestedPatientIds={['patient_1']} />);

      await expect(capturedQueries[0]?.queryFn()).rejects.toThrow(
        '比較用患者情報APIからの詳細エラー',
      );
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('routes compare card open links through the shared patient href helper', () => {
    const patientId = 'pt/1?x=y#z';
    mockBoard();
    vi.mocked(buildPatientHref).mockReturnValueOnce('/patients/__helper_compare__');
    useQueriesMock.mockReturnValue([{ data: overview, isLoading: false, error: null }]);

    render(<CompareBoard requestedPatientIds={[patientId]} />);

    expect(buildPatientHref).toHaveBeenCalledWith(patientId);
    expect(screen.getByTestId('compare-card-open').getAttribute('href')).toBe(
      '/patients/__helper_compare__',
    );
  });
});
