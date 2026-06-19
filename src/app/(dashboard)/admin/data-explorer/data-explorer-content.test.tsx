// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { DataExplorerContent } from './data-explorer-content';

setupDomTestEnv();

const mutationMutateMock = vi.hoisted(() => vi.fn());
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

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({
    mutate: mutationMutateMock,
    isPending: false,
  }),
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    const key = queryKey[0];

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
      };
    }

    if (key === 'admin-data-explorer-rows') {
      return {
        data: {
          data: rowsPayloadMock.value,
        },
        isLoading: false,
      };
    }

    return { data: null, isLoading: false };
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
    resetRowsPayload();
  });

  it('exposes explorer filters and editor by accessible labels', () => {
    render(<DataExplorerContent />);

    expect(screen.getByLabelText('モデル検索')).toBeTruthy();
    expect(screen.getByLabelText('カテゴリフィルタ')).toBeTruthy();
    expect(screen.getByLabelText('行検索')).toBeTruthy();
    expect(screen.getByLabelText('許可フィールド JSON')).toBeTruthy();
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
});
