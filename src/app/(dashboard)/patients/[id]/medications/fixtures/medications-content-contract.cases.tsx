import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMedicationsContentTestSupport } from './medications-content.test-support';

const {
  buildOrgHeaders,
  buildOrgJsonHeaders,
  buildPatientApiPath,
  buildPatientHref,
  jsonResponse,
  MedicationsContent,
  stubJsonFetch,
  useMutationMock,
  useOrgIdMock,
  useQueryClientMock,
  useQueryMock,
} = getMedicationsContentTestSupport();

describe('MedicationsContent url/header convergence', () => {
  const HOSTILE = 'pt/1?x=y#z';
  const ENCODED = 'pt%2F1%3Fx%3Dy%23z';

  function buildIssue(id: string) {
    return {
      id,
      patient_id: 'patient_1',
      case_id: 'case_1',
      title: '飲み忘れ',
      description: '夕食後薬を飲み忘れ',
      status: 'open',
      priority: 'high',
      category: 'adherence',
      identified_at: '2026-06-10T09:00:00.000Z',
      resolved_at: null,
      version: 1,
    };
  }

  function buildMedicationProfile(overrides: Record<string, unknown> = {}) {
    return {
      id: 'profile_1',
      patient_id: 'patient_1',
      drug_name: 'アムロジピン錠5mg',
      dose: '1錠',
      frequency: '朝食後',
      start_date: '2026-06-01T00:00:00.000Z',
      end_date: null,
      prescriber: '佐藤医師',
      is_current: true,
      source: 'manual',
      created_at: '2026-06-01T00:00:00.000Z',
      ...overrides,
    };
  }

  function buildPatientSummary(patientId = 'patient_1', overrides: Record<string, unknown> = {}) {
    return {
      data: {
        id: patientId,
        name: '山田花子',
        name_kana: 'ヤマダハナコ',
        birth_date: '1950-04-01T00:00:00.000Z',
        gender: 'female',
        allergy_info: [],
        ...overrides,
      },
    };
  }

  function buildInquiry(overrides: Record<string, unknown> = {}) {
    return {
      id: 'inquiry_1',
      reason: '残薬調整',
      inquiry_to_physician: '佐藤医師',
      inquiry_content: '残薬7日分を調整してよいか',
      result: 'pending',
      proposal_origin: 'post_inquiry',
      residual_adjustment: true,
      change_detail: null,
      inquired_at: '2026-06-01T00:00:00.000Z',
      resolved_at: null,
      line: { drug_name: 'アムロジピン錠5mg', line_number: 1 },
      ...overrides,
    };
  }

  function buildResidualMedication(overrides: Record<string, unknown> = {}) {
    return {
      id: 'residual_1',
      visit_record_id: 'visit_1',
      drug_name: 'アムロジピン錠5mg',
      prescribed_quantity: 28,
      remaining_quantity: 7,
      remaining_days: 7,
      excess_days: 7,
      is_reduction_target: false,
      is_prohibited_reduction: false,
      created_at: '2026-06-01T00:00:00.000Z',
      ...overrides,
    };
  }

  function renderMeds({
    patientId = HOSTILE,
    issues = [] as ReturnType<typeof buildIssue>[],
  } = {}) {
    const queryConfigs = new Map<string, { queryKey: unknown[]; queryFn: () => unknown }>();
    const mutationConfigs: Array<{
      mutationFn: (input?: unknown) => unknown;
      onSuccess?: (data?: unknown) => unknown;
    }> = [];
    const invalidateQueries = vi.fn();
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({ invalidateQueries });
    useMutationMock.mockImplementation(
      (cfg: {
        mutationFn: (input?: unknown) => unknown;
        onSuccess?: (data?: unknown) => unknown;
      }) => {
        mutationConfigs.push(cfg);
        return { mutate: vi.fn(), isPending: false };
      },
    );
    useQueryMock.mockImplementation((cfg: { queryKey: unknown[]; queryFn: () => unknown }) => {
      queryConfigs.set(String((cfg.queryKey as unknown[])[0]), cfg);
      if (String((cfg.queryKey as unknown[])[0]) === 'medication-issues') {
        return { data: { data: issues }, isLoading: false };
      }
      return { data: { data: [] }, isLoading: false };
    });
    render(
      <MedicationsContent
        patientId={patientId}
        patientName="山田花子"
        patientNameKana="ヤマダハナコ"
        birthDate="1950-04-01"
        gender="female"
        allergyInfo={[]}
      />,
    );
    return { queryConfigs, mutationConfigs, invalidateQueries };
  }

  function stubFetch(patientSummaryId = HOSTILE) {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/medication-issues')) {
        return jsonResponse({ data: [], meta: { has_more: false, next_cursor: null } });
      }
      if (url.includes('/api/medication-profiles')) {
        return jsonResponse({
          data: [],
          meta: { limit: 100, has_more: false, next_cursor: null },
        });
      }
      if (url.includes('/api/patients/'))
        return jsonResponse(buildPatientSummary(patientSummaryId));
      return jsonResponse({ data: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('aggregates all current-medication cursor pages without silent truncation', async () => {
    const { queryConfigs } = renderMeds({ patientId: 'patient_1' });
    const current = buildMedicationProfile({ id: 'profile_current' });
    const older = buildMedicationProfile({
      id: 'profile_older',
      created_at: '2026-05-01T00:00:00.000Z',
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [current],
          meta: { limit: 100, has_more: true, next_cursor: 'cursor_2' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [older],
          meta: { limit: 100, has_more: false, next_cursor: null },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    try {
      await expect(queryConfigs.get('medication-profiles')!.queryFn()).resolves.toEqual({
        data: [current, older],
      });
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        '/api/medication-profiles?patient_id=patient_1&is_current=true&limit=100',
        expect.anything(),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/api/medication-profiles?patient_id=patient_1&is_current=true&limit=100&cursor=cursor_2',
        expect.anything(),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects current-medication rows from a different patient', async () => {
    const { queryConfigs } = renderMeds({ patientId: 'patient_1' });
    const fetchMock = stubJsonFetch({
      data: [buildMedicationProfile({ patient_id: 'patient_other' })],
      meta: { limit: 100, has_more: false, next_cursor: null },
    });
    try {
      await expect(queryConfigs.get('medication-profiles')!.queryFn()).rejects.toThrow(
        '取得に失敗しました',
      );
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects a repeated current-medication cursor instead of looping', async () => {
    const { queryConfigs } = renderMeds({ patientId: 'patient_1' });
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [],
        meta: { limit: 100, has_more: true, next_cursor: 'cursor_loop' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(queryConfigs.get('medication-profiles')!.queryFn()).rejects.toThrow(
        '取得に失敗しました',
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects duplicate current-medication ids across cursor pages', async () => {
    const { queryConfigs } = renderMeds({ patientId: 'patient_1' });
    const duplicate = buildMedicationProfile({ id: 'profile_duplicate' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [duplicate],
          meta: { limit: 100, has_more: true, next_cursor: 'cursor_2' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [duplicate],
          meta: { limit: 100, has_more: false, next_cursor: null },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(queryConfigs.get('medication-profiles')!.queryFn()).rejects.toThrow(
        '取得に失敗しました',
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('validates patient-summary identity and strips the unconsumed patient workspace', async () => {
    const { queryConfigs } = renderMeds({ patientId: 'patient_1' });
    const fetchMock = stubJsonFetch(
      buildPatientSummary('patient_1', {
        notes: 'must-not-enter-cache',
        cases: [{ id: 'case_1' }],
      }),
    );
    try {
      await expect(queryConfigs.get('patient-medication-summary')!.queryFn()).resolves.toEqual({
        id: 'patient_1',
        name: '山田花子',
        name_kana: 'ヤマダハナコ',
        birth_date: '1950-04-01T00:00:00.000Z',
        gender: 'female',
        allergy_info: [],
      });
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects a patient summary for a different route patient', async () => {
    const { queryConfigs } = renderMeds({ patientId: 'patient_1' });
    const fetchMock = stubJsonFetch(buildPatientSummary('patient_other'));
    try {
      await expect(queryConfigs.get('patient-medication-summary')!.queryFn()).rejects.toThrow(
        '患者情報の取得に失敗しました',
      );
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects malformed inquiry timestamps before calculating the response backlog', async () => {
    const { queryConfigs } = renderMeds({ patientId: 'patient_1' });
    const fetchMock = stubJsonFetch({ data: [buildInquiry({ inquired_at: 'not-a-timestamp' })] });
    try {
      await expect(queryConfigs.get('inquiry-records')!.queryFn()).rejects.toThrow(
        '疑義照会の取得に失敗しました',
      );
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('loads the complete residual history and rejects negative quantities', async () => {
    const { queryConfigs } = renderMeds({ patientId: 'patient_1' });
    const fetchMock = stubJsonFetch({
      data: [buildResidualMedication({ remaining_quantity: -1 })],
    });
    try {
      await expect(queryConfigs.get('residual-medications')!.queryFn()).rejects.toThrow(
        '残薬データの取得に失敗しました',
      );
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/residual-medications?patient_id=patient_1',
        expect.anything(),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('adopts buildOrgHeaders on every GET; query-filter values stay raw via URLSearchParams, patient path is single-encoded', async () => {
    const sentinel = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    vi.mocked(buildOrgHeaders).mockReturnValue(sentinel);
    const { queryConfigs } = renderMeds();
    const fetchMock = stubFetch();

    try {
      // query-filter GETs: patient_id stays semantically raw but the wire bytes are encoded
      for (const key of [
        'medication-profiles',
        'medication-issues',
        'inquiry-records',
        'residual-medications',
      ]) {
        fetchMock.mockClear();
        await queryConfigs.get(key)!.queryFn();
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        const parsed = new URL(url, 'http://x');
        expect(parsed.pathname).toBe(`/api/${key}`);
        expect(parsed.searchParams.get('patient_id')).toBe(HOSTILE);
        expect(url).not.toContain('%25');
        expect(init.headers).toBe(sentinel);
        // org-scoped cache key: orgId is part of the key (tenant isolation) and the
        // raw patientId stays its own trailing segment, never encoded/altered
        expect(queryConfigs.get(key)!.queryKey).toEqual([key, 'org_1', HOSTILE]);
      }
      // path-dynamic patient summary GET: single-encoded segment
      fetchMock.mockClear();
      await queryConfigs.get('patient-medication-summary')!.queryFn();
      const [summaryUrl, summaryInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(buildPatientApiPath).toHaveBeenCalledWith(HOSTILE);
      expect(summaryUrl).toBe(`/api/patients/${ENCODED}`);
      expect(summaryUrl).not.toContain('%25');
      expect(summaryInit.headers).toBe(sentinel);
      // summary key is org-scoped too (existing orgId-last shape preserved)
      expect(queryConfigs.get('patient-medication-summary')!.queryKey).toEqual([
        'patient-medication-summary',
        HOSTILE,
        'org_1',
      ]);
      expect(vi.mocked(buildOrgHeaders)).toHaveBeenCalledWith('org_1');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects legacy root medication-issue cursor metadata', async () => {
    const { queryConfigs } = renderMeds();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ data: [], hasMore: false, nextCursor: null })),
    );

    try {
      await expect(queryConfigs.get('medication-issues')!.queryFn()).rejects.toThrow(
        '課題の取得に失敗しました',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(['.', '..'])(
    'fails closed before any fetch for the exact dot patient id %p',
    async (dotId) => {
      const fetchMock = stubFetch();
      try {
        expect(() => renderMeds({ patientId: dotId })).toThrow(RangeError);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it('patient summary GET consumes the shared patient API path helper return value', async () => {
    const { queryConfigs } = renderMeds({ patientId: 'patient_1' });
    const fetchMock = stubFetch('patient_1');
    vi.mocked(buildPatientApiPath).mockReturnValueOnce('/api/patients/__helper_patient__');

    try {
      await queryConfigs.get('patient-medication-summary')!.queryFn();
      expect(buildPatientApiPath).toHaveBeenCalledWith('patient_1');
      expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/patients/__helper_patient__');
      expect(fetchMock).not.toHaveBeenCalledWith('/api/patients/patient_1', expect.anything());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ['medication-profiles', '服薬中薬剤APIからの詳細エラー'],
    ['patient-medication-summary', '患者サマリAPIからの詳細エラー'],
    ['medication-issues', '薬学的課題APIからの詳細エラー'],
    ['inquiry-records', '疑義照会APIからの詳細エラー'],
    ['residual-medications', '残薬APIからの詳細エラー'],
  ])('keeps API messages from failed %s reads', async (key, message) => {
    const { queryConfigs } = renderMeds();
    const fetchMock = stubJsonFetch({ message }, 500);

    try {
      await expect(queryConfigs.get(key)!.queryFn()).rejects.toThrow(message);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('routes the residual adjustment link through the shared patient href helper', () => {
    vi.mocked(buildPatientHref).mockReturnValueOnce('/patients/__helper_residual__');

    renderMeds({ patientId: 'patient_1' });

    expect(buildPatientHref).toHaveBeenCalledWith('patient_1', '/residual-adjustment');
    expect(screen.getByRole('link', { name: '残薬調整を開く' }).getAttribute('href')).toBe(
      '/patients/__helper_residual__',
    );
  });

  it('issue status PATCH single-encodes the path issueId, adopts json helper, keeps id out of body', async () => {
    const sentinel = {
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
      'x-test-helper': 'buildOrgJsonHeaders',
    };
    vi.mocked(buildOrgJsonHeaders).mockReturnValue(sentinel);
    const { mutationConfigs, invalidateQueries } = renderMeds();
    const fetchMock = stubFetch();
    try {
      // issueStatusMutation is the last mutation registered on the main render
      const statusMutation = mutationConfigs.at(-1)!;
      await statusMutation.mutationFn({ issueId: HOSTILE, status: 'resolved', version: 1 });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/medication-issues/${ENCODED}`);
      expect(url).not.toContain('%25');
      expect(init.method).toBe('PATCH');
      expect(init.headers).toBe(sentinel);
      expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1');
      expect(JSON.parse(init.body as string)).toEqual({ status: 'resolved', version: 1 });
      expect(init.body as string).not.toContain(HOSTILE);
      // org-scoped invalidation on success (tenant-isolated cache key)
      await act(async () => {
        await statusMutation.onSuccess?.();
      });
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['medication-issues', 'org_1', HOSTILE],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(['.', '..'])(
    'issue status PATCH fails closed before fetch for the exact dot issueId %p',
    async (dotId) => {
      const { mutationConfigs } = renderMeds();
      const fetchMock = stubFetch();
      try {
        await expect(
          mutationConfigs.at(-1)!.mutationFn({ issueId: dotId, status: 'resolved', version: 1 }),
        ).rejects.toThrow(RangeError);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it('create-issue POST keeps raw patient_id in the domain body and adopts json helper', async () => {
    const sentinel = {
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
      'x-test-helper': 'buildOrgJsonHeaders',
    };
    vi.mocked(buildOrgJsonHeaders).mockReturnValue(sentinel);
    const { mutationConfigs } = renderMeds();
    const fetchMock = stubFetch();
    try {
      // saveIssueMutation (create branch, no editingIssue) is registered before issueStatus
      await mutationConfigs.at(-2)!.mutationFn({ title: '新規課題', priority: 'high' });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/medication-issues');
      expect(init.method).toBe('POST');
      expect(init.headers).toBe(sentinel);
      // raw patient id IS domain payload on create
      expect(JSON.parse(init.body as string)).toEqual({
        patient_id: HOSTILE,
        title: '新規課題',
        priority: 'high',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('update-issue PATCH single-encodes the editing issue id and omits the path id from the body', async () => {
    const sentinel = {
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
      'x-test-helper': 'buildOrgJsonHeaders',
    };
    vi.mocked(buildOrgJsonHeaders).mockReturnValue(sentinel);
    const { mutationConfigs } = renderMeds({ issues: [buildIssue(HOSTILE)] });
    // open the edit dialog so editingIssue is set to the hostile-id issue
    fireEvent.click(screen.getByRole('button', { name: '薬学的課題1件目を編集' }));
    const fetchMock = stubFetch();
    try {
      // after the state change, the latest saveIssueMutation closes over editingIssue
      await mutationConfigs.at(-2)!.mutationFn({ title: '更新', priority: 'low' });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/medication-issues/${ENCODED}`);
      expect(url).not.toContain('%25');
      expect(init.method).toBe('PATCH');
      expect(init.headers).toBe(sentinel);
      // update body is the form only; path id not serialized
      expect(JSON.parse(init.body as string)).toEqual({
        title: '更新',
        priority: 'low',
        version: 1,
      });
      expect(init.body as string).not.toContain(HOSTILE);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(['.', '..'])(
    'update-issue PATCH fails closed before fetch when the editing issue id is the exact dot %p',
    async (dotId) => {
      const { mutationConfigs } = renderMeds({ issues: [buildIssue(dotId)] });
      fireEvent.click(screen.getByRole('button', { name: '薬学的課題1件目を編集' }));
      const fetchMock = stubFetch();
      try {
        await expect(mutationConfigs.at(-2)!.mutationFn({ title: 'x' })).rejects.toThrow(
          RangeError,
        );
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it('add-medication POST keeps raw patient_id in the domain body and adopts json helper', async () => {
    const sentinel = {
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
      'x-test-helper': 'buildOrgJsonHeaders',
    };
    vi.mocked(buildOrgJsonHeaders).mockReturnValue(sentinel);
    const { mutationConfigs, invalidateQueries } = renderMeds();
    // open the add dialog so its mutation registers as the latest one
    fireEvent.click(screen.getByRole('button', { name: '薬剤追加' }));
    const fetchMock = stubFetch();
    try {
      const addMutation = mutationConfigs.at(-1)!;
      await addMutation.mutationFn({
        drug_name: 'アムロジピン',
        dose: '1錠',
        frequency: '朝食後',
        prescriber: '佐藤医師',
      });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/medication-profiles');
      expect(init.method).toBe('POST');
      expect(init.headers).toBe(sentinel);
      expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1');
      // exact domain body: no extra path/id-derived fields leak, no domain field dropped
      expect(JSON.parse(init.body as string)).toEqual({
        patient_id: HOSTILE,
        drug_name: 'アムロジピン',
        dose: '1錠',
        frequency: '朝食後',
        prescriber: '佐藤医師',
        source: 'manual',
      });
      // org-scoped invalidation on success (tenant-isolated cache key)
      await act(async () => {
        await addMutation.onSuccess?.();
      });
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['medication-profiles', 'org_1', HOSTILE],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
