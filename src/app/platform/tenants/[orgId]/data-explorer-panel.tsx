'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Database, Info, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { platformFetchJson } from '../../platform-fetch';
import { findActiveSessionForOrg, useBreakGlassSessions } from '../../use-break-glass-sessions';

const PAGE_SIZE = 25;

type DataExplorerModel = {
  modelName: string;
  tableName: string;
  coverageLabel: string;
  rowCount: number;
};

type DataExplorerModelsResponse = { models: DataExplorerModel[] };

type DataExplorerColumn = { name: string; type: string; isRequired: boolean };

type DataExplorerRowsResponse = {
  modelName: string;
  tableName: string;
  columns: DataExplorerColumn[];
  totalCount: number;
  hasMore: boolean;
  limit: number;
  offset: number;
  rows: Array<Record<string, unknown>>;
};

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function ModelRows({ orgId, tableName }: { orgId: string; tableName: string }) {
  const [offset, setOffset] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);

  // "Adjust state during render" (not an effect) when the model or search
  // term changes, so the offset resets to page 1 without an extra
  // effect-driven render pass. See https://react.dev/learn/you-might-not-need-an-effect
  const resetKey = `${tableName}:${search}`;
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setOffset(0);
  }

  const params = new URLSearchParams({
    model: tableName,
    limit: String(PAGE_SIZE),
    offset: String(offset),
    ...(search ? { search } : {}),
  });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['platform-data-explorer-rows', orgId, tableName, offset, search],
    queryFn: () =>
      platformFetchJson<DataExplorerRowsResponse>(
        `/api/platform/tenants/${orgId}/data?${params.toString()}`,
      ),
  });

  const columns: ColumnDef<Record<string, unknown>>[] = (data?.columns ?? []).map((col) => ({
    id: col.name,
    header: col.name,
    accessorFn: (row) => row[col.name],
    cell: ({ getValue }) => (
      <span className="max-w-xs truncate font-mono text-xs" title={formatCellValue(getValue())}>
        {formatCellValue(getValue())}
      </span>
    ),
  }));

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="行を検索"
          className="min-h-[44px] pl-8 sm:h-9 sm:min-h-0"
          aria-label="データエクスプローラ行検索"
        />
      </div>

      {isError ? (
        <ErrorState
          variant="server"
          title="データを取得できませんでした"
          description="対象モデルの参照権限、またはブレークグラスセッションの有効期限を確認してください。"
          onRetry={() => refetch()}
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={data?.rows ?? []}
            isLoading={isLoading}
            caption={`${tableName} の行`}
            emptyMessage="該当する行がありません"
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {data
                ? `全${data.totalCount}件中 ${data.rows.length ? offset + 1 : 0}〜${offset + data.rows.length}件`
                : ''}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={offset === 0 || isLoading}
                onClick={() => setOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
              >
                前へ
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!data?.hasMore || isLoading}
                onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
              >
                次へ
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function DataExplorerPanel({ orgId }: { orgId: string }) {
  const sessionsQuery = useBreakGlassSessions();
  const activeSession = findActiveSessionForOrg(sessionsQuery.data?.sessions, orgId);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  // Reset the model selection if the tenant changes under the same mounted
  // instance ("adjust state during render", see ModelRows above).
  const [selectedModelOrgId, setSelectedModelOrgId] = useState(orgId);
  if (selectedModelOrgId !== orgId) {
    setSelectedModelOrgId(orgId);
    setSelectedModel(null);
  }

  const modelsQuery = useQuery({
    queryKey: ['platform-data-explorer-models', orgId],
    queryFn: () =>
      platformFetchJson<DataExplorerModelsResponse>(`/api/platform/tenants/${orgId}/data`),
    enabled: Boolean(activeSession),
  });

  // Default to the first model once the list loads, computed during render
  // rather than in an effect (avoids an extra effect-driven render pass).
  const firstModelName = modelsQuery.data?.models[0]?.tableName ?? null;
  if (!selectedModel && firstModelName) {
    setSelectedModel(firstModelName);
  }

  // アクティブなブレークグラスセッションが無ければ、データエクスプローラそのものを表示しない
  // (読み取りも監査対象の越権アクセスであり、セッション無しでは API 側も403で拒否する)。
  if (!activeSession) return null;

  const selectedModelSummary = modelsQuery.data?.models.find((m) => m.tableName === selectedModel);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="size-4" aria-hidden="true" />
          データエクスプローラ
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
        >
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <p>読み取り専用です。各アクセスはサーバー側で監査ログに記録されます。</p>
        </div>

        {modelsQuery.isError ? (
          <ErrorState
            variant="server"
            title="モデル一覧を取得できませんでした"
            onRetry={() => modelsQuery.refetch()}
          />
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="data-explorer-model">モデル</Label>
            <Select
              value={selectedModel ?? undefined}
              onValueChange={(value) => setSelectedModel(value ?? null)}
            >
              <SelectTrigger
                id="data-explorer-model"
                className="min-h-[44px] w-full max-w-sm sm:h-9 sm:min-h-0"
              >
                <SelectValue>
                  {selectedModelSummary
                    ? `${selectedModelSummary.tableName}（${selectedModelSummary.rowCount}件）`
                    : modelsQuery.isLoading
                      ? '読み込み中...'
                      : 'モデルを選択'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(modelsQuery.data?.models ?? []).map((model) => (
                  <SelectItem key={model.tableName} value={model.tableName}>
                    {model.tableName}（{model.coverageLabel}・{model.rowCount}件）
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {selectedModel ? <ModelRows orgId={orgId} tableName={selectedModel} /> : null}
      </CardContent>
    </Card>
  );
}
