'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { Search, Pill, AlertTriangle, Shield, Database } from 'lucide-react';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useOrgId } from '@/lib/hooks/use-org-id';

type DrugMasterRow = {
  id: string;
  yj_code: string;
  receipt_code: string | null;
  jan_code: string | null;
  drug_name: string;
  drug_name_kana: string | null;
  generic_name: string | null;
  drug_price: number | null;
  unit: string | null;
  dosage_form: string | null;
  therapeutic_category: string | null;
  manufacturer: string | null;
  is_generic: boolean;
  is_narcotic: boolean;
  is_psychotropic: boolean;
  max_administration_days: number | null;
};

const columns: ColumnDef<DrugMasterRow>[] = [
  {
    accessorKey: 'drug_name',
    header: '医薬品名',
    cell: ({ row }) => (
      <div className="min-w-[200px]">
        <div className="flex items-center gap-1.5">
          <Pill className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium text-foreground">{row.original.drug_name}</span>
        </div>
        {row.original.generic_name && (
          <div className="mt-0.5 text-xs text-muted-foreground">
            一般名: {row.original.generic_name}
          </div>
        )}
      </div>
    ),
  },
  {
    accessorKey: 'yj_code',
    header: 'YJコード',
    cell: ({ row }) => (
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {row.original.yj_code}
      </span>
    ),
  },
  {
    accessorKey: 'dosage_form',
    header: '剤形',
    cell: ({ row }) => (
      <span className="text-sm">{row.original.dosage_form ?? '—'}</span>
    ),
  },
  {
    id: 'flags',
    header: '区分',
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        {row.original.is_generic && (
          <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-300">後発</Badge>
        )}
        {row.original.is_narcotic && (
          <span className="inline-flex items-center gap-0.5 rounded bg-red-100 px-1 py-0.5 text-[10px] font-medium text-red-700">
            <AlertTriangle className="size-2.5" aria-hidden="true" />麻薬
          </span>
        )}
        {row.original.is_psychotropic && (
          <span className="inline-flex items-center gap-0.5 rounded bg-orange-100 px-1 py-0.5 text-[10px] font-medium text-orange-700">
            <Shield className="size-2.5" aria-hidden="true" />向精神
          </span>
        )}
      </div>
    ),
  },
  {
    accessorKey: 'drug_price',
    header: '薬価',
    cell: ({ row }) => (
      <span className="text-sm tabular-nums">
        {row.original.drug_price != null
          ? `¥${Number(row.original.drug_price).toFixed(1)}/${row.original.unit ?? ''}`
          : '—'}
      </span>
    ),
  },
  {
    accessorKey: 'manufacturer',
    header: '製造元',
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">{row.original.manufacturer ?? '—'}</span>
    ),
  },
  {
    accessorKey: 'max_administration_days',
    header: '最大日数',
    cell: ({ row }) => (
      <span className="text-sm tabular-nums">
        {row.original.max_administration_days ?? '—'}
      </span>
    ),
  },
];

const CATEGORY_OPTIONS = [
  { value: '', label: '全薬効分類' },
  { value: '1', label: '1: 神経系及び感覚器官用医薬品' },
  { value: '2', label: '2: 個々の器官系用医薬品' },
  { value: '3', label: '3: 代謝性医薬品' },
  { value: '4', label: '4: 組織細胞機能用医薬品' },
  { value: '5', label: '5: 生薬及び漢方処方に基づく医薬品' },
  { value: '6', label: '6: 病原生物に対する医薬品' },
  { value: '7', label: '7: 治療を主目的としない医薬品' },
] as const;

export function DrugMasterContent() {
  const orgId = useOrgId();
  const [searchQuery, setSearchQuery] = useState('');
  const [category, setCategory] = useState('');
  const [genericOnly, setGenericOnly] = useState(false);
  const [narcoticOnly, setNarcoticOnly] = useState(false);

  const params = useMemo(() => {
    const p = new URLSearchParams({ limit: '50' });
    if (searchQuery) p.set('q', searchQuery);
    if (category) p.set('category', category);
    if (genericOnly) p.set('generic', 'true');
    if (narcoticOnly) p.set('narcotic', 'true');
    return p.toString();
  }, [searchQuery, category, genericOnly, narcoticOnly]);

  const { data, isLoading } = useQuery({
    queryKey: ['drug-masters', orgId, params],
    queryFn: async () => {
      const res = await fetch(`/api/drug-masters?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('医薬品マスターの取得に失敗しました');
      return res.json() as Promise<{
        data: DrugMasterRow[];
        totalCount: number;
        hasMore: boolean;
      }>;
    },
    enabled: !!orgId,
  });

  const drugs = data?.data ?? [];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">医薬品マスター</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            SSK基本マスター・PMDA添付文書データベースの管理
          </p>
        </div>
        {data?.totalCount !== undefined && (
          <Badge variant="outline" className="gap-1">
            <Database className="size-3" aria-hidden="true" />
            {data.totalCount.toLocaleString()}件
          </Badge>
        )}
      </div>

      {/* Search & Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">検索・フィルタ</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2 size-4 text-muted-foreground" aria-hidden="true" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="医薬品名・カナ・YJコード・一般名で検索"
                className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm"
                aria-label="医薬品検索"
              />
            </div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              aria-label="薬効分類フィルタ"
            >
              {CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={genericOnly}
                onChange={(e) => setGenericOnly(e.target.checked)}
                className="size-4 rounded border-input"
              />
              後発品のみ
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={narcoticOnly}
                onChange={(e) => setNarcoticOnly(e.target.checked)}
                className="size-4 rounded border-input"
              />
              麻薬のみ
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <DataTable
        columns={columns}
        data={drugs}
        isLoading={isLoading}
        caption="医薬品マスター一覧"
      />
    </div>
  );
}
