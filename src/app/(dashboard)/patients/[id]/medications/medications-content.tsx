'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Plus, QrCode } from 'lucide-react';
import Link from 'next/link';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useOrgId } from '@/lib/hooks/use-org-id';

type MedicationProfile = {
  id: string;
  patient_id: string;
  drug_name: string;
  dose: string | null;
  frequency: string | null;
  start_date: string | null;
  end_date: string | null;
  prescriber: string | null;
  is_current: boolean;
  source: string | null;
  created_at: string;
};

const sourceLabel: Record<string, string> = {
  qr_scan: 'QRスキャン',
  manual: '手動入力',
  prescription: '処方箋',
};

const columns: ColumnDef<MedicationProfile>[] = [
  {
    accessorKey: 'drug_name',
    header: '薬剤名',
    cell: ({ row }) => (
      <span className="font-medium">{row.original.drug_name}</span>
    ),
  },
  {
    accessorKey: 'dose',
    header: '用量',
    cell: ({ row }) => (
      <span className="text-sm">{row.original.dose ?? '—'}</span>
    ),
  },
  {
    accessorKey: 'frequency',
    header: '用法',
    cell: ({ row }) => (
      <span className="text-sm">{row.original.frequency ?? '—'}</span>
    ),
  },
  {
    accessorKey: 'start_date',
    header: '開始日',
    cell: ({ row }) =>
      row.original.start_date ? (
        <span className="text-sm">
          {format(parseISO(row.original.start_date), 'yyyy/MM/dd', { locale: ja })}
        </span>
      ) : (
        <span className="text-sm text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: 'is_current',
    header: '状態',
    cell: ({ row }) => (
      <Badge variant={row.original.is_current ? 'default' : 'secondary'}>
        {row.original.is_current ? '服薬中' : '終了'}
      </Badge>
    ),
  },
  {
    accessorKey: 'source',
    header: '登録方法',
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.source ? (sourceLabel[row.original.source] ?? row.original.source) : '—'}
      </span>
    ),
  },
];

type AddMedicationFormData = {
  drug_name: string;
  dose: string;
  frequency: string;
  prescriber: string;
};

function AddMedicationDialog({
  patientId,
  onClose,
}: {
  patientId: string;
  onClose: () => void;
}) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AddMedicationFormData>({
    drug_name: '',
    dose: '',
    frequency: '',
    prescriber: '',
  });

  const mutation = useMutation({
    mutationFn: async (data: AddMedicationFormData) => {
      const res = await fetch('/api/medication-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          patient_id: patientId,
          drug_name: data.drug_name,
          dose: data.dose || undefined,
          frequency: data.frequency || undefined,
          prescriber: data.prescriber || undefined,
          source: 'manual',
        }),
      });
      if (!res.ok) throw new Error('登録に失敗しました');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['medication-profiles', patientId] });
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.drug_name) return;
    mutation.mutate(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold">薬剤追加</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="drug_name">薬剤名 *</Label>
            <Input
              id="drug_name"
              value={form.drug_name}
              onChange={(e) => setForm((f) => ({ ...f, drug_name: e.target.value }))}
              placeholder="例: アムロジピン錠5mg"
              required
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="dose">用量</Label>
            <Input
              id="dose"
              value={form.dose}
              onChange={(e) => setForm((f) => ({ ...f, dose: e.target.value }))}
              placeholder="例: 1錠"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="frequency">用法</Label>
            <Input
              id="frequency"
              value={form.frequency}
              onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))}
              placeholder="例: 1日1回朝食後"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="prescriber">処方医</Label>
            <Input
              id="prescriber"
              value={form.prescriber}
              onChange={(e) => setForm((f) => ({ ...f, prescriber: e.target.value }))}
              placeholder="例: 田中医師"
              className="mt-1"
            />
          </div>
          {mutation.isError && (
            <p className="text-sm text-destructive">{String(mutation.error)}</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center rounded-md px-4 text-sm font-medium hover:bg-muted"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {mutation.isPending ? '登録中...' : '登録'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function MedicationsContent({ patientId }: { patientId: string }) {
  const orgId = useOrgId();
  const [showAddDialog, setShowAddDialog] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['medication-profiles', patientId],
    queryFn: async () => {
      const res = await fetch(
        `/api/medication-profiles?patient_id=${patientId}&is_current=true`,
        { headers: { 'x-org-id': orgId } }
      );
      if (!res.ok) throw new Error('取得に失敗しました');
      return res.json() as Promise<{ data: MedicationProfile[] }>;
    },
    enabled: !!orgId,
  });

  const profiles = data?.data ?? [];

  return (
    <div className="space-y-6">
      {/* 服薬中薬剤 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">服薬中薬剤</h2>
          <div className="flex items-center gap-2">
            <Link
              href="/qr-scan"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted"
            >
              <QrCode className="size-4" aria-hidden="true" />
              QRスキャン
            </Link>
            <button
              onClick={() => setShowAddDialog(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="size-4" aria-hidden="true" />
              薬剤追加
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">読み込み中...</div>
        ) : profiles.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-12 text-center">
            <p className="text-sm text-muted-foreground">服薬中の薬剤がありません</p>
            <p className="mt-1 text-xs text-muted-foreground">
              「薬剤追加」またはQRスキャンで登録してください
            </p>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={profiles}
            caption="服薬中薬剤一覧"
          />
        )}
      </section>

      {showAddDialog && (
        <AddMedicationDialog
          patientId={patientId}
          onClose={() => setShowAddDialog(false)}
        />
      )}
    </div>
  );
}
