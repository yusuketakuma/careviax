// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildApprovedServerExportDescriptor } from '@/lib/audit/server-export-registry';
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
            toolbar={{ enableColumnVisibility: false }}
          />
        </div>
      );
    }

    render(<Harness />);

    expect(screen.getByText('selected:0')).not.toBeNull();
    expect(screen.getAllByRole('checkbox', { name: '山田 太郎 を選択' }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('checkbox', { name: '山田 太郎 を選択' })[0]!);
    expect(screen.getByText('選択中1件（現在表示中の読込済み行から選択）')).toBeTruthy();
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
    const toolbar = {
      clientExport: { enabled: true, nonPhiExport: true } as const,
      enablePrint: true,
    };
    const { rerender } = render(<DataTable columns={columns} data={[]} toolbar={toolbar} />);

    expectButtonDisabled('非PHI読込済みCSV出力', true);
    expectButtonDisabled('印刷', true);
    expect(
      screen.getByRole('button', { name: '非PHI読込済みCSV出力' }).getAttribute('aria-describedby'),
    ).toBe(screen.getByText('出力できる行がありません').id);

    rerender(
      <DataTable
        columns={columns}
        data={[{ id: 'patient-1', name: '山田 太郎' }]}
        isLoading
        toolbar={toolbar}
      />,
    );

    expectButtonDisabled('非PHI読込済みCSV出力', true);

    rerender(
      <DataTable
        columns={columns}
        data={[{ id: 'patient-1', name: '山田 太郎' }]}
        errorMessage="取得できませんでした"
        toolbar={toolbar}
      />,
    );

    expectButtonDisabled('非PHI読込済みCSV出力', true);

    rerender(
      <DataTable
        columns={columns}
        data={[{ id: 'patient-1', name: '山田 太郎' }]}
        toolbar={toolbar}
      />,
    );

    expectButtonDisabled('非PHI読込済みCSV出力', false);
    expectButtonDisabled('印刷', false);
  });

  it('separates true empty data from filtered empty results', () => {
    const { rerender } = render(<DataTable columns={columns} data={[]} />);

    expect(
      screen.getAllByRole('heading', { level: 3, name: 'データがありません' }).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText('検索語やフィルタを減らすと、表示できる行が戻ります。')).toBeNull();

    rerender(
      <DataTable
        columns={columns}
        data={[{ id: 'patient-1', name: '山田 太郎' }]}
        toolbar={{ enableGlobalFilter: true }}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('テーブル内を絞り込み'), {
      target: { value: '存在しない患者' },
    });

    expect(
      screen.getAllByRole('heading', { level: 3, name: '条件に一致する行がありません' }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText('検索語やフィルタを減らすと、表示できる行が戻ります。').length,
    ).toBeGreaterThan(0);
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
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.keyDown(rowButtons[0], { key: 'Enter', code: 'Enter' });

    expect(onRowClick).toHaveBeenCalledWith(0);
  });

  it('can expose clickable rows as a selected listbox without changing source-index activation', () => {
    const onRowClick = vi.fn();

    render(
      <DataTable
        columns={columns}
        data={[
          { id: 'row-0', name: 'Zulu' },
          { id: 'row-1', name: 'Alpha' },
        ]}
        selectedRowIndex={1}
        getRowId={(row) => row.id}
        getRowA11yLabel={(row) => row.name}
        onRowClick={onRowClick}
        rowInteractionMode="selectable-listbox"
        listboxLabel="処方受付一覧"
      />,
    );

    expect(screen.getAllByRole('listbox', { name: '処方受付一覧' }).length).toBeGreaterThanOrEqual(
      2,
    );
    expect(screen.queryByRole('button', { name: 'Alpha の詳細を表示' })).toBeNull();

    const alphaOptions = screen.getAllByRole('option', { name: 'Alpha' });
    const zuluOptions = screen.getAllByRole('option', { name: 'Zulu' });
    expect(alphaOptions.length).toBeGreaterThanOrEqual(2);
    expect(zuluOptions.length).toBeGreaterThanOrEqual(2);
    for (const option of alphaOptions) {
      expect(option.getAttribute('aria-selected')).toBe('true');
      expect(option.getAttribute('tabindex')).toBe('0');
      expect(option.className).toContain('ring');
    }
    for (const option of zuluOptions) {
      expect(option.getAttribute('aria-selected')).toBe('false');
      expect(option.getAttribute('tabindex')).toBe('-1');
    }

    fireEvent.click(alphaOptions[0]);
    expect(onRowClick).toHaveBeenCalledWith(1);

    onRowClick.mockClear();
    fireEvent.keyDown(alphaOptions[0], { key: 'Enter', code: 'Enter' });
    expect(onRowClick).toHaveBeenCalledWith(1);

    onRowClick.mockClear();
    fireEvent.keyDown(alphaOptions[0], { key: ' ', code: 'Space' });
    expect(onRowClick).toHaveBeenCalledWith(1);
  });

  it('keeps desktop row activation tied to the source data index after sorting', () => {
    const onRowClick = vi.fn();

    render(
      <DataTable
        columns={columns}
        data={[
          { id: 'row-0', name: 'Zulu' },
          { id: 'row-1', name: 'Alpha' },
        ]}
        selectedRowIndex={1}
        getRowId={(row) => row.id}
        getRowA11yLabel={(row) => row.name}
        onRowClick={onRowClick}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '氏名 で並び替え' }));

    const alphaDesktopRow = within(screen.getByRole('table')).getByRole('button', {
      name: 'Alpha の詳細を表示',
    });

    expect(alphaDesktopRow.className).toContain('ring-primary/50');

    fireEvent.click(alphaDesktopRow);
    expect(onRowClick).toHaveBeenCalledWith(1);

    onRowClick.mockClear();
    fireEvent.keyDown(alphaDesktopRow, { key: 'Enter', code: 'Enter' });
    expect(onRowClick).toHaveBeenCalledWith(1);
  });

  it('keeps desktop row activation tied to the source data index after filtering', () => {
    const onRowClick = vi.fn();

    render(
      <DataTable
        columns={columns}
        data={[
          { id: 'row-0', name: 'Bravo' },
          { id: 'row-1', name: 'Alpha' },
          { id: 'row-2', name: 'Zulu' },
        ]}
        selectedRowIndex={1}
        getRowId={(row) => row.id}
        getRowA11yLabel={(row) => row.name}
        onRowClick={onRowClick}
        toolbar={{ enableGlobalFilter: true }}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('テーブル内を絞り込み'), {
      target: { value: 'Alpha' },
    });

    const alphaDesktopRow = within(screen.getByRole('table')).getByRole('button', {
      name: 'Alpha の詳細を表示',
    });

    expect(alphaDesktopRow.className).toContain('ring-primary/50');

    fireEvent.click(alphaDesktopRow);
    expect(onRowClick).toHaveBeenCalledWith(1);

    onRowClick.mockClear();
    fireEvent.keyDown(alphaDesktopRow, { key: 'Enter', code: 'Enter' });
    expect(onRowClick).toHaveBeenCalledWith(1);
  });

  it('keeps selectable-listbox row activation tied to the source data index after sorting and filtering', () => {
    const onRowClick = vi.fn();

    render(
      <DataTable
        columns={columns}
        data={[
          { id: 'row-0', name: 'Bravo' },
          { id: 'row-1', name: 'Alpha' },
          { id: 'row-2', name: 'Zulu' },
        ]}
        selectedRowIndex={1}
        getRowId={(row) => row.id}
        getRowA11yLabel={(row) => row.name}
        onRowClick={onRowClick}
        rowInteractionMode="selectable-listbox"
        listboxLabel="処方受付一覧"
        toolbar={{ enableGlobalFilter: true }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '氏名 で並び替え' }));
    fireEvent.change(screen.getByPlaceholderText('テーブル内を絞り込み'), {
      target: { value: 'Alpha' },
    });

    const alphaDesktopOption = within(screen.getByRole('table')).getByRole('option', {
      name: 'Alpha',
    });
    expect(alphaDesktopOption.getAttribute('aria-selected')).toBe('true');
    expect(alphaDesktopOption.getAttribute('tabindex')).toBe('0');

    fireEvent.click(alphaDesktopOption);
    expect(onRowClick).toHaveBeenCalledWith(1);
  });

  it('does not emit stale option rows while selectable-listbox data is loading, failed, or empty', () => {
    const onRowClick = vi.fn();

    const { rerender } = render(
      <DataTable
        columns={columns}
        data={[]}
        isLoading
        onRowClick={onRowClick}
        rowInteractionMode="selectable-listbox"
        listboxLabel="処方受付一覧"
      />,
    );

    expect(screen.queryAllByRole('option')).toHaveLength(0);

    rerender(
      <DataTable
        columns={columns}
        data={[]}
        errorMessage="取得できませんでした"
        onRowClick={onRowClick}
        rowInteractionMode="selectable-listbox"
        listboxLabel="処方受付一覧"
      />,
    );
    expect(screen.queryAllByRole('option')).toHaveLength(0);

    rerender(
      <DataTable
        columns={columns}
        data={[]}
        onRowClick={onRowClick}
        rowInteractionMode="selectable-listbox"
        listboxLabel="処方受付一覧"
      />,
    );
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('neutralizes CSV formula-prefix cells on client export (matches server-side safe-csv)', async () => {
    const createObjectURL = vi.fn<(object: Blob | MediaSource) => string>(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;

    try {
      render(
        <DataTable
          columns={columns}
          data={[{ id: 'evil-1', name: '=SUM(A1:A9)' }]}
          toolbar={{ clientExport: { enabled: true, nonPhiExport: true } }}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: '非PHI読込済みCSV出力' }));

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const [blob] = createObjectURL.mock.calls[0] ?? [];
      if (!(blob instanceof Blob)) {
        throw new Error('CSV export did not pass a Blob to URL.createObjectURL');
      }
      const csv = await blob.text();

      // Cell starting with '=' must be prefixed with an apostrophe so spreadsheets
      // treat it as text, not a live formula (CSV injection). This mirrors the
      // server-side export path (src/lib/csv/safe-csv.ts) that all 7 export routes use.
      expect(anchorClick).toHaveBeenCalledTimes(1);
      expect(csv).toContain('"\'=SUM(A1:A9)"');
      expect(csv).not.toContain('"=SUM(A1:A9)"');
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      anchorClick.mockRestore();
    }
  });

  it('does not expose client CSV export without explicit non-PHI opt-in', () => {
    render(
      <DataTable columns={columns} data={[{ id: 'safe-1', name: 'Non PHI row' }]} toolbar={{}} />,
    );

    expect(screen.queryByRole('button', { name: '非PHI読込済みCSV出力' })).toBeNull();
  });

  it('falls back to a safe non-PHI client export filename', () => {
    const createObjectURL = vi.fn<(object: Blob | MediaSource) => string>(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;

    try {
      render(
        <DataTable
          columns={columns}
          data={[{ id: 'safe-1', name: 'Non PHI row' }]}
          toolbar={{
            clientExport: {
              enabled: true,
              nonPhiExport: true,
              fileName: 'operations-summary.csv',
            },
          }}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: '非PHI読込済みCSV出力' }));

      const downloadedAnchor = anchorClick.mock.instances[0] as HTMLAnchorElement | undefined;
      expect(downloadedAnchor?.download).toBe('operations-summary.csv');
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      anchorClick.mockRestore();
    }
  });

  it('rejects unsafe client export filenames', () => {
    const createObjectURL = vi.fn<(object: Blob | MediaSource) => string>(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;

    try {
      render(
        <DataTable
          columns={columns}
          data={[{ id: 'safe-1', name: 'Non PHI row' }]}
          toolbar={{
            clientExport: {
              enabled: true,
              nonPhiExport: true,
              fileName: '山田 太郎.csv',
            },
          }}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: '非PHI読込済みCSV出力' }));

      const downloadedAnchor = anchorClick.mock.instances[0] as HTMLAnchorElement | undefined;
      expect(downloadedAnchor?.download).toBe('table-export.csv');
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      anchorClick.mockRestore();
    }
  });

  it('disables client CSV export when more rows exist server-side', () => {
    render(
      <DataTable
        columns={columns}
        data={[{ id: 'loaded-1', name: '読込済み患者' }]}
        hasMore
        onLoadMore={vi.fn()}
        toolbar={{ clientExport: { enabled: true, nonPhiExport: true } }}
      />,
    );

    const exportButton = screen.getByRole('button', { name: '非PHI読込済みCSV出力' });
    const warning = screen.getByText(
      '未読込行があるため、読込済みCSV出力は使えません。検索条件全件出力を使用してください。',
    );

    expect((exportButton as HTMLButtonElement).disabled).toBe(true);
    expect(exportButton.getAttribute('aria-describedby')).toBe(warning.id);
    expect(screen.queryByRole('button', { name: 'CSV出力' })).toBeNull();
  });

  it('separates loaded-row CSV export from server-side full export scope', () => {
    render(
      <DataTable
        columns={columns}
        data={[{ id: 'loaded-1', name: '読込済み患者' }]}
        hasMore
        onLoadMore={vi.fn()}
        toolbar={{
          clientExport: { enabled: true, nonPhiExport: true },
          serverExport: buildApprovedServerExportDescriptor(
            'communication_requests_external_csv',
            '/api/communication-requests/export?profile=external',
          ),
        }}
      />,
    );

    const loadedExportButton = screen.getByRole('button', { name: '非PHI読込済みCSV出力' });
    const serverExportLink = screen.getByRole('link', { name: '検索条件全件CSV出力' });
    const serverExportDescription = screen.getByText(
      '監査ログを残し、外部共有向けに PHI を抑制した検索条件全件を出力します。',
    );

    expect(serverExportLink.getAttribute('href')).toBe(
      '/api/communication-requests/export?profile=external',
    );
    expect(serverExportLink.getAttribute('aria-describedby')).toBe(serverExportDescription.id);
    expect(serverExportLink.className).toContain('min-h-[44px]');
    expect(serverExportLink.className).toContain('!min-h-[44px]');
    expect((loadedExportButton as HTMLButtonElement).disabled).toBe(true);
    expect(loadedExportButton.getAttribute('aria-describedby')).toBe(
      screen.getByText(
        '未読込行があるため、読込済みCSV出力は使えません。検索条件全件出力を使用してください。',
      ).id,
    );
  });

  it('fails closed when server-side full export points outside the app', () => {
    render(
      <DataTable
        columns={columns}
        data={[{ id: 'loaded-1', name: '読込済み患者' }]}
        toolbar={{
          serverExport: {
            surfaceId: 'communication_requests_external_csv',
            endpoint: 'https://evil.example/export.csv' as '/api/reports/export',
            auditEvent: 'communication_requests_export',
            maskingProfile: 'communication_requests_external_redacted_csv',
            description: '監査ログを残し、外部共有向けに PHI を抑制した検索条件全件を出力します。',
          },
        }}
      />,
    );

    const serverExportButton = screen.getByRole('button', { name: '検索条件全件CSV出力' });
    const disabledReason = screen.getByText(
      '全件出力のURLが安全な同一アプリ内APIパスではありません',
    );

    expect((serverExportButton as HTMLButtonElement).disabled).toBe(true);
    expect(serverExportButton.getAttribute('aria-describedby')).toBe(disabledReason.id);
    expect(screen.queryByRole('link', { name: '検索条件全件CSV出力' })).toBeNull();
  });

  it('fails closed when server-side full export metadata is not approved for its surface', () => {
    render(
      <DataTable
        columns={columns}
        data={[{ id: 'loaded-1', name: '読込済み患者' }]}
        toolbar={{
          serverExport: {
            ...buildApprovedServerExportDescriptor(
              'communication_requests_external_csv',
              '/api/communication-requests/export?profile=external',
            ),
            maskingProfile: 'unsafe_raw_profile',
          },
        }}
      />,
    );

    const serverExportButton = screen.getByRole('button', { name: '検索条件全件CSV出力' });
    const disabledReason = screen.getByText(
      '全件出力の監査・マスキング情報が承認済み surface と一致しません',
    );

    expect((serverExportButton as HTMLButtonElement).disabled).toBe(true);
    expect(serverExportButton.getAttribute('aria-describedby')).toBe(disabledReason.id);
    expect(screen.queryByRole('link', { name: '検索条件全件CSV出力' })).toBeNull();
  });

  it('fails closed when server-side full export endpoint does not match the approved surface', () => {
    render(
      <DataTable
        columns={columns}
        data={[{ id: 'loaded-1', name: '読込済み患者' }]}
        toolbar={{
          serverExport: buildApprovedServerExportDescriptor(
            'communication_requests_external_csv',
            '/api/billing-candidates/export?format=csv',
          ),
        }}
      />,
    );

    const serverExportButton = screen.getByRole('button', { name: '検索条件全件CSV出力' });
    const disabledReason = screen.getByText('全件出力のURLが承認済み surface と一致しません');

    expect((serverExportButton as HTMLButtonElement).disabled).toBe(true);
    expect(serverExportButton.getAttribute('aria-describedby')).toBe(disabledReason.id);
    expect(screen.queryByRole('link', { name: '検索条件全件CSV出力' })).toBeNull();
  });

  it('names row-selection scope as current loaded rows', () => {
    render(
      <DataTable
        columns={columns}
        data={[
          { id: 'loaded-1', name: '読込済み患者1' },
          { id: 'loaded-2', name: '読込済み患者2' },
        ]}
        hasMore
        enableRowSelection
        getRowId={(row) => row.id}
        getRowA11yLabel={(row) => row.name}
        toolbar={{ enableColumnVisibility: false }}
      />,
    );

    fireEvent.click(screen.getAllByRole('checkbox', { name: '読込済み患者1 を選択' })[0]!);

    expect(screen.getByText('選択中1件（現在表示中の読込済み行から選択）')).toBeTruthy();
    expect(screen.getAllByRole('checkbox', { name: '現在表示中の読込済み行をすべて選択' }));
  });

  it('does not export filtered loaded rows when server-side rows are still unloaded', async () => {
    const createObjectURL = vi.fn<(object: Blob | MediaSource) => string>(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
    const onLoadMore = vi.fn();

    try {
      render(
        <DataTable
          columns={columns}
          data={[
            { id: 'loaded-1', name: 'Alpha Loaded' },
            { id: 'loaded-2', name: 'Bravo Loaded' },
          ]}
          hasMore
          onLoadMore={onLoadMore}
          toolbar={{
            clientExport: { enabled: true, nonPhiExport: true },
            enableGlobalFilter: true,
          }}
        />,
      );

      fireEvent.change(screen.getByPlaceholderText('テーブル内を絞り込み'), {
        target: { value: 'Alpha' },
      });

      const exportButton = screen.getByRole('button', { name: '非PHI読込済みCSV出力' });
      const warning = screen.getByText(
        '未読込行があるため、読込済みCSV出力は使えません。検索条件全件出力を使用してください。',
      );
      expect((exportButton as HTMLButtonElement).disabled).toBe(true);
      expect(exportButton.getAttribute('aria-describedby')).toBe(warning.id);
      fireEvent.click(exportButton);

      expect(onLoadMore).not.toHaveBeenCalled();
      expect(anchorClick).not.toHaveBeenCalled();
      expect(createObjectURL).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'CSV出力' })).toBeNull();
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      anchorClick.mockRestore();
    }
  });

  it('uses column exportValue for explicitly non-PHI client CSV snapshots', async () => {
    type NonPhiRow = {
      id: string;
      displayName: string;
      internalNote: string;
      exportLabel: string;
    };
    const nonPhiColumns: ColumnDef<NonPhiRow>[] = [
      {
        accessorKey: 'displayName',
        header: '表示名',
        meta: { exportValue: (row: NonPhiRow) => row.exportLabel },
      },
      {
        accessorKey: 'internalNote',
        header: '内部メモ',
        meta: { exportValue: () => 'メモは出力対象外' },
      },
    ];
    const createObjectURL = vi.fn<(object: Blob | MediaSource) => string>(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;

    try {
      render(
        <DataTable
          columns={nonPhiColumns}
          data={[
            {
              id: 'row_1',
              displayName: '公開ラベル',
              internalNote: 'raw provider error',
              exportLabel: '公開ラベルのみ',
            },
          ]}
          toolbar={{
            clientExport: {
              enabled: true,
              nonPhiExport: true,
              fileName: 'safe-export.csv',
            },
          }}
        />,
      );

      expect(screen.getAllByText('公開ラベル').length).toBeGreaterThan(0);
      expect(screen.getAllByText('raw provider error').length).toBeGreaterThan(0);

      fireEvent.click(screen.getByRole('button', { name: '非PHI読込済みCSV出力' }));

      expect(anchorClick).toHaveBeenCalledTimes(1);
      const [blob] = createObjectURL.mock.calls[0] ?? [];
      if (!(blob instanceof Blob)) {
        throw new Error('CSV export did not pass a Blob to URL.createObjectURL');
      }
      const csv = await blob.text();
      expect(csv).toContain('公開ラベルのみ');
      expect(csv).toContain('メモは出力対象外');
      expect(csv).not.toContain('row_1');
      expect(csv).not.toContain('raw provider error');
      const downloadedAnchor = anchorClick.mock.instances[0] as HTMLAnchorElement | undefined;
      expect(downloadedAnchor?.download).toBe('safe-export.csv');
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      anchorClick.mockRestore();
    }
  });

  it('does not paginate by default (existing screens keep rendering every row)', () => {
    const manyRows: RowData[] = Array.from({ length: 120 }, (_, index) => ({
      id: `row-${index}`,
      name: `患者 ${index}`,
    }));

    render(<DataTable columns={columns} data={manyRows} />);

    expect(screen.getAllByText(/患者 /).length).toBeGreaterThanOrEqual(120);
    expect(screen.queryByTestId('data-table-pagination')).toBeNull();
  });

  it('paginates client-side when opted in, with a counted-list summary and working pager', () => {
    const manyRows: RowData[] = Array.from({ length: 250 }, (_, index) => ({
      id: `row-${index}`,
      name: `患者 ${index.toString().padStart(3, '0')}`,
    }));

    render(<DataTable columns={columns} data={manyRows} enablePagination pageSize={100} />);

    // 1ページ目: 100件のみ描画、件数は総数(250件)を明示する(counted-list contract)。
    const table = screen.getByRole('table');
    expect(within(table).getAllByText(/患者 /).length).toBe(100);
    expect(within(table).getByText('患者 000')).toBeTruthy();
    expect(within(table).queryByText('患者 100')).toBeNull();
    const summary = screen.getByTestId('data-table-pagination-summary');
    expect(summary.textContent).toContain('全250件中');
    expect(summary.textContent).toContain('1〜100件');
    expect(summary.textContent).toContain('1/3ページ');
    expect((screen.getByRole('button', { name: '前のページ' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.click(screen.getByRole('button', { name: '次のページ' }));

    expect(within(table).getByText('患者 100')).toBeTruthy();
    expect(within(table).queryByText('患者 000')).toBeNull();
    expect(screen.getByTestId('data-table-pagination-summary').textContent).toContain('101〜200件');
    expect((screen.getByRole('button', { name: '前のページ' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('does not call loaded cursor rows the full total when pagination and load-more are combined', () => {
    const manyRows: RowData[] = Array.from({ length: 250 }, (_, index) => ({
      id: `row-${index}`,
      name: `患者 ${index.toString().padStart(3, '0')}`,
    }));

    render(
      <DataTable
        columns={columns}
        data={manyRows}
        enablePagination
        pageSize={100}
        hasMore
        onLoadMore={vi.fn()}
      />,
    );

    const summary = screen.getByTestId('data-table-pagination-summary');
    expect(summary.textContent).toContain('読込済み250件中');
    expect(summary.textContent).toContain('未読込行あり');
    expect(summary.textContent).not.toContain('全250件中');
    expect(screen.getByRole('button', { name: 'さらに表示' })).toBeTruthy();
  });

  it('uses a table-specific load-more loading label instead of generic loading copy', () => {
    render(
      <DataTable
        columns={columns}
        data={[{ id: 'row-1', name: '山田 太郎' }]}
        hasMore
        isLoading
        onLoadMore={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '追加行を読み込み中...' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '読み込み中...' })).toBeNull();
  });

  it('resets to the first page when a filter narrows the paginated result set', () => {
    const manyRows: RowData[] = Array.from({ length: 250 }, (_, index) => ({
      id: `row-${index}`,
      name: index === 249 ? '該当患者' : `患者 ${index.toString().padStart(3, '0')}`,
    }));

    render(
      <DataTable
        columns={columns}
        data={manyRows}
        enablePagination
        pageSize={100}
        toolbar={{ enableGlobalFilter: true }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '次のページ' }));
    expect(screen.getByTestId('data-table-pagination-summary').textContent).toContain('101〜200件');

    fireEvent.change(screen.getByPlaceholderText('テーブル内を絞り込み'), {
      target: { value: '該当患者' },
    });

    expect(within(screen.getByRole('table')).getByText('該当患者')).toBeTruthy();
    expect(screen.getByTestId('data-table-pagination-summary').textContent).toContain('全1件中');
    expect(screen.getByTestId('data-table-pagination-summary').textContent).toContain('1〜1件');
  });
});
