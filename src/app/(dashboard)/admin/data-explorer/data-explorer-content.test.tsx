// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { DataExplorerContent } from './data-explorer-content';

setupDomTestEnv();

const mutationMutateMock = vi.hoisted(() => vi.fn());

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
          data: {
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
            rows: [{ id: 'patient_1', name: '山田 花子' }],
          },
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
  });

  it('exposes explorer filters and editor by accessible labels', () => {
    render(<DataExplorerContent />);

    expect(screen.getByLabelText('モデル検索')).toBeTruthy();
    expect(screen.getByLabelText('カテゴリフィルタ')).toBeTruthy();
    expect(screen.getByLabelText('行検索')).toBeTruthy();
    expect(screen.getByLabelText('許可フィールド JSON')).toBeTruthy();
  });
});
