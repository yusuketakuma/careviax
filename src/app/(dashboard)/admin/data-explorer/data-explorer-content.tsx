'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCcw, Save, Search } from 'lucide-react';
import { toast } from 'sonner';
import { AdminPageHeader } from '@/components/features/admin/admin-page-header';
import { getAdminDataExplorerShortcutLinks } from '@/components/features/admin/admin-page-shortcut-presets';
import { COVERAGE_CATEGORY_LABELS, type CoverageCategory } from '@/lib/admin/data-explorer-catalog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { parseJsonObjectText } from '@/lib/admin/json-editor';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { PageScaffold } from '@/components/layout/page-scaffold';

type ExplorerField = {
  name: string;
  type: string;
  kind: string;
  isList: boolean;
  isRequired: boolean;
  isEditable: boolean;
};

type ExplorerModel = {
  modelName: string;
  tableName: string;
  coverageCategory: CoverageCategory;
  coverageLabel: string;
  rowCount: number;
  scalarFieldCount: number;
  editableFieldCount: number;
  searchableField: string | null;
};

type ExplorerRowsPayload = {
  modelName: string;
  tableName: string;
  coverageCategory: CoverageCategory;
  coverageLabel: string;
  columns: ExplorerField[];
  totalCount: number;
  limit: number;
  offset: number;
  rows: Array<Record<string, unknown>>;
};

const SUMMARY_KEYS = [
  'name',
  'title',
  'subject',
  'drug_name',
  'key',
  'code',
  'email',
  'recipient_name',
  'template_key',
  'certification_number',
  'yj_code',
] as const;

function summarizeRow(row: Record<string, unknown>) {
  for (const key of SUMMARY_KEYS) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return typeof row.id === 'string' ? row.id : 'レコード';
}

function extractEditablePatch(row: Record<string, unknown> | null, columns: ExplorerField[]) {
  if (!row) return {};
  return Object.fromEntries(
    columns
      .filter((column) => column.isEditable)
      .map((column) => [column.name, row[column.name] ?? null]),
  );
}

export function DataExplorerContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [selectedTable, setSelectedTable] = useState('');
  const [selectedRowId, setSelectedRowId] = useState('');
  const [modelFilter, setModelFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | CoverageCategory>('all');
  const [rowSearch, setRowSearch] = useState('');
  const [editorDrafts, setEditorDrafts] = useState<Record<string, string>>({});

  const deferredModelFilter = useDeferredValue(modelFilter.trim().toLowerCase());
  const deferredRowSearch = useDeferredValue(rowSearch.trim());

  const modelsQuery = useQuery({
    queryKey: ['admin-data-explorer-models', orgId],
    queryFn: async () => {
      const response = await fetch('/api/admin/data-explorer/models', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('モデル一覧の取得に失敗しました');
      return response.json() as Promise<{ data: ExplorerModel[] }>;
    },
    enabled: !!orgId,
  });

  const filteredModels = useMemo(
    () =>
      (modelsQuery.data?.data ?? []).filter((model) => {
        if (categoryFilter !== 'all' && model.coverageCategory !== categoryFilter) return false;
        if (!deferredModelFilter) return true;
        const haystack =
          `${model.tableName} ${model.modelName} ${model.coverageLabel}`.toLowerCase();
        return haystack.includes(deferredModelFilter);
      }),
    [categoryFilter, deferredModelFilter, modelsQuery.data?.data],
  );

  const selectedTableStillVisible = filteredModels.some(
    (model) => model.tableName === selectedTable,
  );
  const effectiveSelectedTable = selectedTableStillVisible
    ? selectedTable
    : (filteredModels[0]?.tableName ?? '');

  const rowsQuery = useQuery({
    queryKey: ['admin-data-explorer-rows', orgId, effectiveSelectedTable, deferredRowSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '25' });
      if (deferredRowSearch) params.set('search', deferredRowSearch);

      const response = await fetch(
        `/api/admin/data-explorer/${effectiveSelectedTable}?${params.toString()}`,
        {
          headers: { 'x-org-id': orgId },
        },
      );
      if (!response.ok) throw new Error('テーブルデータの取得に失敗しました');
      return response.json() as Promise<{ data: ExplorerRowsPayload }>;
    },
    enabled: !!orgId && !!effectiveSelectedTable,
  });

  const tableData = rowsQuery.data?.data ?? null;
  const selectedRowIdStillVisible = tableData?.rows.some((row) => String(row.id) === selectedRowId);
  const effectiveSelectedRowId = selectedRowIdStillVisible
    ? selectedRowId
    : tableData?.rows[0]?.id
      ? String(tableData.rows[0].id)
      : '';
  const selectedRow =
    tableData?.rows.find((row) => String(row.id) === effectiveSelectedRowId) ?? null;
  const editorKey =
    effectiveSelectedTable && effectiveSelectedRowId
      ? `${effectiveSelectedTable}:${effectiveSelectedRowId}`
      : '';
  const selectedRowPatchText = useMemo(
    () =>
      tableData && selectedRow
        ? JSON.stringify(extractEditablePatch(selectedRow, tableData.columns), null, 2)
        : '{}',
    [selectedRow, tableData],
  );
  const editorValue = editorKey ? (editorDrafts[editorKey] ?? selectedRowPatchText) : '{}';

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!effectiveSelectedTable || !effectiveSelectedRowId) {
        throw new Error('更新対象の行を選択してください');
      }

      const patch = parseJsonObjectText(editorValue, 'JSON object が必要です');

      const response = await fetch(
        `/api/admin/data-explorer/${effectiveSelectedTable}/${effectiveSelectedRowId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-org-id': orgId,
          },
          body: JSON.stringify({ patch }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? '更新に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success('レコードを更新しました');
      if (editorKey) {
        setEditorDrafts((current) => {
          const next = { ...current };
          delete next[editorKey];
          return next;
        });
      }
      await queryClient.invalidateQueries({
        queryKey: ['admin-data-explorer-rows', orgId, effectiveSelectedTable],
        exact: false,
      });
      await queryClient.invalidateQueries({
        queryKey: ['admin-data-explorer-models', orgId],
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '更新に失敗しました');
    },
  });

  const editableFields =
    tableData?.columns.filter((column) => column.isEditable).map((column) => column.name) ?? [];

  return (
    <PageScaffold>
      <AdminPageHeader
        title="データ探索"
        description="監査ドキュメントで未露出だった backend graph を含め、全テーブルを一覧・閲覧・更新します。seed で投入した代表データを画面から直接検証・補正できます。"
        shortcuts={getAdminDataExplorerShortcutLinks()}
      />

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)_minmax(0,1.1fr)]">
        <Card className="xl:h-[calc(100vh-13rem)] xl:overflow-hidden">
          <CardHeader>
            <CardTitle>モデル一覧</CardTitle>
            <CardDescription>監査カテゴリごとにフィルタできます。</CardDescription>
          </CardHeader>
          <CardContent className="flex h-full min-h-0 flex-col gap-3">
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3">
              <Search className="size-4 text-muted-foreground" aria-hidden="true" />
              <Input
                value={modelFilter}
                onChange={(event) => setModelFilter(event.target.value)}
                placeholder="モデル名で検索"
                className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
              />
            </div>

            <Select
              value={categoryFilter}
              onValueChange={(value) => setCategoryFilter(value as 'all' | CoverageCategory)}
            >
              <SelectTrigger>
                <SelectValue placeholder="カテゴリ" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">すべて</SelectItem>
                {Object.entries(COVERAGE_CATEGORY_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {filteredModels.map((model) => (
                <button
                  key={model.tableName}
                  type="button"
                  onClick={() => {
                    setSelectedTable(model.tableName);
                    setSelectedRowId('');
                    setRowSearch('');
                  }}
                  className={`w-full rounded-xl border p-3 text-left transition ${
                    effectiveSelectedTable === model.tableName
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-card hover:bg-muted/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-foreground">{model.tableName}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{model.modelName}</div>
                    </div>
                    <Badge variant="outline">{model.rowCount} rows</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <Badge variant="secondary">{model.coverageLabel}</Badge>
                    <Badge variant="outline">{model.editableFieldCount} editable</Badge>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="xl:h-[calc(100vh-13rem)] xl:overflow-hidden">
          <CardHeader>
            <CardTitle>{effectiveSelectedTable || 'テーブル選択待ち'}</CardTitle>
            <CardDescription>
              {tableData
                ? `${tableData.coverageLabel} / ${tableData.totalCount} 件`
                : '左の一覧からテーブルを選択してください。'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex h-full min-h-0 flex-col gap-3">
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3">
              <Search className="size-4 text-muted-foreground" aria-hidden="true" />
              <Input
                value={rowSearch}
                onChange={(event) => setRowSearch(event.target.value)}
                placeholder="行内容を全文検索"
                className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                disabled={!effectiveSelectedTable}
              />
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {rowsQuery.isLoading ? (
                <div className="text-sm text-muted-foreground">読み込み中...</div>
              ) : tableData?.rows.length ? (
                tableData.rows.map((row) => {
                  const rowId = String(row.id);
                  return (
                    <button
                      key={rowId}
                      type="button"
                      onClick={() => setSelectedRowId(rowId)}
                      className={`w-full rounded-xl border p-3 text-left transition ${
                        rowId === effectiveSelectedRowId
                          ? 'border-primary bg-primary/5'
                          : 'border-border bg-card hover:bg-muted/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground">
                            {summarizeRow(row)}
                          </div>
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">
                            {rowId}
                          </div>
                        </div>
                        <Badge variant="outline">#{rowId.slice(0, 6)}</Badge>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                  一致するレコードがありません。
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="xl:h-[calc(100vh-13rem)] xl:overflow-hidden">
          <CardHeader>
            <CardTitle>詳細 / 更新</CardTitle>
            <CardDescription>
              編集可能フィールドのみ JSON で保存します。型は DB 側で検証されます。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex h-full min-h-0 flex-col gap-4">
            <Tabs defaultValue="editor" className="min-h-0 flex-1">
              <TabsList>
                <TabsTrigger value="editor">編集</TabsTrigger>
                <TabsTrigger value="raw">生データ</TabsTrigger>
                <TabsTrigger value="columns">列情報</TabsTrigger>
              </TabsList>

              <TabsContent value="editor" className="min-h-0 flex-1">
                <div className="flex h-full min-h-0 flex-col gap-3">
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge variant="secondary">{effectiveSelectedTable || '未選択'}</Badge>
                    <Badge variant="outline">{editableFields.length} editable fields</Badge>
                  </div>
                  <Textarea
                    value={editorValue}
                    onChange={(event) => {
                      if (!editorKey) return;
                      setEditorDrafts((current) => ({
                        ...current,
                        [editorKey]: event.target.value,
                      }));
                    }}
                    className="min-h-[20rem] flex-1 font-mono text-xs"
                    disabled={!selectedRow}
                  />
                  <div className="flex items-center gap-2">
                    <LoadingButton
                      loading={saveMutation.isPending}
                      onClick={() => saveMutation.mutate()}
                      disabled={!selectedRow}
                    >
                      <Save className="mr-2 size-4" aria-hidden="true" />
                      保存
                    </LoadingButton>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        if (!editorKey) return;
                        setEditorDrafts((current) => {
                          const next = { ...current };
                          delete next[editorKey];
                          return next;
                        });
                      }}
                      disabled={!selectedRow}
                    >
                      <RefreshCcw className="mr-2 size-4" aria-hidden="true" />
                      リセット
                    </Button>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="raw" className="min-h-0 flex-1">
                <pre className="h-full min-h-[24rem] overflow-auto rounded-xl border bg-muted/30 p-4 font-mono text-xs leading-6 text-foreground">
                  {selectedRow
                    ? JSON.stringify(selectedRow, null, 2)
                    : 'レコードを選択してください'}
                </pre>
              </TabsContent>

              <TabsContent value="columns" className="min-h-0 flex-1">
                <div className="max-h-[28rem] space-y-2 overflow-auto pr-1">
                  {(tableData?.columns ?? []).map((column) => (
                    <div
                      key={column.name}
                      className="rounded-xl border border-border bg-card p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">{column.name}</span>
                        <Badge variant="outline">{column.type}</Badge>
                        {column.isEditable ? (
                          <Badge variant="secondary">editable</Badge>
                        ) : (
                          <Badge variant="outline">readonly</Badge>
                        )}
                        {column.isList ? <Badge variant="outline">list</Badge> : null}
                        {!column.isRequired ? <Badge variant="outline">nullable</Badge> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </PageScaffold>
  );
}
