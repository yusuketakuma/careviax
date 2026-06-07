'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { useOrgId } from '@/lib/hooks/use-org-id';

type PcaPumpStatus = 'available' | 'rented' | 'maintenance' | 'retired';
type PcaPumpRentalStatus = 'scheduled' | 'active' | 'overdue' | 'returned' | 'cancelled';

type Institution = {
  id: string;
  name: string;
  institution_code: string | null;
};

type PcaPump = {
  id: string;
  asset_code: string;
  serial_number: string | null;
  model_name: string;
  manufacturer: string | null;
  status: PcaPumpStatus;
  maintenance_due_at: string | null;
  notes: string | null;
  rentals: Array<{
    id: string;
    status: PcaPumpRentalStatus;
    due_at: string | null;
    institution: Institution;
  }>;
};

type PcaPumpRental = {
  id: string;
  status: PcaPumpRentalStatus;
  rented_at: string;
  due_at: string | null;
  returned_at: string | null;
  rental_fee_yen: number | null;
  contact_name: string | null;
  contact_phone: string | null;
  pump: {
    id: string;
    asset_code: string;
    serial_number: string | null;
    model_name: string;
    status: PcaPumpStatus;
  };
  institution: Institution & {
    phone: string | null;
    fax: string | null;
  };
};

type PumpFormState = {
  asset_code: string;
  serial_number: string;
  model_name: string;
  manufacturer: string;
  status: PcaPumpStatus;
  maintenance_due_at: string;
  notes: string;
};

type RentalFormState = {
  pump_id: string;
  institution_id: string;
  rented_at: string;
  due_at: string;
  contact_name: string;
  contact_phone: string;
  rental_fee_yen: string;
  notes: string;
};

const PUMP_STATUS_LABELS: Record<PcaPumpStatus, string> = {
  available: '利用可能',
  rented: '貸出中',
  maintenance: 'メンテ',
  retired: '退役',
};

const RENTAL_STATUS_LABELS: Record<PcaPumpRentalStatus, string> = {
  scheduled: '予定',
  active: '貸出中',
  overdue: '延滞',
  returned: '返却済',
  cancelled: '取消',
};

const EMPTY_PUMP_FORM: PumpFormState = {
  asset_code: '',
  serial_number: '',
  model_name: '',
  manufacturer: '',
  status: 'available',
  maintenance_due_at: '',
  notes: '',
};

function todayDateKey() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function emptyRentalForm(pumpId = ''): RentalFormState {
  return {
    pump_id: pumpId,
    institution_id: '',
    rented_at: todayDateKey(),
    due_at: '',
    contact_name: '',
    contact_phone: '',
    rental_fee_yen: '',
    notes: '',
  };
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(`${value}T00:00:00+09:00`).toLocaleDateString('ja-JP');
}

function statusBadgeClass(status: PcaPumpStatus | PcaPumpRentalStatus) {
  if (status === 'available' || status === 'returned') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (status === 'rented' || status === 'active' || status === 'scheduled') {
    return 'border-sky-200 bg-sky-50 text-sky-700';
  }
  if (status === 'overdue' || status === 'maintenance') {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  return 'border-slate-200 bg-slate-100 text-slate-700';
}

function toNullableString(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function yen(value: number | null) {
  return value == null ? '—' : `${value.toLocaleString('ja-JP')}円`;
}

export function PcaPumpsContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [pumpSheetOpen, setPumpSheetOpen] = useState(false);
  const [rentalSheetOpen, setRentalSheetOpen] = useState(false);
  const [pumpForm, setPumpForm] = useState<PumpFormState>(EMPTY_PUMP_FORM);
  const [rentalForm, setRentalForm] = useState<RentalFormState>(emptyRentalForm());

  const pumpsQuery = useQuery({
    queryKey: ['pca-pumps', orgId, query],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      const response = await fetch(`/api/pca-pumps?${params.toString()}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('PCAポンプ台帳の取得に失敗しました');
      return response.json() as Promise<{ data: PcaPump[] }>;
    },
    enabled: !!orgId,
  });

  const rentalsQuery = useQuery({
    queryKey: ['pca-pump-rentals', orgId],
    queryFn: async () => {
      const response = await fetch('/api/pca-pump-rentals?status=all', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('PCAポンプレンタル履歴の取得に失敗しました');
      return response.json() as Promise<{ data: PcaPumpRental[] }>;
    },
    enabled: !!orgId,
  });

  const institutionsQuery = useQuery({
    queryKey: ['prescriber-institutions', orgId, 'pca-pump-rental'],
    queryFn: async () => {
      const response = await fetch('/api/prescriber-institutions', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('医療機関マスターの取得に失敗しました');
      return response.json() as Promise<{ data: Institution[] }>;
    },
    enabled: !!orgId,
  });

  const pumps = useMemo(() => pumpsQuery.data?.data ?? [], [pumpsQuery.data?.data]);
  const rentals = useMemo(() => rentalsQuery.data?.data ?? [], [rentalsQuery.data?.data]);
  const institutions = useMemo(
    () => institutionsQuery.data?.data ?? [],
    [institutionsQuery.data?.data],
  );
  const openRentals = rentals.filter((rental) =>
    ['scheduled', 'active', 'overdue'].includes(rental.status),
  );

  const availablePumps = useMemo(
    () => pumps.filter((pump) => pump.status === 'available' || pump.id === rentalForm.pump_id),
    [pumps, rentalForm.pump_id],
  );

  async function invalidateAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['pca-pumps', orgId] }),
      queryClient.invalidateQueries({ queryKey: ['pca-pump-rentals', orgId] }),
    ]);
  }

  const createPumpMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/pca-pumps', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          asset_code: pumpForm.asset_code,
          serial_number: toNullableString(pumpForm.serial_number),
          model_name: pumpForm.model_name,
          manufacturer: toNullableString(pumpForm.manufacturer),
          status: pumpForm.status,
          maintenance_due_at: toNullableString(pumpForm.maintenance_due_at),
          notes: toNullableString(pumpForm.notes),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? '保存に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success('PCAポンプを登録しました');
      setPumpSheetOpen(false);
      setPumpForm(EMPTY_PUMP_FORM);
      await invalidateAll();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '保存に失敗しました');
    },
  });

  const createRentalMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/pca-pump-rentals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          pump_id: rentalForm.pump_id,
          institution_id: rentalForm.institution_id,
          status: 'active',
          rented_at: rentalForm.rented_at,
          due_at: toNullableString(rentalForm.due_at),
          contact_name: toNullableString(rentalForm.contact_name),
          contact_phone: toNullableString(rentalForm.contact_phone),
          rental_fee_yen: rentalForm.rental_fee_yen ? Number(rentalForm.rental_fee_yen) : null,
          notes: toNullableString(rentalForm.notes),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? '貸出登録に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success('PCAポンプの貸出を登録しました');
      setRentalSheetOpen(false);
      setRentalForm(emptyRentalForm());
      await invalidateAll();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '貸出登録に失敗しました');
    },
  });

  const updateRentalMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: PcaPumpRentalStatus }) => {
      const response = await fetch(`/api/pca-pump-rentals/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          status,
          returned_at: status === 'returned' ? todayDateKey() : null,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? '更新に失敗しました');
      }
      return payload;
    },
    onSuccess: async (_payload, variables) => {
      toast.success(variables.status === 'returned' ? '返却済みにしました' : '貸出を取消しました');
      await invalidateAll();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '更新に失敗しました');
    },
  });

  const updatePumpStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: PcaPumpStatus }) => {
      const response = await fetch(`/api/pca-pumps/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? '状態更新に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success('PCAポンプの状態を更新しました');
      await invalidateAll();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '状態更新に失敗しました');
    },
  });

  function openRental(pump?: PcaPump) {
    setRentalForm(emptyRentalForm(pump?.id ?? ''));
    setRentalSheetOpen(true);
  }

  const pumpColumns: ColumnDef<PcaPump>[] = [
    {
      accessorKey: 'asset_code',
      header: '管理番号',
      cell: ({ row }) => (
        <div>
          <p className="font-medium text-foreground">{row.original.asset_code}</p>
          <p className="text-xs text-muted-foreground">
            {row.original.serial_number ? `S/N ${row.original.serial_number}` : 'シリアル未設定'}
          </p>
        </div>
      ),
    },
    {
      accessorKey: 'model_name',
      header: '機種',
      cell: ({ row }) => (
        <div>
          <p>{row.original.model_name}</p>
          <p className="text-xs text-muted-foreground">
            {row.original.manufacturer ?? 'メーカー未設定'}
          </p>
        </div>
      ),
    },
    {
      accessorKey: 'status',
      header: '状態',
      cell: ({ row }) => (
        <Badge variant="outline" className={statusBadgeClass(row.original.status)}>
          {PUMP_STATUS_LABELS[row.original.status]}
        </Badge>
      ),
    },
    {
      id: 'current_rental',
      header: '貸出先',
      cell: ({ row }) => {
        const rental = row.original.rentals[0];
        return rental ? (
          <div>
            <p>{rental.institution.name}</p>
            <p className="text-xs text-muted-foreground">返却予定 {formatDate(rental.due_at)}</p>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      id: 'actions',
      header: '操作',
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => openRental(row.original)}
            disabled={row.original.status !== 'available'}
          >
            貸出
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              updatePumpStatusMutation.mutate({
                id: row.original.id,
                status: row.original.status === 'maintenance' ? 'available' : 'maintenance',
              })
            }
            disabled={row.original.status === 'rented' || updatePumpStatusMutation.isPending}
          >
            {row.original.status === 'maintenance' ? '利用可' : 'メンテ'}
          </Button>
        </div>
      ),
    },
  ];

  const rentalColumns: ColumnDef<PcaPumpRental>[] = [
    {
      accessorKey: 'pump.asset_code',
      header: 'PCAポンプ',
      cell: ({ row }) => (
        <div>
          <p className="font-medium text-foreground">{row.original.pump.asset_code}</p>
          <p className="text-xs text-muted-foreground">{row.original.pump.model_name}</p>
        </div>
      ),
    },
    {
      accessorKey: 'institution.name',
      header: '貸出先医療機関',
      cell: ({ row }) => (
        <div>
          <p>{row.original.institution.name}</p>
          <p className="text-xs text-muted-foreground">
            {row.original.contact_name ?? row.original.institution.phone ?? '連絡先未設定'}
          </p>
        </div>
      ),
    },
    {
      accessorKey: 'rented_at',
      header: '貸出日',
      cell: ({ row }) => formatDate(row.original.rented_at),
    },
    {
      accessorKey: 'due_at',
      header: '返却予定',
      cell: ({ row }) => formatDate(row.original.due_at),
    },
    {
      accessorKey: 'status',
      header: '状態',
      cell: ({ row }) => (
        <Badge variant="outline" className={statusBadgeClass(row.original.status)}>
          {RENTAL_STATUS_LABELS[row.original.status]}
        </Badge>
      ),
    },
    {
      accessorKey: 'rental_fee_yen',
      header: '請求予定',
      cell: ({ row }) => yen(row.original.rental_fee_yen),
    },
    {
      id: 'actions',
      header: '操作',
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => updateRentalMutation.mutate({ id: row.original.id, status: 'returned' })}
            disabled={updateRentalMutation.isPending}
          >
            返却
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              updateRentalMutation.mutate({ id: row.original.id, status: 'cancelled' })
            }
            disabled={updateRentalMutation.isPending}
          >
            取消
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="space-y-6">
        <Card>
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>PCAポンプ台帳</CardTitle>
              <CardDescription>管理番号、機種、貸出状態、メンテ予定を確認します。</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => openRental()}>
                貸出登録
              </Button>
              <Button onClick={() => setPumpSheetOpen(true)}>ポンプ登録</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-w-sm">
              <Label htmlFor="pca-pump-search">検索</Label>
              <Input
                id="pca-pump-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="管理番号 / シリアル / 機種"
              />
            </div>
            <DataTable columns={pumpColumns} data={pumps} isLoading={pumpsQuery.isLoading} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>貸出中・対応待ち</CardTitle>
            <CardDescription>
              医療機関へ貸出中、返却予定待ち、延滞扱いのPCAポンプを確認します。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={rentalColumns}
              data={openRentals}
              isLoading={rentalsQuery.isLoading}
            />
          </CardContent>
        </Card>
      </div>

      <Sheet open={pumpSheetOpen} onOpenChange={setPumpSheetOpen}>
        <SheetContent className="sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>PCAポンプを登録</SheetTitle>
            <SheetDescription>薬局が管理するPCAポンプ資産を登録します。</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pca-asset-code">管理番号</Label>
              <Input
                id="pca-asset-code"
                value={pumpForm.asset_code}
                onChange={(event) =>
                  setPumpForm((current) => ({ ...current, asset_code: event.target.value }))
                }
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pca-model-name">機種名</Label>
                <Input
                  id="pca-model-name"
                  value={pumpForm.model_name}
                  onChange={(event) =>
                    setPumpForm((current) => ({ ...current, model_name: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pca-manufacturer">メーカー</Label>
                <Input
                  id="pca-manufacturer"
                  value={pumpForm.manufacturer}
                  onChange={(event) =>
                    setPumpForm((current) => ({ ...current, manufacturer: event.target.value }))
                  }
                />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pca-serial">シリアル番号</Label>
                <Input
                  id="pca-serial"
                  value={pumpForm.serial_number}
                  onChange={(event) =>
                    setPumpForm((current) => ({ ...current, serial_number: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pca-maintenance-due">メンテ予定日</Label>
                <Input
                  id="pca-maintenance-due"
                  type="date"
                  value={pumpForm.maintenance_due_at}
                  onChange={(event) =>
                    setPumpForm((current) => ({
                      ...current,
                      maintenance_due_at: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pca-notes">備考</Label>
              <Textarea
                id="pca-notes"
                rows={3}
                value={pumpForm.notes}
                onChange={(event) =>
                  setPumpForm((current) => ({ ...current, notes: event.target.value }))
                }
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPumpSheetOpen(false)}>
                キャンセル
              </Button>
              <Button
                onClick={() => createPumpMutation.mutate()}
                disabled={createPumpMutation.isPending}
              >
                {createPumpMutation.isPending ? '保存中...' : '保存'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={rentalSheetOpen} onOpenChange={setRentalSheetOpen}>
        <SheetContent className="sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>PCAポンプの貸出登録</SheetTitle>
            <SheetDescription>
              貸出先医療機関、貸出日、返却予定、請求予定額を記録します。
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="rental-pump">PCAポンプ</Label>
              <Select
                value={rentalForm.pump_id}
                onValueChange={(value) =>
                  setRentalForm((current) => ({ ...current, pump_id: value ?? '' }))
                }
              >
                <SelectTrigger id="rental-pump">
                  <SelectValue placeholder="PCAポンプを選択" />
                </SelectTrigger>
                <SelectContent>
                  {availablePumps.map((pump) => (
                    <SelectItem key={pump.id} value={pump.id}>
                      {pump.asset_code} / {pump.model_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rental-institution">貸出先医療機関</Label>
              <Select
                value={rentalForm.institution_id}
                onValueChange={(value) =>
                  setRentalForm((current) => ({ ...current, institution_id: value ?? '' }))
                }
              >
                <SelectTrigger id="rental-institution">
                  <SelectValue placeholder="医療機関を選択" />
                </SelectTrigger>
                <SelectContent>
                  {institutions.map((institution) => (
                    <SelectItem key={institution.id} value={institution.id}>
                      {institution.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rental-start">貸出日</Label>
                <Input
                  id="rental-start"
                  type="date"
                  value={rentalForm.rented_at}
                  onChange={(event) =>
                    setRentalForm((current) => ({ ...current, rented_at: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rental-due">返却予定日</Label>
                <Input
                  id="rental-due"
                  type="date"
                  value={rentalForm.due_at}
                  onChange={(event) =>
                    setRentalForm((current) => ({ ...current, due_at: event.target.value }))
                  }
                />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rental-contact-name">医療機関連絡担当</Label>
                <Input
                  id="rental-contact-name"
                  value={rentalForm.contact_name}
                  onChange={(event) =>
                    setRentalForm((current) => ({ ...current, contact_name: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rental-contact-phone">連絡先電話</Label>
                <Input
                  id="rental-contact-phone"
                  value={rentalForm.contact_phone}
                  onChange={(event) =>
                    setRentalForm((current) => ({ ...current, contact_phone: event.target.value }))
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rental-fee">請求予定額</Label>
              <Input
                id="rental-fee"
                type="number"
                min={0}
                value={rentalForm.rental_fee_yen}
                onChange={(event) =>
                  setRentalForm((current) => ({ ...current, rental_fee_yen: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rental-notes">備考</Label>
              <Textarea
                id="rental-notes"
                rows={3}
                value={rentalForm.notes}
                onChange={(event) =>
                  setRentalForm((current) => ({ ...current, notes: event.target.value }))
                }
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRentalSheetOpen(false)}>
                キャンセル
              </Button>
              <Button
                onClick={() => createRentalMutation.mutate()}
                disabled={createRentalMutation.isPending}
              >
                {createRentalMutation.isPending ? '登録中...' : '貸出登録'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
