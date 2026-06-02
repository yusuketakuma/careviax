'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, CalendarRange } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useOrgId } from '@/lib/hooks/use-org-id';
import {
  getImportFeedback,
  resolveImportOutcome,
  type ImportApiResponse,
} from './staff-bulk-actions.shared';

type PharmacistOption = {
  id: string;
  name: string;
  site_name: string | null;
};

const CSV_TEMPLATE = `name,name_kana,email,phone,role,site_name,certification_type,certification_number,issued_date,expiry_date,tenure_years,weekly_work_hours
山田 太郎,ヤマダ タロウ,yamada@example.com,090-1111-2222,pharmacist,本店,かかりつけ薬剤師研修認定,R-001,2025-04-01,2027-03-31,5,32`;

function parseCsv(text: string) {
  const rows: string[][] = [];
  let current = '';
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      currentRow.push(current);
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      currentRow.push(current);
      if (currentRow.some((cell) => cell.trim().length > 0)) {
        rows.push(currentRow.map((cell) => cell.trim()));
      }
      current = '';
      currentRow = [];
      continue;
    }

    current += char;
  }

  currentRow.push(current);
  if (currentRow.some((cell) => cell.trim().length > 0)) {
    rows.push(currentRow.map((cell) => cell.trim()));
  }

  return rows;
}

function csvToRows(csvText: string) {
  const parsed = parseCsv(csvText);
  if (parsed.length < 2) {
    throw new Error('ヘッダーと1行以上のデータが必要です');
  }

  const [header, ...body] = parsed;
  const expected = [
    'name',
    'name_kana',
    'email',
    'phone',
    'role',
    'site_name',
    'certification_type',
    'certification_number',
    'issued_date',
    'expiry_date',
    'tenure_years',
    'weekly_work_hours',
  ];

  if (header.join(',') !== expected.join(',')) {
    throw new Error(`CSV ヘッダーが不正です: ${expected.join(',')}`);
  }

  return body.map((row) => ({
    name: row[0] ?? '',
    name_kana: row[1] ?? '',
    email: row[2] ?? '',
    phone: row[3] || null,
    role: row[4] ?? '',
    site_name: row[5] || null,
    certification_type: row[6] || null,
    certification_number: row[7] || null,
    issued_date: row[8] || null,
    expiry_date: row[9] || null,
    tenure_years: row[10] || null,
    weekly_work_hours: row[11] || null,
  }));
}

export function StaffBulkActions() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [csvText, setCsvText] = useState(CSV_TEMPLATE);
  const [applyMonth, setApplyMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [applyUserId, setApplyUserId] = useState('all');
  const [lastImportResult, setLastImportResult] = useState<ImportApiResponse['data'] | null>(null);

  const pharmacistsQuery = useQuery({
    queryKey: ['staff-bulk-pharmacists', orgId],
    queryFn: async () => {
      const response = await fetch('/api/pharmacists', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('スタッフ一覧の取得に失敗しました');
      return response.json() as Promise<{ data: PharmacistOption[] }>;
    },
    enabled: !!orgId,
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const rows = csvToRows(csvText);
      const response = await fetch('/api/pharmacists/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({ rows }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? 'CSV取込に失敗しました');
      }
      return payload as ImportApiResponse;
    },
    onSuccess: async (payload) => {
      setLastImportResult(payload.data);
      const feedback = getImportFeedback(payload.data);
      if (feedback.tone === 'error') {
        toast.error(feedback.message);
      } else if (feedback.tone === 'warning') {
        toast.warning(feedback.message);
      } else {
        toast.success(feedback.message);
      }
      if (payload.data.created_count > 0) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['admin-users', orgId] }),
          queryClient.invalidateQueries({ queryKey: ['pharmacist-credentials', orgId] }),
        ]);
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'CSV取込に失敗しました');
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/pharmacist-shift-templates/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          month: applyMonth,
          user_id: applyUserId === 'all' ? undefined : applyUserId,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          (payload as { message?: string }).message ?? 'シフト一括反映に失敗しました',
        );
      }
      return payload as { data: { applied_count: number } };
    },
    onSuccess: async (payload) => {
      toast.success(`${payload.data.applied_count}件のシフトを反映しました`);
      await queryClient.invalidateQueries({ queryKey: ['pharmacist-shifts', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'シフト一括反映に失敗しました');
    },
  });

  async function handleFileChange(file: File | null) {
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
  }

  const pharmacists = pharmacistsQuery.data?.data ?? [];
  const importOutcome = lastImportResult ? resolveImportOutcome(lastImportResult) : null;
  const importStatusLabel =
    importOutcome === 'failed'
      ? '取込失敗'
      : importOutcome === 'partial_failed'
        ? '一部失敗'
        : '取込完了';
  const importResultClass =
    importOutcome === 'failed'
      ? 'border-destructive/40 bg-destructive/5'
      : importOutcome === 'partial_failed'
        ? 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/20 dark:text-amber-100'
        : 'border-border bg-card';

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileUp className="size-4" aria-hidden="true" />
            CSV 一括インポート
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="staff-csv-file">CSV ファイル</Label>
            <Input
              id="staff-csv-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void handleFileChange(event.target.files?.[0] ?? null)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="staff-csv-text">CSV 内容</Label>
            <Textarea
              id="staff-csv-text"
              value={csvText}
              onChange={(event) => setCsvText(event.target.value)}
              className="min-h-[260px] font-mono text-xs"
            />
          </div>
          <div className="text-xs text-muted-foreground">
            ヘッダー:{' '}
            <code>
              name,name_kana,email,phone,role,site_name,certification_type,certification_number,issued_date,expiry_date,tenure_years,weekly_work_hours
            </code>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => importMutation.mutate()} disabled={importMutation.isPending}>
              {importMutation.isPending ? '取込中...' : '取込を実行'}
            </Button>
          </div>
          {lastImportResult ? (
            <div className={`space-y-2 rounded-lg border p-3 text-sm ${importResultClass}`}>
              <div className="flex flex-wrap items-center gap-3">
                <Badge
                  variant={importOutcome === 'failed' ? 'destructive' : 'outline'}
                  className={
                    importOutcome === 'partial_failed'
                      ? 'border-amber-500 text-amber-700 dark:text-amber-200'
                      : ''
                  }
                >
                  {importStatusLabel}
                </Badge>
                <span>作成 {lastImportResult.created_count}件</span>
                <span>失敗 {lastImportResult.failed_count}件</span>
              </div>
              <div className="max-h-48 space-y-1 overflow-y-auto text-xs">
                {lastImportResult.results.map((result) => (
                  <div
                    key={`${result.row_number ?? result.email}-${result.email}-${result.status}`}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded border bg-background/70 px-2 py-1"
                  >
                    <span className="min-w-8 text-muted-foreground">
                      {result.row_number ? `${result.row_number}行目` : '行未設定'}
                    </span>
                    <Badge variant={result.status === 'failed' ? 'destructive' : 'outline'}>
                      {result.status === 'failed' ? '失敗' : '作成'}
                    </Badge>
                    <span className="font-medium">{result.name}</span>
                    <span className="ml-2 text-muted-foreground">{result.email}</span>
                    <span className="ml-2">{result.message}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarRange className="size-4" aria-hidden="true" />
            一括シフト反映
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bulk-shift-month">対象月</Label>
            <Input
              id="bulk-shift-month"
              type="month"
              value={applyMonth}
              onChange={(event) => setApplyMonth(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bulk-shift-user">反映対象</Label>
            <Select value={applyUserId} onValueChange={(value) => value && setApplyUserId(value)}>
              <SelectTrigger id="bulk-shift-user">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全担当者</SelectItem>
                {pharmacists.map((pharmacist) => (
                  <SelectItem key={pharmacist.id} value={pharmacist.id}>
                    {pharmacist.name}
                    {pharmacist.site_name ? ` / ${pharmacist.site_name}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
            既存の定型シフトをまとめて対象月へ反映します。全担当者を選ぶと月次テンプレートを一括適用します。
          </div>
          <div className="flex justify-end">
            <Button onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending}>
              {applyMutation.isPending ? '反映中...' : '定型シフトを反映'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
