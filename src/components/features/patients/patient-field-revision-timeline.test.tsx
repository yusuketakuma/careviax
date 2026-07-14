// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { PatientFieldRevisionTimeline } from './patient-field-revision-timeline';
import {
  createPatientFieldRevisionTimelineResponseSchema,
  patientFieldRevisionPresentationItemSchema,
} from './patient-field-revision-timeline-response-schema';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return { ...actual, buildPatientApiPath: vi.fn(actual.buildPatientApiPath) };
});

function revisionMeta(category: string | null, visibleCount = 0, hiddenCount = 0) {
  return {
    total_count: visibleCount + hiddenCount,
    visible_count: visibleCount,
    hidden_count: hiddenCount,
    truncated: hiddenCount > 0,
    count_basis: 'patient_field_revisions',
    filters_applied: { category },
    sort_basis: 'created_at_desc',
    selection_basis: 'latest_created_at_desc_id_desc',
    presentation_order: 'created_at_asc_id_asc',
    limit: 50,
  };
}

function revisionItem(id: string, createdAt: string) {
  return {
    id,
    category: 'basic' as const,
    field_key: 'gender',
    field_label: '性別',
    value_label: 'male → female',
    previous: 'male',
    current: 'female',
    source: 'patient_detail_edit',
    source_visit_record_id: null,
    change_reason: null,
    importance: 'normal' as const,
    confirmed_by_name: null,
    confirmed_at: null,
    valid_from: '2026-06-16T00:00:00.000Z',
    valid_to: null,
    is_current: true,
    updated_by_name: '田中',
    created_at: createdAt,
  };
}

describe('PatientFieldRevisionTimeline', () => {
  it('accepts the longest server-generated exact scalar label', () => {
    const previous = 'a'.repeat(5_000);
    const current = 'b'.repeat(5_000);

    expect(
      patientFieldRevisionPresentationItemSchema.safeParse({
        id: 'rev_long_scalar',
        category: 'basic',
        field_key: 'notes',
        field_label: '備考',
        value_label: `${previous} → ${current}`,
        previous,
        current,
        source: 'patient_detail_edit',
        source_visit_record_id: null,
        change_reason: null,
        importance: 'normal',
        confirmed_by_name: null,
        confirmed_at: null,
        valid_from: '2026-06-16T00:00:00.000Z',
        valid_to: null,
        is_current: true,
        updated_by_name: '田中',
        created_at: '2026-06-16T01:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('accepts chronological identity order and rejects reversed timestamps or equal-time identities', () => {
    const schema = createPatientFieldRevisionTimelineResponseSchema(null);
    const earlier = revisionItem('rev_a', '2026-06-16T01:00:00.000Z');
    const later = revisionItem('rev_b', '2026-06-17T01:00:00.000Z');
    const equalTimeB = revisionItem('rev_b', earlier.created_at);

    expect(schema.safeParse({ data: [earlier, later], meta: revisionMeta(null, 2) }).success).toBe(
      true,
    );
    expect(schema.safeParse({ data: [later, earlier], meta: revisionMeta(null, 2) }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ data: [equalTimeB, earlier], meta: revisionMeta(null, 2) }).success,
    ).toBe(false);
  });

  it('renders a PH-OS skeleton while field revisions load', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    render(<PatientFieldRevisionTimeline patientId="patient_1" />);

    expect(screen.getByRole('status', { name: '変更履歴を読み込み中' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByText('変更履歴はまだありません。')).toBeNull();
    expect(screen.queryByText('変更履歴を取得できませんでした。')).toBeNull();
  });

  it('shows hidden count metadata when the revision list is truncated', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({
      data: {
        data: [
          {
            id: 'rev_1',
            category: 'basic',
            field_key: 'gender',
            field_label: '性別',
            value_label: 'male → female',
            previous: 'male',
            current: 'female',
            source: 'patient_detail_edit',
            source_visit_record_id: null,
            change_reason: null,
            importance: 'normal',
            confirmed_by: null,
            confirmed_by_name: null,
            confirmed_at: null,
            valid_from: '2026-06-16T00:00:00.000Z',
            valid_to: null,
            is_current: true,
            updated_by: 'user_u',
            updated_by_name: '田中',
            created_at: '2026-06-16T01:00:00.000Z',
          },
        ],
        meta: {
          total_count: 4,
          visible_count: 1,
          hidden_count: 3,
          truncated: true,
          count_basis: 'patient_field_revisions',
          filters_applied: { category: null },
          sort_basis: 'created_at_desc',
          selection_basis: 'latest_created_at_desc_id_desc',
          presentation_order: 'created_at_asc_id_asc',
          limit: 1,
        },
      },
      isLoading: false,
      error: null,
    });

    render(<PatientFieldRevisionTimeline patientId="patient_1" />);

    expect(screen.getByText('直近1件を過去から現在の順で表示 / それ以前3件')).toBeTruthy();
    expect(screen.getByText('性別')).toBeTruthy();
    expect(
      screen.getByTestId('patient-field-revision-current-terminus').getAttribute('aria-current'),
    ).toBe('time');
  });

  it('routes field revision fetches through the shared patient API path helper', async () => {
    const patientId = 'pt/1?tab=x#frag';
    vi.mocked(buildPatientApiPath).mockReturnValueOnce(
      '/api/patients/__helper_pt__/field-revisions',
    );
    useOrgIdMock.mockReturnValue('org_1');

    const capturedQueries: Array<{ queryKey: unknown[]; queryFn: () => Promise<unknown> }> = [];
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
        capturedQueries.push(config);
        return { data: { data: [] }, isLoading: false, error: null };
      },
    );

    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ data: [], meta: revisionMeta('basic') })),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientFieldRevisionTimeline patientId={patientId} />);
      const basicFilter = screen.getByRole('button', { name: '基本情報' });
      expect(basicFilter.className).toContain('min-h-[44px]');
      expect(basicFilter.getAttribute('aria-pressed')).toBe('false');
      fireEvent.click(basicFilter);
      expect(basicFilter.getAttribute('aria-pressed')).toBe('true');

      const latestQuery = capturedQueries.at(-1);
      expect(latestQuery?.queryKey).toEqual([
        'patient-field-revisions',
        patientId,
        'org_1',
        'basic',
      ]);

      await latestQuery?.queryFn();

      expect(buildPatientApiPath).toHaveBeenCalledWith(patientId, '/field-revisions');
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/patients/__helper_pt__/field-revisions?category=basic',
        {
          headers: { 'x-org-id': 'org_1' },
        },
      );
      expect(fetchMock).not.toHaveBeenCalledWith(
        `/api/patients/${patientId}/field-revisions?category=basic`,
        expect.anything(),
      );
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('surfaces API messages from failed field revision read queries', async () => {
    useOrgIdMock.mockReturnValue('org_1');

    let capturedQuery: { queryFn: () => Promise<unknown> } | undefined;
    useQueryMock.mockImplementation((config: { queryFn: () => Promise<unknown> }) => {
      capturedQuery = config;
      return { data: { data: [] }, isLoading: false, error: null };
    });

    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ message: '変更履歴の閲覧権限がありません' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientFieldRevisionTimeline patientId="patient_1" />);
      await expect(capturedQuery?.queryFn()).rejects.toThrow('変更履歴の閲覧権限がありません');
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('validates exact field revision data and strips provider-only fields before caching', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    let capturedQuery: { queryFn: () => Promise<unknown> } | undefined;
    useQueryMock.mockImplementation((config: { queryFn: () => Promise<unknown> }) => {
      capturedQuery = config;
      return { data: { data: [], meta: revisionMeta(null) }, isLoading: false, error: null };
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [
                {
                  id: 'rev_1',
                  category: 'basic',
                  field_key: 'phone',
                  field_label: '電話番号',
                  value_label: '090-0000-0000 → 080-1111-2222',
                  previous: '090-0000-0000',
                  current: '080-1111-2222',
                  source: 'patient_detail_edit',
                  source_visit_record_id: null,
                  change_reason: '本人確認',
                  importance: 'normal',
                  confirmed_by_name: '佐藤',
                  confirmed_at: '2026-06-16T02:00:00.000Z',
                  valid_from: '2026-06-16T00:00:00.000Z',
                  valid_to: null,
                  is_current: true,
                  updated_by_name: '田中',
                  created_at: '2026-06-16T01:00:00.000Z',
                  updated_by: 'user_u',
                  provider_internal_note: 'strip this field',
                },
              ],
              meta: revisionMeta(null, 1),
            }),
          ),
      ),
    );

    try {
      render(<PatientFieldRevisionTimeline patientId="patient_1" />);
      await expect(capturedQuery?.queryFn()).resolves.toEqual({
        data: [
          {
            id: 'rev_1',
            category: 'basic',
            field_key: 'phone',
            field_label: '電話番号',
            value_label: '090-0000-0000 → 080-1111-2222',
            previous: '090-0000-0000',
            current: '080-1111-2222',
            source: 'patient_detail_edit',
            source_visit_record_id: null,
            change_reason: '本人確認',
            importance: 'normal',
            confirmed_by_name: '佐藤',
            confirmed_at: '2026-06-16T02:00:00.000Z',
            valid_from: '2026-06-16T00:00:00.000Z',
            valid_to: null,
            is_current: true,
            updated_by_name: '田中',
            created_at: '2026-06-16T01:00:00.000Z',
          },
        ],
        meta: revisionMeta(null, 1),
      });
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('rejects legacy envelopes, inconsistent metadata, unsafe order, oversized values, and duplicates', async () => {
    useOrgIdMock.mockReturnValue('org_1');
    let capturedQuery: { queryFn: () => Promise<unknown> } | undefined;
    useQueryMock.mockImplementation((config: { queryFn: () => Promise<unknown> }) => {
      capturedQuery = config;
      return { data: { data: [], meta: revisionMeta(null) }, isLoading: false, error: null };
    });
    render(<PatientFieldRevisionTimeline patientId="patient_1" />);

    const sensitiveRevision = {
      id: 'rev_sensitive',
      category: 'contacts',
      field_key: 'phone',
      field_label: '電話番号',
      value_label: null,
      previous: '〔記録あり〕',
      current: '〔記録あり〕',
      source: 'patient_detail_edit',
      source_visit_record_id: null,
      change_reason: null,
      importance: 'normal',
      confirmed_by_name: null,
      confirmed_at: null,
      valid_from: '2026-06-16T00:00:00.000Z',
      valid_to: null,
      is_current: true,
      updated_by_name: '田中',
      created_at: '2026-06-16T01:00:00.000Z',
    };
    const payloads = [
      { revisions: [], meta: revisionMeta(null) },
      { data: [], meta: { ...revisionMeta(null), visible_count: 1 } },
      {
        data: [{ ...sensitiveRevision, is_current: false, valid_to: null }],
        meta: revisionMeta(null, 1),
      },
      {
        data: [{ ...sensitiveRevision, current: 'x'.repeat(5_001) }],
        meta: revisionMeta(null, 1),
      },
      {
        data: [sensitiveRevision, { ...sensitiveRevision, id: 'rev_sensitive' }],
        meta: revisionMeta(null, 2),
      },
      {
        data: [
          { ...sensitiveRevision, id: 'rev_new', created_at: '2026-06-17T01:00:00.000Z' },
          { ...sensitiveRevision, id: 'rev_old', created_at: '2026-06-16T01:00:00.000Z' },
        ],
        meta: revisionMeta(null, 2),
      },
      {
        data: Array.from({ length: 51 }, (_, index) => ({
          ...sensitiveRevision,
          id: `rev_${String(index).padStart(2, '0')}`,
          created_at: new Date(Date.UTC(2026, 5, 16, 1, 0, index)).toISOString(),
        })),
        meta: revisionMeta(null, 51),
      },
    ];

    try {
      for (const payload of payloads) {
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })),
        );
        await expect(capturedQuery?.queryFn()).rejects.toThrow('変更履歴の取得に失敗しました');
      }
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it.each(['.', '..'])(
    'fails closed without fetching for exact dot-segment patientId %p',
    async (dotId) => {
      useOrgIdMock.mockReturnValue('org_1');

      let capturedQuery: { queryFn: () => Promise<unknown> } | undefined;
      useQueryMock.mockImplementation((config: { queryFn: () => Promise<unknown> }) => {
        capturedQuery = config;
        return { data: { data: [] }, isLoading: false, error: null };
      });

      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);

      try {
        render(<PatientFieldRevisionTimeline patientId={dotId} />);
        await expect(capturedQuery?.queryFn()).rejects.toThrow(RangeError);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
      }
    },
  );
});
