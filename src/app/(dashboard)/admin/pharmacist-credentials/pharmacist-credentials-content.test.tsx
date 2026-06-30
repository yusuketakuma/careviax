// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import {
  PHARMACIST_CREDENTIALS_API_PATH,
  buildPharmacistCredentialApiPath,
} from '@/lib/pharmacist-credentials/api-paths';
import { buildPharmacistsApiPath } from '@/lib/pharmacists/api-paths';
import { PharmacistCredentialsContent } from './pharmacist-credentials-content';

setupDomTestEnv();

const mutationMutateMock = vi.hoisted(() => vi.fn());
const mutationConfigs = vi.hoisted(() => [] as MutationOptions[]);
const useQueryMock = vi.hoisted(() => vi.fn());

type MutationOptions = {
  mutationFn?: () => Promise<unknown>;
  onError?: (error: unknown) => void;
  onSuccess?: (data: unknown) => void | Promise<void>;
};

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: MutationOptions) => {
    mutationConfigs.push(options);
    return {
      mutate: () => {
        mutationMutateMock();
        void Promise.resolve(options.mutationFn?.()).then(
          (data) => void options.onSuccess?.(data),
          (error: unknown) => options.onError?.(error),
        );
      },
      isPending: false,
    };
  },
  useQuery: useQueryMock,
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock('@/lib/pharmacist-credentials/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/pharmacist-credentials/api-paths')>();
  return {
    ...actual,
    buildPharmacistCredentialApiPath: vi.fn(actual.buildPharmacistCredentialApiPath),
  };
});

vi.mock('@/lib/pharmacists/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/pharmacists/api-paths')>();
  return {
    ...actual,
    buildPharmacistsApiPath: vi.fn(actual.buildPharmacistsApiPath),
  };
});

vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return {
    ...actual,
    buildOrgHeaders: vi.fn(actual.buildOrgHeaders),
    buildOrgJsonHeaders: vi.fn(actual.buildOrgJsonHeaders),
  };
});

function credentialFixture(id = 'credential_1') {
  return {
    id,
    user_id: 'user_1',
    user_name: '山田 太郎',
    certification_type: '研修認定',
    certification_number: 'CERT-001',
    issued_date: '2025-04-01T00:00:00.000Z',
    expiry_date: '2028-03-31T00:00:00.000Z',
    tenure_years: 5.5,
    weekly_work_hours: 32,
    consented_patients: [],
  };
}

function defaultUseQueryImpl({ queryKey }: { queryKey: readonly unknown[] }) {
  const key = queryKey[0];

  if (key === 'pharmacist-credentials') {
    return {
      data: {
        data: [credentialFixture()],
        total_count: 1,
        visible_count: 1,
        hidden_count: 0,
        truncated: false,
        count_basis: 'pharmacist_credentials',
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
  }

  if (key === 'pharmacist-options') {
    return {
      data: {
        data: [{ id: 'user_1', name: '山田 太郎', site_name: '本店', role: 'pharmacist' }],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
  }

  return { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
}

vi.mock('@/components/ui/data-table', () => ({
  DataTable: ({
    columns,
    data,
  }: {
    columns: Array<{ id?: string; cell?: (args: { row: { original: unknown } }) => ReactNode }>;
    data: unknown[];
  }) => (
    <div data-testid="credentials-table">
      {data.map((row, rowIndex) => (
        <div key={rowIndex}>
          {columns.map((column, columnIndex) =>
            column.cell ? (
              <div key={`${column.id ?? columnIndex}`}>
                {column.cell({ row: { original: row } })}
              </div>
            ) : null,
          )}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@/components/ui/select', async () => {
  const React = await import('react');

  function collectItems(children: React.ReactNode): Array<{ value: string; label: string }> {
    const items: Array<{ value: string; label: string }> = [];
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as { value?: string; children?: React.ReactNode };
      if (props.value) {
        items.push({
          value: props.value,
          label: React.Children.toArray(props.children).join(''),
        });
      }
      items.push(...collectItems(props.children));
    });
    return items;
  }

  function findTriggerId(children: React.ReactNode): string | undefined {
    let triggerId: string | undefined;
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as { id?: string; children?: React.ReactNode };
      if (props.id) triggerId = props.id;
      if (!triggerId) triggerId = findTriggerId(props.children);
    });
    return triggerId;
  }

  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string;
      onValueChange?: (value: string) => void;
      children: React.ReactNode;
    }) => (
      <select
        id={findTriggerId(children)}
        value={value}
        onChange={(event) => onValueChange?.(event.target.value)}
      >
        {collectItems(children).map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    ),
    SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SelectItem: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SelectValue: ({ placeholder }: { placeholder?: string }) => <>{placeholder ?? null}</>,
  };
});

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe('PharmacistCredentialsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutationConfigs.length = 0;
    vi.mocked(buildOrgHeaders).mockImplementation((orgId, extra) => ({
      'x-org-id': orgId,
      ...extra,
    }));
    vi.mocked(buildOrgJsonHeaders).mockImplementation((orgId, extra) => ({
      'Content-Type': 'application/json',
      'x-org-id': orgId,
      ...extra,
    }));
    vi.mocked(buildPharmacistsApiPath).mockImplementation((params?: URLSearchParams) => {
      const query = params?.toString();
      return query ? `/api/pharmacists?${query}` : '/api/pharmacists';
    });
    useQueryMock.mockImplementation(defaultUseQueryImpl);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 200 })),
    );
  });

  it('keeps credential list actions at the full medical touch target size', () => {
    render(<PharmacistCredentialsContent />);

    for (const name of [
      '資格を登録',
      '山田 太郎 の 研修認定 を編集',
      '山田 太郎 の 研修認定 を失効',
    ]) {
      const className = screen.getByRole('button', { name }).getAttribute('class') ?? '';
      expect(className).toContain('h-11');
      expect(className).toContain('min-h-[44px]');
      expect(className).toContain('sm:h-11');
      expect(className).toContain('sm:min-h-[44px]');
    }
  });

  it('delegates credential and staff fetches to shared path and org-header helpers', async () => {
    const credentialHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'credentials' };
    const staffHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'staff' };
    vi.mocked(buildOrgHeaders)
      .mockReturnValueOnce(credentialHeaders)
      .mockReturnValueOnce(staffHeaders);
    vi.mocked(buildPharmacistsApiPath).mockReturnValue('/api/pharmacists?from=helper');
    render(<PharmacistCredentialsContent />);

    const credentialQuery = useQueryMock.mock.calls.find(
      ([options]) => options.queryKey[0] === 'pharmacist-credentials',
    )?.[0] as { queryFn: () => Promise<unknown> };
    const staffQuery = useQueryMock.mock.calls.find(
      ([options]) => options.queryKey[0] === 'pharmacist-options',
    )?.[0] as { queryFn: () => Promise<unknown> };

    await credentialQuery.queryFn();
    await staffQuery.queryFn();

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith(PHARMACIST_CREDENTIALS_API_PATH, {
      headers: credentialHeaders,
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/pharmacists?from=helper', {
      headers: staffHeaders,
    });
    expect(vi.mocked(buildOrgHeaders)).toHaveBeenNthCalledWith(1, 'org_1');
    expect(vi.mocked(buildOrgHeaders)).toHaveBeenNthCalledWith(2, 'org_1');
    expect(vi.mocked(buildPharmacistsApiPath)).toHaveBeenCalledWith();
  });

  it('associates credential dialog fields with visible labels', () => {
    render(<PharmacistCredentialsContent />);

    fireEvent.click(screen.getByRole('button', { name: '資格を登録' }));

    expect(screen.getByLabelText('対象スタッフ')).toBeTruthy();
    expect(screen.getByLabelText('認定種別')).toBeTruthy();
    expect(screen.getByLabelText('認定番号')).toBeTruthy();
    expect(screen.getByLabelText('交付日')).toBeTruthy();
    expect(screen.getByLabelText('有効期限')).toBeTruthy();
    expect(screen.getByLabelText('在籍年数')).toBeTruthy();
    expect(screen.getByLabelText('週勤務時間')).toBeTruthy();
  });

  it('uses shared org JSON headers when saving a credential', async () => {
    const jsonHeaders = {
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
      'x-test-helper': 'json',
    };
    vi.mocked(buildOrgJsonHeaders).mockReturnValue(jsonHeaders);
    render(<PharmacistCredentialsContent />);

    const mutationOptions = mutationConfigs[0];
    await mutationOptions?.mutationFn?.();

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith(
      PHARMACIST_CREDENTIALS_API_PATH,
      expect.objectContaining({
        method: 'POST',
        headers: jsonHeaders,
      }),
    );
    expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1');
  });

  it('surfaces reversed credential dates and invalid numeric fields inline', () => {
    render(<PharmacistCredentialsContent />);

    fireEvent.click(screen.getByRole('button', { name: '資格を登録' }));

    fireEvent.change(screen.getByLabelText('対象スタッフ'), { target: { value: 'user_1' } });
    fireEvent.change(screen.getByLabelText('認定種別'), { target: { value: '研修認定' } });

    const issuedDate = screen.getByLabelText('交付日') as HTMLInputElement;
    const expiryDate = screen.getByLabelText('有効期限') as HTMLInputElement;
    const tenureYears = screen.getByLabelText('在籍年数') as HTMLInputElement;
    const weeklyWorkHours = screen.getByLabelText('週勤務時間') as HTMLInputElement;

    expect(tenureYears.min).toBe('0');
    expect(tenureYears.max).toBe('80');
    expect(tenureYears.step).toBe('0.1');
    expect(tenureYears.inputMode).toBe('decimal');
    expect(weeklyWorkHours.min).toBe('0');
    expect(weeklyWorkHours.max).toBe('168');
    expect(weeklyWorkHours.step).toBe('0.5');

    fireEvent.change(issuedDate, { target: { value: '2027-04-01' } });
    fireEvent.change(expiryDate, { target: { value: '2025-04-01' } });
    fireEvent.change(tenureYears, { target: { value: '81' } });
    fireEvent.change(weeklyWorkHours, { target: { value: '169' } });

    expect(screen.getAllByText('有効期限は交付日以降の日付を指定してください。')).toHaveLength(2);
    expect(screen.getByText('在籍年数は0〜80の数値で入力してください。')).toBeTruthy();
    expect(screen.getByText('週勤務時間は0〜168の数値で入力してください。')).toBeTruthy();
    expect(expiryDate.getAttribute('aria-invalid')).toBe('true');
    expect(tenureYears.getAttribute('aria-describedby')).toContain('credential-tenure-years-error');

    const saveButton = screen.getByRole('button', { name: '保存' });
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);
    expect(saveButton.getAttribute('aria-describedby')).toBe('credential-save-blocker');

    fireEvent.click(saveButton);
    expect(mutationMutateMock).not.toHaveBeenCalled();
  });

  it('shows ErrorState (not a false-empty table) with retry when the credentials query fails', () => {
    const refetch = vi.fn();
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[0] === 'pharmacist-credentials') {
        // 取得失敗 → 空一覧(false-empty)ではなく ErrorState + 再読み込み。
        return { data: undefined, isLoading: false, isError: true, refetch };
      }
      return defaultUseQueryImpl({ queryKey });
    });

    render(<PharmacistCredentialsContent />);

    expect(screen.getByText('サーバーエラーが発生しました')).toBeTruthy();
    // 空のテーブルを描画していないこと(false-empty 回避)。
    expect(screen.queryByTestId('credentials-table')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows hidden credential counts when the API returns a truncated list', () => {
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[0] === 'pharmacist-credentials') {
        return {
          data: {
            data: [credentialFixture()],
            total_count: 3,
            visible_count: 1,
            hidden_count: 2,
            truncated: true,
            count_basis: 'pharmacist_credentials',
          },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        };
      }
      return defaultUseQueryImpl({ queryKey });
    });

    render(<PharmacistCredentialsContent />);

    expect(screen.getByText('先頭1件を表示 / 他2件')).toBeTruthy();
  });

  it('list query uses the centralized collection API path', async () => {
    let capturedQueryFn: (() => Promise<unknown>) | undefined;
    useQueryMock.mockImplementation(
      ({
        queryKey,
        queryFn,
      }: {
        queryKey: readonly unknown[];
        queryFn?: () => Promise<unknown>;
      }) => {
        if (queryKey[0] === 'pharmacist-credentials') {
          capturedQueryFn = queryFn;
        }
        return defaultUseQueryImpl({ queryKey });
      },
    );
    render(<PharmacistCredentialsContent />);

    await capturedQueryFn?.();

    expect(global.fetch).toHaveBeenCalledWith(
      PHARMACIST_CREDENTIALS_API_PATH,
      expect.objectContaining({ headers: { 'x-org-id': 'org_1' } }),
    );
  });

  it('create (POST) uses the centralized collection API path', async () => {
    render(<PharmacistCredentialsContent />);

    fireEvent.click(screen.getByRole('button', { name: '資格を登録' }));
    fireEvent.change(screen.getByLabelText('対象スタッフ'), { target: { value: 'user_1' } });
    fireEvent.change(screen.getByLabelText('認定種別'), { target: { value: '研修認定' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        PHARMACIST_CREDENTIALS_API_PATH,
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('update (PATCH) encodes a hostile credential id via the shared path helper', async () => {
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[0] === 'pharmacist-credentials') {
        return {
          data: {
            data: [credentialFixture('credential/a b?x#y')],
          },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        };
      }
      return defaultUseQueryImpl({ queryKey });
    });
    render(<PharmacistCredentialsContent />);

    fireEvent.click(screen.getByRole('button', { name: '山田 太郎 の 研修認定 を編集' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/pharmacist-credentials/credential%2Fa%20b%3Fx%23y',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
    expect(buildPharmacistCredentialApiPath).toHaveBeenCalledWith('credential/a b?x#y');
  });

  it('update (PATCH) with a dot-segment credential id fails closed before any PATCH fetch', async () => {
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[0] === 'pharmacist-credentials') {
        return {
          data: {
            data: [credentialFixture('.')],
          },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        };
      }
      return defaultUseQueryImpl({ queryKey });
    });
    render(<PharmacistCredentialsContent />);

    fireEvent.click(screen.getByRole('button', { name: '山田 太郎 の 研修認定 を編集' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(buildPharmacistCredentialApiPath).toHaveBeenCalledWith('.'));
    const patchCalls = vi
      .mocked(global.fetch)
      .mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');
    expect(patchCalls).toHaveLength(0);
  });

  it('DELETE encodes a hostile credential id via the shared path helper', async () => {
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[0] === 'pharmacist-credentials') {
        return {
          data: {
            data: [credentialFixture('credential/a b?x#y')],
          },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        };
      }
      return defaultUseQueryImpl({ queryKey });
    });
    render(<PharmacistCredentialsContent />);

    fireEvent.click(screen.getByRole('button', { name: '山田 太郎 の 研修認定 を失効' }));
    fireEvent.click(screen.getByRole('button', { name: '失効する' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/admin/pharmacist-credentials/credential%2Fa%20b%3Fx%23y',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
    expect(buildPharmacistCredentialApiPath).toHaveBeenCalledWith('credential/a b?x#y');
  });

  it('DELETE with a dot-segment credential id fails closed before any DELETE fetch', async () => {
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[0] === 'pharmacist-credentials') {
        return {
          data: {
            data: [credentialFixture('..')],
          },
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        };
      }
      return defaultUseQueryImpl({ queryKey });
    });
    render(<PharmacistCredentialsContent />);

    fireEvent.click(screen.getByRole('button', { name: '山田 太郎 の 研修認定 を失効' }));
    fireEvent.click(screen.getByRole('button', { name: '失効する' }));

    await waitFor(() => expect(buildPharmacistCredentialApiPath).toHaveBeenCalledWith('..'));
    const deleteCalls = vi
      .mocked(global.fetch)
      .mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE');
    expect(deleteCalls).toHaveLength(0);
  });

  it('surfaces a retry instead of a silent-empty staff dropdown when pharmacist options fail', () => {
    const refetch = vi.fn();
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[0] === 'pharmacist-options') {
        // スタッフ一覧の取得失敗 → 空の選択肢ではなく再読み込み導線。
        return { data: undefined, isLoading: false, isError: true, refetch };
      }
      return defaultUseQueryImpl({ queryKey });
    });

    render(<PharmacistCredentialsContent />);
    fireEvent.click(screen.getByRole('button', { name: '資格を登録' }));

    expect(screen.getByText('スタッフ一覧を取得できませんでした。')).toBeTruthy();
    // 取得失敗時はセレクトを描画していないこと(false-empty 回避)。
    expect(screen.queryByLabelText('対象スタッフ')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('names row actions by pharmacist and certification target', () => {
    render(<PharmacistCredentialsContent />);

    fireEvent.click(screen.getByRole('button', { name: '山田 太郎 の 研修認定 を編集' }));

    expect(screen.getByRole('dialog', { name: '資格情報を編集' })).toBeTruthy();
    expect((screen.getByLabelText('対象スタッフ') as HTMLSelectElement).value).toBe('user_1');
    expect((screen.getByLabelText('認定種別') as HTMLInputElement).value).toBe('研修認定');
    expect((screen.getByLabelText('認定番号') as HTMLInputElement).value).toBe('CERT-001');

    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    fireEvent.click(screen.getByRole('button', { name: '山田 太郎 の 研修認定 を失効' }));

    expect(screen.getByRole('dialog', { name: '資格情報を失効しますか' })).toBeTruthy();
    expect(screen.getByText('山田 太郎 の 研修認定 を削除します。')).toBeTruthy();
  });
});
