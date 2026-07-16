// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setupDomTestEnv } from '@/test/dom-test-utils';
import { jsonResponse } from '@/test/fetch-test-utils';
import { PrescriptionSupplyReviewContent } from './prescription-supply-review-content';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const invalidateQueriesMock = vi.hoisted(() => vi.fn());
const routerPushMock = vi.hoisted(() => vi.fn());
const routerRefreshMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({ useOrgId: useOrgIdMock }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock, refresh: routerRefreshMock }),
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

const reviewDetail = {
  task: { id: 'task_1', reason_code: 'ambiguous_stock_item' },
  patient: {
    id: 'patient_1',
    display_id: 'PAT-001',
    name: '山田 花子',
    name_kana: 'ヤマダ ハナコ',
    birth_date: '1940-01-02T00:00:00.000Z',
  },
  preview: {
    kind: 'reviewable' as const,
    line: {
      id: 'line_1',
      drug_name: '湿布A',
      drug_code: '2649735S1010',
      dosage_form: '貼付剤',
      dose: '1回1枚',
      frequency: '疼痛時',
      days: 7,
      quantity: 10,
      unit: '枚',
      route: 'external',
    },
    normalized_supply: { quantity: 10, unit: 'sheet' },
    candidates: [
      {
        id: 'stock_1',
        display_id: 'MSI-001',
        display_name: '湿布A 自宅保管',
        case_id: 'case_1',
        unit: 'sheet',
        dosage_form: '貼付剤',
        route: 'external',
        equivalence_review_status: 'not_required',
        applicable: true,
        current_quantity: 4,
        snapshot_calculated_at: '2026-07-17T00:00:00.000Z',
      },
      {
        id: 'stock_2',
        display_id: 'MSI-002',
        display_name: '湿布A 名寄せ未確認',
        case_id: null,
        unit: 'sheet',
        dosage_form: '貼付剤',
        route: 'external',
        equivalence_review_status: 'needs_review',
        applicable: false,
        current_quantity: null,
        snapshot_calculated_at: null,
      },
    ],
  },
};

describe('PrescriptionSupplyReviewContent', () => {
  const mutateMock = vi.fn();
  const resetMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockReturnValue({
      mutate: mutateMock,
      reset: resetMock,
      isPending: false,
      isError: false,
      error: null,
    });
  });

  it('shows a structured loading state while review evidence is fetched', () => {
    useQueryMock.mockReturnValue({ isPending: true, isError: false, data: undefined });

    render(<PrescriptionSupplyReviewContent taskId="task_1" />);

    expect(screen.getByRole('status', { name: '患者・処方・残数台帳を読み込み中' })).toBeTruthy();
  });

  it('encodes the task id and validates the dedicated GET response contract', async () => {
    let queryConfig:
      | { queryKey: unknown[]; enabled: boolean; queryFn: () => Promise<unknown> }
      | undefined;
    const hostileId = '../task?patient_name=山田#frag';
    fetchMock.mockResolvedValue(
      jsonResponse({ data: { ...reviewDetail, task: { id: hostileId, reason_code: null } } }),
    );
    useQueryMock.mockImplementation((config) => {
      queryConfig = config;
      return { isPending: true, isError: false, data: undefined };
    });

    render(<PrescriptionSupplyReviewContent taskId={hostileId} />);

    if (!queryConfig) throw new Error('query config was not captured');
    expect(queryConfig.queryKey).toEqual(['prescription-supply-review', 'org_1', hostileId]);
    await queryConfig.queryFn();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/tasks/${encodeURIComponent(hostileId)}/prescription-supply/resolve`,
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
  });

  it('requires candidate selection and active confirmation before applying', () => {
    useQueryMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: reviewDetail,
      refetch: vi.fn(),
    });

    render(<PrescriptionSupplyReviewContent taskId="task_1" />);

    expect(screen.getByText('山田 花子')).toBeTruthy();
    expect(screen.getByText('10 枚')).toBeTruthy();
    expect((screen.getByLabelText('湿布A 名寄せ未確認') as HTMLInputElement).disabled).toBe(true);
    const applyButton = screen.getByRole('button', { name: '選択した台帳へ反映' });
    expect((applyButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByLabelText('湿布A 自宅保管'));
    expect((applyButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect((applyButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(applyButton);
    fireEvent.click(screen.getByRole('button', { name: '反映してタスクを完了' }));
    expect(mutateMock).toHaveBeenCalledWith('stock_1');
  });

  it('shows a fixed remediation state when the prescription identity is blocked', () => {
    useQueryMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        ...reviewDetail,
        preview: {
          kind: 'blocked',
          reason_code: 'unsupported_unit',
          line: reviewDetail.preview.line,
        },
      },
      refetch: vi.fn(),
    });

    render(<PrescriptionSupplyReviewContent taskId="task_1" />);

    expect(screen.getByRole('alert').textContent).toContain('処方数量の単位に対応していません');
    expect(screen.queryByRole('button', { name: '選択した台帳へ反映' })).toBeNull();
  });
});
