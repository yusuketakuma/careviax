// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { DataExplorerContent } from './data-explorer-content';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn(() => 'org_1'));
const mutationMutateMock = vi.hoisted(() => vi.fn());
const queryOptionsMock = vi.hoisted(() => vi.fn());
const queryErrorKeysMock = vi.hoisted(() => new Set<string>());
const queryLoadingKeysMock = vi.hoisted(() => new Set<string>());
const queryRefetchMocks = vi.hoisted(() => new Map<string, ReturnType<typeof vi.fn>>());
const rowsPayloadMock = vi.hoisted(() => ({
  value: {
    modelName: 'Patient',
    tableName: 'patients',
    coverageCategory: 'patient',
    coverageLabel: '患者',
    columns: [
      {
        name: 'name',
        type: 'String',
        kind: 'scalar',
        isList: false,
        isRequired: true,
        isEditable: true,
      },
    ],
    totalCount: 1,
    limit: 25,
    offset: 0,
    rows: [
      {
        id: 'patient_1',
        name: '山田 花子',
        drug_name: 'アムロジピン',
        email: 'hanako@example.test',
      },
      {
        id: 'patient_2',
        name: '佐藤 一郎',
        drug_name: 'メトホルミン',
        email: 'ichiro@example.test',
      },
    ],
  },
}));

function resetRowsPayload() {
  rowsPayloadMock.value = {
    modelName: 'Patient',
    tableName: 'patients',
    coverageCategory: 'patient',
    coverageLabel: '患者',
    columns: [
      {
        name: 'name',
        type: 'String',
        kind: 'scalar',
        isList: false,
        isRequired: true,
        isEditable: true,
      },
    ],
    totalCount: 1,
    limit: 25,
    offset: 0,
    rows: [
      {
        id: 'patient_1',
        name: '山田 花子',
        drug_name: 'アムロジピン',
        email: 'hanako@example.test',
      },
      {
        id: 'patient_2',
        name: '佐藤 一郎',
        drug_name: 'メトホルミン',
        email: 'ichiro@example.test',
      },
    ],
  };
}

type QueryMockOptions = {
  queryKey: readonly unknown[];
  enabled?: boolean;
};

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({
    mutate: mutationMutateMock,
    isPending: false,
  }),
  useQuery: (options: QueryMockOptions) => {
    queryOptionsMock(options);
    const { queryKey } = options;
    const key = queryKey[0];
    const queryName = String(key);
    let refetch = queryRefetchMocks.get(queryName);
    if (!refetch) {
      refetch = vi.fn();
      queryRefetchMocks.set(queryName, refetch);
    }

    if (queryErrorKeysMock.has(queryName)) {
      return {
        data: undefined,
        isLoading: false,
        isError: true,
        error: new Error('failed'),
        refetch,
      };
    }

    if (queryLoadingKeysMock.has(queryName)) {
      return {
        data: undefined,
        isLoading: true,
        isError: false,
        refetch,
      };
    }

    if (key === 'admin-data-explorer-models') {
      return {
        data: {
          data: [
            {
              modelName: 'Patient',
              tableName: 'patients',
              coverageCategory: 'patient',
              coverageLabel: '患者',
              rowCount: 1,
              scalarFieldCount: 2,
              editableFieldCount: 1,
              searchableField: 'name',
            },
          ],
        },
        isLoading: false,
        isError: false,
        refetch,
      };
    }

    if (key === 'admin-data-explorer-rows') {
      return {
        data: {
          data: rowsPayloadMock.value,
        },
        isLoading: false,
        isError: false,
        refetch,
      };
    }

    return { data: null, isLoading: false, isError: false, refetch };
  },
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe('DataExplorerContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryErrorKeysMock.clear();
    queryLoadingKeysMock.clear();
    queryRefetchMocks.clear();
    useOrgIdMock.mockReturnValue('org_1');
    resetRowsPayload();
  });

  it('exposes explorer filters and editor by accessible labels', () => {
    render(<DataExplorerContent />);

    expect(screen.getByLabelText('モデル検索')).toBeTruthy();
    expect(screen.getByLabelText('カテゴリフィルタ')).toBeTruthy();
    expect(screen.getByLabelText('行検索')).toBeTruthy();
    expect(screen.getByLabelText('許可フィールド JSON')).toBeTruthy();
  });

  it('loads session-scoped models and rows before the org store hydrates', () => {
    useOrgIdMock.mockReturnValue('');

    render(<DataExplorerContent />);

    expect(screen.getAllByText('patients').length).toBeGreaterThan(0);
    expect(screen.getByText('山田 花子')).toBeTruthy();

    const queryOptions = queryOptionsMock.mock.calls.map(
      ([options]) => options as QueryMockOptions,
    );
    const modelsQuery = queryOptions.find(
      (options) => options.queryKey[0] === 'admin-data-explorer-models',
    );
    const rowsQuery = queryOptions.find(
      (options) => options.queryKey[0] === 'admin-data-explorer-rows',
    );

    expect(modelsQuery?.queryKey).toEqual(['admin-data-explorer-models', '']);
    expect(modelsQuery?.enabled).not.toBe(false);
    expect(rowsQuery?.queryKey).toEqual(['admin-data-explorer-rows', '', 'patients', '']);
    expect(rowsQuery?.enabled).toBe(true);
  });

  it('keeps PHI out of row selection accessible names', () => {
    render(<DataExplorerContent />);

    expect(screen.getByRole('button', { name: 'patients テーブルの 1 行目を選択' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'patients テーブルの 2 行目を選択' })).toBeTruthy();
    expect(screen.getByText('山田 花子')).toBeTruthy();
    expect(screen.getByText('佐藤 一郎')).toBeTruthy();
    expect(
      screen.queryByRole('button', {
        name: /山田|花子|佐藤|一郎|アムロジピン|メトホルミン|@|patient_1|patient_2/,
      }),
    ).toBeNull();
  });

  it('connects missing-selection disabled reasons to editor controls', () => {
    rowsPayloadMock.value = {
      ...rowsPayloadMock.value,
      rows: [],
      totalCount: 0,
    };

    render(<DataExplorerContent />);

    const reason = screen.getByText('レコードを選択してください。');
    const textarea = screen.getByLabelText('許可フィールド JSON') as HTMLTextAreaElement;
    const saveButton = screen.getByRole('button', { name: /保存/ }) as HTMLButtonElement;
    const resetButton = screen.getByRole('button', { name: /リセット/ }) as HTMLButtonElement;

    expect(reason.id).toBe('data-explorer-editor-disabled-reason');
    expect(reason.textContent).not.toMatch(/山田|花子|アムロジピン|@|patient_1/);
    expect(textarea.disabled).toBe(true);
    expect(textarea.getAttribute('aria-describedby')).toBe(reason.id);
    expect(saveButton.disabled).toBe(true);
    expect(saveButton.getAttribute('aria-describedby')).toBe(reason.id);
    expect(resetButton.disabled).toBe(true);
    expect(resetButton.getAttribute('aria-describedby')).toBe(reason.id);
  });

  it('connects readonly editor disabled reasons to editor controls', () => {
    rowsPayloadMock.value = {
      ...rowsPayloadMock.value,
      columns: rowsPayloadMock.value.columns.map((column) => ({ ...column, isEditable: false })),
    };

    render(<DataExplorerContent />);

    const reason = screen.getByText('このテーブルは閲覧のみです。');
    const textarea = screen.getByLabelText('許可フィールド JSON') as HTMLTextAreaElement;
    const saveButton = screen.getByRole('button', { name: /保存/ }) as HTMLButtonElement;
    const resetButton = screen.getByRole('button', { name: /リセット/ }) as HTMLButtonElement;

    expect(reason.id).toBe('data-explorer-editor-disabled-reason');
    expect(reason.textContent).not.toMatch(/山田|花子|アムロジピン|@|patient_1/);
    expect(textarea.disabled).toBe(true);
    expect(textarea.getAttribute('aria-describedby')).toBe(reason.id);
    expect(saveButton.disabled).toBe(true);
    expect(saveButton.getAttribute('aria-describedby')).toBe(reason.id);
    expect(resetButton.disabled).toBe(true);
    expect(resetButton.getAttribute('aria-describedby')).toBe(reason.id);
  });

  it('shows a retryable error instead of an empty model list when models fail to load', () => {
    queryErrorKeysMock.add('admin-data-explorer-models');

    render(<DataExplorerContent />);

    expect(screen.getByText('モデル一覧を取得できませんでした')).toBeTruthy();
    expect(screen.queryByText('一致するモデルがありません。')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(queryRefetchMocks.get('admin-data-explorer-models')).toHaveBeenCalledTimes(1);
  });

  it('uses an announced skeleton while models are loading', () => {
    queryLoadingKeysMock.add('admin-data-explorer-models');

    render(<DataExplorerContent />);

    expect(screen.getByRole('status', { name: 'モデル一覧を読み込み中' })).toBeTruthy();
    expect(screen.queryByText('読み込み中...', { selector: 'div' })).toBeNull();
  });

  it('shows a retryable error instead of an empty row list when rows fail to load', () => {
    queryErrorKeysMock.add('admin-data-explorer-rows');

    render(<DataExplorerContent />);

    expect(screen.getByText('テーブルデータを取得できませんでした')).toBeTruthy();
    expect(screen.queryByText('一致するレコードがありません。')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(queryRefetchMocks.get('admin-data-explorer-rows')).toHaveBeenCalledTimes(1);
  });

  it('uses an announced skeleton while table rows are loading', () => {
    queryLoadingKeysMock.add('admin-data-explorer-rows');

    render(<DataExplorerContent />);

    expect(screen.getByRole('status', { name: 'テーブルデータを読み込み中' })).toBeTruthy();
    expect(screen.queryByText('読み込み中...', { selector: 'div' })).toBeNull();
  });
});
