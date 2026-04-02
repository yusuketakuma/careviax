// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
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
            onSelectionChange={(rows) => {
              setSelectedRows(rows);
            }}
          />
        </div>
      );
    }

    render(<Harness />);

    expect(screen.getByText('selected:0')).not.toBeNull();
    expect(screen.getAllByRole('checkbox', { name: 'patient-1 を選択' }).length).toBeGreaterThan(0);
    expect(
      consoleErrorSpy.mock.calls.some(([message]) =>
        typeof message === 'string' && message.includes('Maximum update depth exceeded')
      )
    ).toBe(false);

    consoleErrorSpy.mockRestore();
  });
});
