// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

import { ManagementPlanPanel } from './management-plan-panel';
import { toast } from 'sonner';

setupDomTestEnv();

type QueryConfig = {
  queryKey: unknown[];
  queryFn: () => Promise<unknown>;
};

type MutationConfig<TVariables> = {
  mutationFn: (variables: TVariables) => Promise<unknown>;
};

type SaveVariables = {
  title: string;
  summary: string;
  effective_from: string;
  next_review_date: string;
  contentText: string;
};

type ActionVariables = {
  planId: string;
  action: 'approve' | 'archive';
};

const activeCase = {
  id: 'case_active_123456',
  status: 'active',
  primary_pharmacist_id: 'pharmacist_1',
  referral_source: '居宅介護支援事業所',
  start_date: '2026-06-02',
  end_date: null,
};

function buildPlan(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'plan_1',
    case_id: activeCase.id,
    title: '訪問薬剤管理指導計画書 更新版',
    summary: '疼痛管理を重点確認',
    content: { visit_policy: '週1回訪問' },
    version: 2,
    status: 'draft',
    effective_from: '2026-06-02',
    next_review_date: '2026-07-02',
    approved_at: null,
    updated_at: '2026-06-10T00:00:00.000Z',
    created_at: '2026-06-02T00:00:00.000Z',
    ...overrides,
  };
}

function okJson(body: unknown = { data: [] }) {
  return {
    ok: true,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('ManagementPlanPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders the no-case state with a semantic section heading', () => {
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockReturnValue({ data: { data: [] }, isLoading: false, error: null });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    render(
      <ManagementPlanPanel patientId="patient_1" patientName="山田花子" cases={[]} orgId="org_1" />,
    );

    expect(screen.getByRole('heading', { level: 2, name: '管理計画書' }).tagName).toBe('H2');
    expect(screen.getByText('ケースがありません')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(
      'ケース作成後に管理計画書を登録できます',
    );
  });

  it('exposes the management-plan case selector by label', () => {
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockReturnValue({ data: { data: [] }, isLoading: false, error: null });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    render(
      <ManagementPlanPanel
        patientId="patient_1"
        patientName="山田花子"
        orgId="org_1"
        cases={[activeCase]}
      />,
    );

    expect(screen.getByLabelText('管理計画書のケース')).toBeTruthy();
  });

  it('keeps management-plan editor validation visible inline', () => {
    const mutateMock = vi.fn();
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockReturnValue({ data: { data: [] }, isLoading: false, error: null });
    useMutationMock.mockReturnValue({ mutate: mutateMock, isPending: false });

    render(
      <ManagementPlanPanel
        patientId="patient_1"
        patientName="山田花子"
        orgId="org_1"
        cases={[activeCase]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '新規計画書' }));
    const title = screen.getByLabelText('タイトル');
    const content = screen.getByLabelText('本文(JSON)');

    fireEvent.change(title, { target: { value: '' } });
    fireEvent.change(content, { target: { value: '{invalid' } });
    fireEvent.click(screen.getByRole('button', { name: '作成する' }));

    expect(screen.getByText('タイトルを入力してください').getAttribute('role')).toBe('alert');
    expect(screen.getByText('本文は JSON 形式で入力してください').getAttribute('role')).toBe(
      'alert',
    );
    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect(title.getAttribute('aria-describedby')).toBe('management-plan-title-error');
    expect(content.getAttribute('aria-invalid')).toBe('true');
    expect(content.getAttribute('aria-describedby')).toBe('management-plan-content-error');
    expect(toast.error).toHaveBeenCalledWith('タイトルを入力してください');
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it('names draft management-plan edit actions by row without duplicating plan PHI', () => {
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockReturnValue({
      data: {
        data: [buildPlan()],
      },
      isLoading: false,
      error: null,
    });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    render(
      <ManagementPlanPanel
        patientId="patient_1"
        patientName="山田花子"
        orgId="org_1"
        cases={[activeCase]}
      />,
    );

    const editButton = screen.getByRole('button', { name: '管理計画書1件目を編集' });
    expect(editButton.getAttribute('aria-label')).not.toMatch(/山田|訪問薬剤|疼痛|週1回/);

    fireEvent.click(editButton);

    expect(screen.getByRole('dialog', { name: '計画書を編集' })).toBeTruthy();
  });

  it('submits valid management-plan editor values through the existing mutation path', () => {
    const mutateMock = vi.fn();
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockReturnValue({ data: { data: [] }, isLoading: false, error: null });
    useMutationMock.mockReturnValue({ mutate: mutateMock, isPending: false });

    render(
      <ManagementPlanPanel
        patientId="patient_1"
        patientName="山田花子"
        orgId="org_1"
        cases={[activeCase]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '新規計画書' }));
    fireEvent.change(screen.getByLabelText('タイトル'), {
      target: { value: '訪問薬剤管理指導計画書 更新版' },
    });
    fireEvent.change(screen.getByLabelText('本文(JSON)'), {
      target: { value: '{"visit_policy":"週1回訪問"}' },
    });
    fireEvent.click(screen.getByRole('button', { name: '作成する' }));

    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '訪問薬剤管理指導計画書 更新版',
        contentText: '{"visit_policy":"週1回訪問"}',
      }),
    );
  });

  it('encodes the case id as a query value while keeping raw cache identity', async () => {
    const hostileCase = {
      ...activeCase,
      id: 'case/1?x=y#z&next=/patients/raw',
    };
    let captured: QueryConfig | undefined;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okJson({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockImplementation((config: QueryConfig) => {
      captured = config;
      return { data: { data: [] }, isLoading: false, error: null };
    });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    render(
      <ManagementPlanPanel
        patientId="patient_1"
        patientName="山田花子"
        orgId="org_1"
        cases={[hostileCase]}
      />,
    );

    expect(captured?.queryKey).toEqual(['management-plans', hostileCase.id, 'org_1']);
    await captured?.queryFn();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `/api/management-plans?${new URLSearchParams({ case_id: hostileCase.id }).toString()}`,
    );
    expect(url).not.toContain('&next=/patients/raw');
    expect(url).not.toContain('#z');
    expect((init.headers as Record<string, string>)['x-org-id']).toBe('org_1');
  });

  it('keeps create payload identity raw while using shared org JSON headers', async () => {
    const hostileCase = {
      ...activeCase,
      id: 'case/1?x=y#z&next=/patients/raw',
    };
    const mutationConfigs: Array<MutationConfig<SaveVariables | ActionVariables>> = [];
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okJson({ data: buildPlan() }));
    vi.stubGlobal('fetch', fetchMock);
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockReturnValue({ data: { data: [] }, isLoading: false, error: null });
    useMutationMock.mockImplementation(
      (config: MutationConfig<SaveVariables | ActionVariables>) => {
        mutationConfigs.push(config);
        return { mutate: vi.fn(), isPending: false };
      },
    );

    render(
      <ManagementPlanPanel
        patientId="patient_1"
        patientName="山田花子"
        orgId="org_1"
        cases={[hostileCase]}
      />,
    );

    const saveConfig = mutationConfigs[0] as MutationConfig<SaveVariables>;
    await saveConfig.mutationFn({
      title: '訪問薬剤管理指導計画書 更新版',
      summary: '',
      effective_from: '',
      next_review_date: '',
      contentText: '{"visit_policy":"週1回訪問"}',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/management-plans');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
    });
    expect(JSON.parse(String(init.body))).toEqual(
      expect.objectContaining({
        case_id: hostileCase.id,
        title: '訪問薬剤管理指導計画書 更新版',
        content: { visit_policy: '週1回訪問' },
      }),
    );
  });

  it('encodes edit and action plan ids as path segments before fetch', async () => {
    const hostilePlanId = 'plan/1?x=y#z';
    const mutationConfigs: Array<MutationConfig<SaveVariables | ActionVariables>> = [];
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okJson({ data: buildPlan() }));
    vi.stubGlobal('fetch', fetchMock);
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockReturnValue({
      data: { data: [buildPlan({ id: hostilePlanId })] },
      isLoading: false,
      error: null,
    });
    useMutationMock.mockImplementation(
      (config: MutationConfig<SaveVariables | ActionVariables>) => {
        mutationConfigs.push(config);
        return { mutate: vi.fn(), isPending: false };
      },
    );

    render(
      <ManagementPlanPanel
        patientId="patient_1"
        patientName="山田花子"
        orgId="org_1"
        cases={[activeCase]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '管理計画書1件目を編集' }));

    const saveConfig = mutationConfigs.at(-2) as MutationConfig<SaveVariables>;
    const actionConfig = mutationConfigs.at(-1) as MutationConfig<ActionVariables>;
    await saveConfig.mutationFn({
      title: '訪問薬剤管理指導計画書 更新版',
      summary: '',
      effective_from: '',
      next_review_date: '',
      contentText: '{"visit_policy":"週1回訪問"}',
    });
    await actionConfig.mutationFn({ planId: hostilePlanId, action: 'approve' });

    const [editUrl, editInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [actionUrl, actionInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(editUrl).toBe(`/api/management-plans/${encodeURIComponent(hostilePlanId)}`);
    expect(actionUrl).toBe(`/api/management-plans/${encodeURIComponent(hostilePlanId)}`);
    expect(editUrl).not.toContain('?x=y');
    expect(actionUrl).not.toContain('#z');
    expect(editUrl).not.toContain('%25');
    expect(actionUrl).not.toContain('%25');
    expect(editInit.headers).toEqual({
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
    });
    expect(actionInit.headers).toEqual({
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
    });
    expect(JSON.parse(String(actionInit.body))).toEqual({ action: 'approve' });
  });

  it.each(['.', '..'])(
    'fails closed before action fetch for dot-segment plan id %p',
    async (id) => {
      const mutationConfigs: Array<MutationConfig<SaveVariables | ActionVariables>> = [];
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okJson({ data: buildPlan() }));
      vi.stubGlobal('fetch', fetchMock);
      useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
      useQueryMock.mockReturnValue({ data: { data: [] }, isLoading: false, error: null });
      useMutationMock.mockImplementation(
        (config: MutationConfig<SaveVariables | ActionVariables>) => {
          mutationConfigs.push(config);
          return { mutate: vi.fn(), isPending: false };
        },
      );

      render(
        <ManagementPlanPanel
          patientId="patient_1"
          patientName="山田花子"
          orgId="org_1"
          cases={[activeCase]}
        />,
      );

      const actionConfig = mutationConfigs[1] as MutationConfig<ActionVariables>;
      await expect(actionConfig.mutationFn({ planId: id, action: 'archive' })).rejects.toThrow(
        RangeError,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('encodes hostile plan and patient ids in rendered PDF and print links', () => {
    const hostilePatientId = 'patient/1?x=y#z';
    const hostilePlanId = 'plan/1?x=y#z&next=/patients/raw';
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockReturnValue({
      data: { data: [buildPlan({ id: hostilePlanId })] },
      isLoading: false,
      error: null,
    });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    render(
      <ManagementPlanPanel
        patientId={hostilePatientId}
        patientName="山田花子"
        orgId="org_1"
        cases={[activeCase]}
      />,
    );

    const pdfHref = screen.getByRole('link', { name: 'PDF' }).getAttribute('href') ?? '';
    const printHref = screen.getByRole('link', { name: '印刷ビュー' }).getAttribute('href') ?? '';

    expect(pdfHref).toBe(`/api/management-plans/${encodeURIComponent(hostilePlanId)}/pdf`);
    expect(pdfHref).not.toContain('?x=y');
    expect(pdfHref).not.toContain('#z');
    expect(pdfHref).not.toContain('%25');

    expect(printHref).toBe(
      `/patients/${encodeURIComponent(hostilePatientId)}/management-plan/print?${new URLSearchParams(
        { planId: hostilePlanId },
      ).toString()}`,
    );
    expect(printHref).not.toContain('&next=/patients/raw');
    expect(printHref).not.toContain('#z');
    expect(printHref).not.toContain('%25');
  });
});
