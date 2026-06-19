'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { differenceInDays, format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { AlertTriangle, Bell, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useOrgId } from '@/lib/hooks/use-org-id';

type PharmacistCredential = {
  id: string;
  user_id: string;
  user_name: string;
  certification_type: string;
  certification_number: string | null;
  issued_date: string | null;
  expiry_date: string | null;
  tenure_years: number | null;
  weekly_work_hours: number | null;
  consented_patients: Array<{
    id: string;
    name: string;
  }>;
};

type PharmacistOption = {
  id: string;
  name: string;
  site_name: string | null;
  role: string;
};

type CredentialForm = {
  user_id: string;
  certification_type: string;
  certification_number: string;
  issued_date: string;
  expiry_date: string;
  tenure_years: string;
  weekly_work_hours: string;
};

const EMPTY_FORM: CredentialForm = {
  user_id: '',
  certification_type: '',
  certification_number: '',
  issued_date: '',
  expiry_date: '',
  tenure_years: '',
  weekly_work_hours: '',
};

function ExpiryBadge({ expiryDate }: { expiryDate: string | null }) {
  if (!expiryDate) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const days = differenceInDays(parseISO(expiryDate), new Date());
  const formatted = format(parseISO(expiryDate), 'yyyy/MM/dd', { locale: ja });

  if (days < 0) {
    return (
      <Badge
        variant="outline"
        className="flex w-fit items-center gap-1 border-red-300 bg-red-50 text-xs text-red-700"
      >
        <XCircle className="size-3" aria-hidden="true" />
        {formatted}（期限切れ）
      </Badge>
    );
  }
  if (days <= 30) {
    return (
      <Badge
        variant="outline"
        className="flex w-fit items-center gap-1 border-red-300 bg-red-50 text-xs text-red-700"
      >
        <Bell className="size-3" aria-hidden="true" />
        {formatted}（残{days}日）
      </Badge>
    );
  }
  if (days <= 90) {
    return (
      <Badge
        variant="outline"
        className="flex w-fit items-center gap-1 border-orange-300 bg-orange-50 text-xs text-orange-700"
      >
        <Bell className="size-3" aria-hidden="true" />
        {formatted}（残{days}日）
      </Badge>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-green-700">
      <CheckCircle2 className="size-3.5" aria-hidden="true" />
      {formatted}
    </span>
  );
}

function toNullableNumberText(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildForm(credential: PharmacistCredential): CredentialForm {
  return {
    user_id: credential.user_id,
    certification_type: credential.certification_type,
    certification_number: credential.certification_number ?? '',
    issued_date: credential.issued_date?.slice(0, 10) ?? '',
    expiry_date: credential.expiry_date?.slice(0, 10) ?? '',
    tenure_years: credential.tenure_years?.toString() ?? '',
    weekly_work_hours: credential.weekly_work_hours?.toString() ?? '',
  };
}

export function PharmacistCredentialsContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editingCredential, setEditingCredential] = useState<PharmacistCredential | null>(null);
  const [form, setForm] = useState<CredentialForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<PharmacistCredential | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['pharmacist-credentials', orgId],
    queryFn: async () => {
      const response = await fetch('/api/admin/pharmacist-credentials', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('薬剤師認定情報の取得に失敗しました');
      return response.json() as Promise<{ data: PharmacistCredential[] }>;
    },
    enabled: !!orgId,
  });

  const pharmacistsQuery = useQuery({
    queryKey: ['pharmacist-options', orgId],
    queryFn: async () => {
      const response = await fetch('/api/pharmacists', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('スタッフ一覧の取得に失敗しました');
      return response.json() as Promise<{ data: PharmacistOption[] }>;
    },
    enabled: !!orgId,
  });

  const credentials = data?.data ?? [];
  const pharmacistOptions = pharmacistsQuery.data?.data ?? [];

  const alertItems = credentials.filter((credential) => {
    if (!credential.expiry_date) return false;
    return differenceInDays(parseISO(credential.expiry_date), new Date()) <= 90;
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const url = editingCredential
        ? `/api/admin/pharmacist-credentials/${editingCredential.id}`
        : '/api/admin/pharmacist-credentials';
      const method = editingCredential ? 'PATCH' : 'POST';
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          user_id: form.user_id,
          certification_type: form.certification_type,
          certification_number: form.certification_number || null,
          issued_date: form.issued_date || null,
          expiry_date: form.expiry_date || null,
          tenure_years: toNullableNumberText(form.tenure_years),
          weekly_work_hours: toNullableNumberText(form.weekly_work_hours),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? '保存に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success(editingCredential ? '資格情報を更新しました' : '資格情報を登録しました');
      setFormOpen(false);
      setEditingCredential(null);
      setForm(EMPTY_FORM);
      await queryClient.invalidateQueries({ queryKey: ['pharmacist-credentials', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '保存に失敗しました');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!deleteTarget) throw new Error('削除対象がありません');
      const response = await fetch(`/api/admin/pharmacist-credentials/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { 'x-org-id': orgId },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? '削除に失敗しました');
      }
    },
    onSuccess: async () => {
      toast.success('資格情報を削除しました');
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['pharmacist-credentials', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '削除に失敗しました');
    },
  });

  const columns = useMemo<ColumnDef<PharmacistCredential>[]>(
    () => [
      {
        accessorKey: 'user_name',
        header: '薬剤師名',
        cell: ({ row }) => <span className="text-sm font-medium">{row.original.user_name}</span>,
      },
      {
        accessorKey: 'certification_type',
        header: '研修認定種別',
        cell: ({ row }) => <span className="text-sm">{row.original.certification_type}</span>,
      },
      {
        accessorKey: 'certification_number',
        header: '認定番号',
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.certification_number ?? '—'}
          </span>
        ),
      },
      {
        accessorKey: 'expiry_date',
        header: '有効期限',
        cell: ({ row }) => <ExpiryBadge expiryDate={row.original.expiry_date} />,
      },
      {
        accessorKey: 'tenure_years',
        header: '在籍年数',
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">
            {row.original.tenure_years != null ? `${row.original.tenure_years.toFixed(1)}年` : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'weekly_work_hours',
        header: '週勤務時間',
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">
            {row.original.weekly_work_hours != null ? `${row.original.weekly_work_hours}時間` : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'consented_patients',
        header: '同意患者',
        cell: ({ row }) => {
          const patients = row.original.consented_patients;
          if (patients.length === 0) {
            return <span className="text-xs text-muted-foreground">—</span>;
          }
          return (
            <div className="flex flex-wrap gap-1">
              <Badge variant="outline">{patients.length}名</Badge>
              {patients.slice(0, 2).map((patient) => (
                <Badge key={patient.id} variant="secondary" className="max-w-36 truncate">
                  {patient.name}
                </Badge>
              ))}
              {patients.length > 2 ? <Badge variant="outline">+{patients.length - 2}</Badge> : null}
            </div>
          );
        },
      },
      {
        id: 'actions',
        header: '操作',
        cell: ({ row }) => (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditingCredential(row.original);
                setForm(buildForm(row.original));
                setFormOpen(true);
              }}
            >
              編集
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(row.original)}>
              失効
            </Button>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      {alertItems.length > 0 ? (
        <div className="flex items-start gap-3 rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">認定期限が近い薬剤師がいます</p>
            <ul className="mt-1 list-inside list-disc text-orange-700">
              {alertItems.map((credential) => {
                const days = differenceInDays(parseISO(credential.expiry_date!), new Date());
                return (
                  <li key={credential.id}>
                    {credential.user_name} — {days < 0 ? '期限切れ' : `残${days}日`}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">薬剤師資格一覧</CardTitle>
          <Button
            onClick={() => {
              setEditingCredential(null);
              setForm(EMPTY_FORM);
              setFormOpen(true);
            }}
          >
            資格を登録
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={credentials}
            isLoading={isLoading}
            caption="薬剤師研修認定一覧"
          />
        </CardContent>
      </Card>

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) {
            setEditingCredential(null);
            setForm(EMPTY_FORM);
          }
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingCredential ? '資格情報を編集' : '資格情報を登録'}</DialogTitle>
            <DialogDescription>資格種別、番号、有効期限、在籍年数を管理します。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 md:grid-cols-2">
            <Field label="対象スタッフ" htmlFor="credential-user">
              <Select
                value={form.user_id || 'unselected'}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    user_id: value && value !== 'unselected' ? value : '',
                  }))
                }
              >
                <SelectTrigger id="credential-user">
                  <SelectValue placeholder="選択してください" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unselected">選択してください</SelectItem>
                  {pharmacistOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                      {option.site_name ? ` / ${option.site_name}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="認定種別" htmlFor="credential-certification-type">
              <Input
                id="credential-certification-type"
                value={form.certification_type}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    certification_type: event.target.value,
                  }))
                }
                placeholder="かかりつけ薬剤師研修認定"
              />
            </Field>
            <Field label="認定番号" htmlFor="credential-certification-number">
              <Input
                id="credential-certification-number"
                value={form.certification_number}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    certification_number: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="交付日" htmlFor="credential-issued-date">
              <Input
                id="credential-issued-date"
                type="date"
                value={form.issued_date}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    issued_date: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="有効期限" htmlFor="credential-expiry-date">
              <Input
                id="credential-expiry-date"
                type="date"
                value={form.expiry_date}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    expiry_date: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="在籍年数" htmlFor="credential-tenure-years">
              <Input
                id="credential-tenure-years"
                type="number"
                step="0.1"
                value={form.tenure_years}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    tenure_years: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="週勤務時間" htmlFor="credential-weekly-work-hours">
              <Input
                id="credential-weekly-work-hours"
                type="number"
                step="0.5"
                value={form.weekly_work_hours}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    weekly_work_hours: event.target.value,
                  }))
                }
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              キャンセル
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !form.user_id || !form.certification_type.trim()}
            >
              {saveMutation.isPending ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>資格情報を失効しますか</DialogTitle>
            <DialogDescription>
              {deleteTarget?.user_name} の {deleteTarget?.certification_type} を削除します。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              キャンセル
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? '削除中...' : '失効する'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
