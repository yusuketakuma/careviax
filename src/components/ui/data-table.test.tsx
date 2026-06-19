// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { DataTable } from './data-table';

setupDomTestEnv();

type RowData = {
  id: string;
  name: string;
};

const columns: ColumnDef<RowData>[] = [
  {
    accessorKey: 'name',
    header: '氏名',
  },
];

function expectButtonDisabled(name: string, disabled: boolean) {
  expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(disabled);
}

describe('DataTable', () => {
  it('does not loop when the parent passes an inline selection callback that sets state', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    function Harness() {
      const [selectedRows, setSelectedRows] = useState<RowData[]>([]);

      return (
        <div>
          <p>selected:{selectedRows.length}</p>
          <DataTable
            columns={columns}
            data={[{ id: 'patient-1', name: '山田 太郎' }]}
            enableRowSelection
            getRowId={(row) => row.id}
            getRowA11yLabel={(row) => row.name}
            onSelectionChange={(rows) => {
              setSelectedRows(rows);
            }}
          />
        </div>
      );
    }

    render(<Harness />);

    expect(screen.getByText('selected:0')).not.toBeNull();
    expect(screen.getAllByRole('checkbox', { name: '山田 太郎 を選択' }).length).toBeGreaterThan(0);
    expect(
      consoleErrorSpy.mock.calls.some(
        ([message]) =>
          typeof message === 'string' && message.includes('Maximum update depth exceeded'),
      ),
    ).toBe(false);

    consoleErrorSpy.mockRestore();
  });

  it('shows a retryable error alert without replacing the table contract', () => {
    const onRetry = vi.fn();

    render(
      <DataTable
        columns={columns}
        data={[]}
        errorMessage="一覧を取得できませんでした"
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain('一覧を取得できませんでした');
    expect(screen.queryByText('データがありません')).toBeNull();
    expect(screen.getAllByText('取得エラーのため一覧を表示できません').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('disables export and print actions while table data is invalid', () => {
    const toolbar = { enableExport: true, enablePrint: true };
    const { rerender } = render(<DataTable columns={columns} data={[]} toolbar={toolbar} />);

    expectButtonDisabled('CSV出力', true);
    expectButtonDisabled('印刷', true);
    expect(screen.getByRole('button', { name: 'CSV出力' }).getAttribute('aria-describedby')).toBe(
      screen.getByText('出力できる行がありません').id,
    );

    rerender(
      <DataTable
        columns={columns}
        data={[{ id: 'patient-1', name: '山田 太郎' }]}
        isLoading
        toolbar={toolbar}
      />,
    );

    expectButtonDisabled('CSV出力', true);

    rerender(
      <DataTable
        columns={columns}
        data={[{ id: 'patient-1', name: '山田 太郎' }]}
        errorMessage="取得できませんでした"
        toolbar={toolbar}
      />,
    );

    expectButtonDisabled('CSV出力', true);

    rerender(
      <DataTable
        columns={columns}
        data={[{ id: 'patient-1', name: '山田 太郎' }]}
        toolbar={toolbar}
      />,
    );

    expectButtonDisabled('CSV出力', false);
    expectButtonDisabled('印刷', false);
  });

  it('names clickable desktop and mobile rows from the row accessibility label', () => {
    const onRowClick = vi.fn();

    render(
      <DataTable
        columns={columns}
        data={[{ id: 'draft-1', name: 'QR下書き 1件目' }]}
        getRowId={(row) => row.id}
        getRowA11yLabel={(row) => row.name}
        onRowClick={onRowClick}
      />,
    );

    const rowButtons = screen.getAllByRole('button', { name: 'QR下書き 1件目 の詳細を表示' });
    expect(rowButtons.length).toBeGreaterThanOrEqual(2);

    fireEvent.keyDown(rowButtons[0], { key: 'Enter', code: 'Enter' });

    expect(onRowClick).toHaveBeenCalledWith(0);
  });
});
