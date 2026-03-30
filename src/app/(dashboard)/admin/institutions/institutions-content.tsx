'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { useOrgId } from '@/lib/hooks/use-org-id';

type Institution = {
  id: string;
  name: string;
  institution_code: string | null;
  address: string | null;
  phone: string | null;
  fax: string | null;
  notes: string | null;
  prescription_count: number;
  last_prescribed_at: string | null;
};

type FormState = {
  name: string;
  institution_code: string;
  address: string;
  phone: string;
  fax: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  name: '',
  institution_code: '',
  address: '',
  phone: '',
  fax: '',
  notes: '',
};

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('ja-JP');
}

export function InstitutionsContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const { data, isLoading } = useQuery({
    queryKey: ['prescriber-institutions', orgId, query],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      const response = await fetch(`/api/prescriber-institutions?${params.toString()}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('医療機関マスターの取得に失敗しました');
      return response.json() as Promise<{ data: Institution[] }>;
    },
    enabled: !!orgId,
  });

  const institutions = data?.data ?? [];

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  function openCreate() {
    resetForm();
    setSheetOpen(true);
  }

  function openEdit(item: Institution) {
    setEditingId(item.id);
    setForm({
      name: item.name,
      institution_code: item.institution_code ?? '',
      address: item.address ?? '',
      phone: item.phone ?? '',
      fax: item.fax ?? '',
      notes: item.notes ?? '',
    });
    setSheetOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const endpoint = editingId
        ? `/api/prescriber-institutions/${editingId}`
        : '/api/prescriber-institutions';
      const method = editingId ? 'PATCH' : 'POST';
      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify(form),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? '保存に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success(editingId ? '医療機関マスターを更新しました' : '医療機関を登録しました');
      setSheetOpen(false);
      resetForm();
      await queryClient.invalidateQueries({ queryKey: ['prescriber-institutions', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '保存に失敗しました');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/prescriber-institutions/${id}`, {
        method: 'DELETE',
        headers: { 'x-org-id': orgId },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? '削除に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success('医療機関マスターを削除しました');
      await queryClient.invalidateQueries({ queryKey: ['prescriber-institutions', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '削除に失敗しました');
    },
  });

  const columns: ColumnDef<Institution>[] = [
    {
      accessorKey: 'name',
      header: '医療機関名',
      cell: ({ row }) => (
        <div>
          <p className="font-medium text-foreground">{row.original.name}</p>
          <p className="text-xs text-muted-foreground">
            {row.original.institution_code || 'コード未設定'}
          </p>
        </div>
      ),
    },
    {
      accessorKey: 'phone',
      header: '連絡先',
      cell: ({ row }) => (
        <div className="text-sm">
          <p>{row.original.phone || 'TEL未設定'}</p>
          <p className="text-xs text-muted-foreground">{row.original.fax || 'FAX未設定'}</p>
        </div>
      ),
    },
    {
      accessorKey: 'prescription_count',
      header: '処方実績',
    },
    {
      accessorKey: 'last_prescribed_at',
      header: '最終処方日',
      cell: ({ row }) => formatDate(row.original.last_prescribed_at),
    },
    {
      id: 'actions',
      header: '操作',
      cell: ({ row }) => (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => openEdit(row.original)}>
            編集
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (!window.confirm(`${row.original.name} を削除しますか？`)) return;
              deleteMutation.mutate(row.original.id);
            }}
            disabled={deleteMutation.isPending}
          >
            削除
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>医療機関一覧</CardTitle>
          <Button onClick={openCreate}>新規登録</Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-sm">
            <Label htmlFor="institution-search">検索</Label>
            <Input
              id="institution-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="医療機関名 / コード / 住所"
            />
          </div>

          <DataTable columns={columns} data={institutions} isLoading={isLoading} />
        </CardContent>
      </Card>

      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) resetForm();
        }}
      >
        <SheetContent className="sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{editingId ? '医療機関を編集' : '医療機関を登録'}</SheetTitle>
            <SheetDescription>
              処方受付・疑義照会・報告書送付に使う医療機関情報を管理します。
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="institution-name">医療機関名</Label>
              <Input
                id="institution-name"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="institution-code">医療機関コード</Label>
              <Input
                id="institution-code"
                value={form.institution_code}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    institution_code: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="institution-address">住所</Label>
              <Input
                id="institution-address"
                value={form.address}
                onChange={(event) =>
                  setForm((current) => ({ ...current, address: event.target.value }))
                }
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="institution-phone">電話番号</Label>
                <Input
                  id="institution-phone"
                  value={form.phone}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, phone: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="institution-fax">FAX</Label>
                <Input
                  id="institution-fax"
                  value={form.fax}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, fax: event.target.value }))
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="institution-notes">備考</Label>
              <Textarea
                id="institution-notes"
                rows={4}
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, notes: event.target.value }))
                }
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSheetOpen(false)}>
                キャンセル
              </Button>
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? '保存中...' : '保存'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
