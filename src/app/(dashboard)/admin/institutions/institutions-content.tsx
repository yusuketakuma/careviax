'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { differenceInDays } from 'date-fns';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StateBadge } from '@/components/ui/state-badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { hasPermission } from '@/lib/auth/permission-matrix';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { useOrgId } from '@/lib/hooks/use-org-id';
import {
  PRESCRIBER_INSTITUTIONS_API_PATH,
  buildPrescriberInstitutionApiPath,
  buildPrescriberInstitutionsApiPath,
} from '@/lib/prescriber-institutions/api-paths';
import { useAuthStore } from '@/lib/stores/auth-store';
import { formatDateLabel } from '@/lib/ui/date-format';

/** 最終処方日が「古い(要確認)」とみなす日数。これを超えると鮮度バッジを confirm 表示する。 */
const STALE_PRESCRIPTION_DAYS = 180;

/**
 * 医療機関の最終処方日が古い(要確認)かを判定する。null/不正日付は「古い」ではなく
 * 実績なし扱いにして偽の要対応シグナルを避ける。テスト安定のため now を注入可能にする。
 */
export function isInstitutionPrescriptionStale(
  lastPrescribedAt: string | null,
  now: Date = new Date(),
): boolean {
  if (!lastPrescribedAt) return false;
  const last = new Date(lastPrescribedAt);
  if (Number.isNaN(last.getTime())) return false;
  return differenceInDays(now, last) > STALE_PRESCRIPTION_DAYS;
}

/** 連絡先(電話/FAX)をクリップボードへコピーする。未対応/失敗時は無音にせず toast で知らせる。 */
async function copyContactValue(value: string, label: string) {
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error('clipboard unavailable');
    }
    await navigator.clipboard.writeText(value);
    toast.success(`${label}をコピーしました`);
  } catch {
    toast.error('コピーできませんでした');
  }
}

/** 連絡先一行。値があれば弱色テキスト + コピー操作、無ければ未設定の muted ラベルのみ。 */
function ContactLine({
  value,
  emptyLabel,
  copyLabel,
}: {
  value: string | null;
  emptyLabel: string;
  copyLabel: string;
}) {
  if (!value) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <div className="flex items-center gap-1">
      <span className="text-sm text-muted-foreground">{value}</span>
      <Button
        type="button"
        variant="ghost"
        className="!h-11 !min-h-[44px] !w-11 shrink-0 px-0"
        aria-label={`${copyLabel}をコピー`}
        onClick={() => void copyContactValue(value, copyLabel)}
      >
        <Copy aria-hidden className="h-4 w-4" />
      </Button>
    </div>
  );
}

export type Institution = {
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

export function InstitutionsContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const viewerRole = useAuthStore((s) => s.currentUser.role);
  // 新規登録/編集/削除は API 側で canAdmin 必須(常時 403 になるため非管理者には出さない)。
  const canManageInstitutions = viewerRole ? hasPermission(viewerRole, 'canAdmin') : false;
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 300);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<Institution | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['prescriber-institutions', orgId, debouncedQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim());
      const response = await fetch(buildPrescriberInstitutionsApiPath(params), {
        headers: buildOrgHeaders(orgId),
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
        ? buildPrescriberInstitutionApiPath(editingId)
        : PRESCRIBER_INSTITUTIONS_API_PATH;
      const method = editingId ? 'PATCH' : 'POST';
      const response = await fetch(endpoint, {
        method,
        headers: buildOrgJsonHeaders(orgId),
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
      const response = await fetch(buildPrescriberInstitutionApiPath(id), {
        method: 'DELETE',
        headers: buildOrgHeaders(orgId),
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

  const baseColumns: ColumnDef<Institution>[] = [
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
        <div className="space-y-1">
          <ContactLine value={row.original.phone} emptyLabel="TEL未設定" copyLabel="電話番号" />
          <ContactLine value={row.original.fax} emptyLabel="FAX未設定" copyLabel="FAX" />
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
      cell: ({ row }) => {
        const { last_prescribed_at, prescription_count } = row.original;
        // null または実績ゼロは「古い」ではなく実績なし。中立表示で偽の要対応シグナルを避ける。
        if (last_prescribed_at == null || prescription_count === 0) {
          return <span className="text-sm text-muted-foreground">処方なし</span>;
        }
        const stale = isInstitutionPrescriptionStale(last_prescribed_at);
        return (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm tabular-nums">
              {formatDateLabel(last_prescribed_at, { pattern: 'yyyy/M/d' })}
            </span>
            {stale ? <StateBadge role="confirm">6ヶ月以上前</StateBadge> : null}
          </div>
        );
      },
    },
  ];

  // 編集/削除は canAdmin 必須の API に紐づく。非管理者に常時 403 になる操作ボタンを
  // 見せない(disable+tooltipではなく列自体を出さない=hide)。
  const columns: ColumnDef<Institution>[] = canManageInstitutions
    ? [
        ...baseColumns,
        {
          id: 'actions',
          header: '操作',
          cell: ({ row }) => (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="!h-11 !min-h-[44px]"
                aria-label={`${row.original.name} を編集`}
                onClick={() => openEdit(row.original)}
              >
                編集
              </Button>
              <Button
                variant="outline"
                className="!h-11 !min-h-[44px]"
                aria-label={`${row.original.name} を削除`}
                onClick={() => setDeleteTarget(row.original)}
                disabled={deleteMutation.isPending}
              >
                削除
              </Button>
            </div>
          ),
        },
      ]
    : baseColumns;

  return (
    <>
      <ConfirmDialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="医療機関を削除しますか？"
        description={
          deleteTarget ? `${deleteTarget.name} を削除します。この操作は取り消せません。` : ''
        }
        variant="destructive"
        confirmLabel="削除する"
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteMutation.mutate(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>医療機関一覧</CardTitle>
          {canManageInstitutions ? (
            <Button className="!h-11 !min-h-[44px]" onClick={openCreate}>
              新規登録
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-sm">
            <Label htmlFor="institution-search">検索</Label>
            <Input
              id="institution-search"
              className="!h-11 !min-h-[44px]"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="医療機関名 / コード / 住所"
            />
          </div>

          <DataTable
            columns={columns}
            data={institutions}
            isLoading={isLoading}
            errorMessage={isError ? '医療機関一覧を取得できませんでした' : undefined}
            emptyMessage="医療機関はまだ登録されていません"
            onRetry={() => void refetch()}
          />
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
              <Button
                variant="outline"
                className="!h-11 !min-h-[44px]"
                onClick={() => setSheetOpen(false)}
              >
                キャンセル
              </Button>
              <Button
                className="!h-11 !min-h-[44px]"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? '保存中...' : '保存'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
