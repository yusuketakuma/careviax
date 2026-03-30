'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { Checkbox } from '@/components/ui/checkbox';
import { useOrgId } from '@/lib/hooks/use-org-id';

type FacilityContact = {
  id?: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  fax: string | null;
  is_primary: boolean;
  notes: string | null;
};

type Facility = {
  id: string;
  name: string;
  facility_type: string;
  address: string | null;
  phone: string | null;
  fax: string | null;
  acceptance_time_from: string | null;
  acceptance_time_to: string | null;
  regular_visit_weekdays: number[];
  patient_count?: number;
  notes: string | null;
  contacts: FacilityContact[];
  created_at: string;
  updated_at: string;
};

type FacilityDetail = Facility & {
  patient_count: number;
};

type FacilityPatient = {
  residence_id: string;
  patient_id: string;
  patient_name: string;
  patient_name_kana: string;
  phone: string | null;
  unit_name: string | null;
  case_id: string | null;
  case_status: string | null;
};

type FacilityVisitBatch = {
  id: string;
  scheduled_date: string;
  pharmacist_id: string;
  patient_count: number;
  estimated_duration: number | null;
  created_at: string;
  visits: Array<{
    schedule_id: string;
    route_order: number | null;
    patient_id: string;
    patient_name: string;
  }>;
};

type ContactDraft = {
  name: string;
  role: string;
  phone: string;
  email: string;
  fax: string;
  is_primary: boolean;
  notes: string;
};

type FormState = {
  name: string;
  facility_type: string;
  address: string;
  phone: string;
  fax: string;
  acceptance_time_from: string;
  acceptance_time_to: string;
  regular_visit_weekdays: number[];
  notes: string;
  contacts: ContactDraft[];
};

const EMPTY_CONTACT: ContactDraft = {
  name: '',
  role: '',
  phone: '',
  email: '',
  fax: '',
  is_primary: true,
  notes: '',
};

const EMPTY_FORM: FormState = {
  name: '',
  facility_type: 'nursing_home',
  address: '',
  phone: '',
  fax: '',
  acceptance_time_from: '',
  acceptance_time_to: '',
  regular_visit_weekdays: [],
  notes: '',
  contacts: [EMPTY_CONTACT],
};

const WEEKDAY_OPTIONS = [
  { value: 1, label: '月' },
  { value: 2, label: '火' },
  { value: 3, label: '水' },
  { value: 4, label: '木' },
  { value: 5, label: '金' },
  { value: 6, label: '土' },
  { value: 0, label: '日' },
] as const;

function formatWeekdays(values: number[]) {
  if (values.length === 0) return '未設定';
  const labels = WEEKDAY_OPTIONS.filter((option) => values.includes(option.value)).map(
    (option) => option.label
  );
  return labels.join(' / ');
}

const FACILITY_TYPES = [
  ['nursing_home', '介護老人福祉施設'],
  ['group_home', 'グループホーム'],
  ['assisted_living', '有料老人ホーム'],
  ['clinic', 'クリニック'],
  ['hospital', '病院'],
  ['day_service', 'デイサービス'],
  ['home', '居宅'],
  ['other', 'その他'],
] as const;

function facilityTypeLabel(value: string) {
  return FACILITY_TYPES.find(([key]) => key === value)?.[1] ?? value;
}

export function FacilitiesContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-facilities', orgId],
    queryFn: async () => {
      const response = await fetch('/api/admin/facilities', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('施設マスターの取得に失敗しました');
      return response.json() as Promise<{ data: Facility[] }>;
    },
    enabled: !!orgId,
  });

  const facilities = data?.data ?? [];

  const detailQuery = useQuery({
    queryKey: ['admin-facility-detail', orgId, detailId],
    queryFn: async () => {
      const response = await fetch(`/api/admin/facilities/${detailId}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('施設詳細の取得に失敗しました');
      return response.json() as Promise<{ data: FacilityDetail }>;
    },
    enabled: !!orgId && !!detailId,
  });

  const patientsQuery = useQuery({
    queryKey: ['admin-facility-patients', orgId, detailId],
    queryFn: async () => {
      const response = await fetch(`/api/admin/facilities/${detailId}/patients`, {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('施設所属患者の取得に失敗しました');
      return response.json() as Promise<{ data: FacilityPatient[] }>;
    },
    enabled: !!orgId && !!detailId,
  });

  const visitBatchesQuery = useQuery({
    queryKey: ['admin-facility-visit-batches', orgId, detailId],
    queryFn: async () => {
      const response = await fetch(`/api/admin/facilities/${detailId}/visit-batches`, {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('施設訪問履歴の取得に失敗しました');
      return response.json() as Promise<{ data: FacilityVisitBatch[] }>;
    },
    enabled: !!orgId && !!detailId,
  });

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const endpoint = editingId ? `/api/admin/facilities/${editingId}` : '/api/admin/facilities';
      const method = editingId ? 'PATCH' : 'POST';
      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          ...form,
          contacts: form.contacts.filter((contact) => contact.name.trim()),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? '保存に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success(editingId ? '施設マスターを更新しました' : '施設を登録しました');
      resetForm();
      await queryClient.invalidateQueries({ queryKey: ['admin-facilities', orgId] });
      if (detailId === editingId && editingId) {
        await queryClient.invalidateQueries({ queryKey: ['admin-facility-detail', orgId, editingId] });
        await queryClient.invalidateQueries({ queryKey: ['admin-facility-patients', orgId, editingId] });
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '保存に失敗しました');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/admin/facilities/${id}`, {
        method: 'DELETE',
        headers: { 'x-org-id': orgId },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? '削除に失敗しました');
      }
      return payload;
    },
    onSuccess: async (_payload, deletedId) => {
      toast.success('施設を削除しました');
      await queryClient.invalidateQueries({ queryKey: ['admin-facilities', orgId] });
      if (detailId === deletedId) {
        setDetailId(null);
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '削除に失敗しました');
    },
  });

  const columns = useMemo<ColumnDef<Facility>[]>(
    () => [
      {
        accessorKey: 'name',
        header: '施設名',
        cell: ({ row }) => (
          <div className="space-y-1">
            <div className="font-medium">{row.original.name}</div>
            <div className="text-xs text-muted-foreground">
              {row.original.address ?? '住所未設定'}
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'facility_type',
        header: '種別',
        cell: ({ row }) => <Badge variant="outline">{facilityTypeLabel(row.original.facility_type)}</Badge>,
      },
      {
        id: 'contact',
        header: '主担当',
        cell: ({ row }) => {
          const primaryContact = row.original.contacts.find((contact) => contact.is_primary) ?? row.original.contacts[0];
          return (
            <div className="space-y-1 text-xs text-muted-foreground">
              <div>{primaryContact?.name ?? '担当未設定'}</div>
              <div>{primaryContact?.phone ?? row.original.phone ?? '電話未設定'}</div>
            </div>
          );
        },
      },
      {
        id: 'acceptance_time',
        header: '受入時間',
        cell: ({ row }) => {
          const from = row.original.acceptance_time_from;
          const to = row.original.acceptance_time_to;
          return (
            <div className="text-sm text-muted-foreground">
              {from || to ? `${from ?? '--:--'} - ${to ?? '--:--'}` : '未設定'}
            </div>
          );
        },
      },
      {
        accessorKey: 'patient_count',
        header: '所属患者',
        cell: ({ row }) => <div className="text-sm">{row.original.patient_count ?? 0}名</div>,
      },
      {
        id: 'actions',
        header: '操作',
        cell: ({ row }) => (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setDetailId(row.original.id)}>
              詳細
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditingId(row.original.id);
                setForm({
                  name: row.original.name,
                  facility_type: row.original.facility_type,
                  address: row.original.address ?? '',
                  phone: row.original.phone ?? '',
                  fax: row.original.fax ?? '',
                  acceptance_time_from: row.original.acceptance_time_from ?? '',
                  acceptance_time_to: row.original.acceptance_time_to ?? '',
                  regular_visit_weekdays: row.original.regular_visit_weekdays ?? [],
                  notes: row.original.notes ?? '',
                  contacts:
                    row.original.contacts.length > 0
                      ? row.original.contacts.map((contact) => ({
                          name: contact.name,
                          role: contact.role ?? '',
                          phone: contact.phone ?? '',
                          email: contact.email ?? '',
                          fax: contact.fax ?? '',
                          is_primary: contact.is_primary,
                          notes: contact.notes ?? '',
                        }))
                      : [EMPTY_CONTACT],
                });
              }}
            >
              編集
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => deleteMutation.mutate(row.original.id)}
              disabled={deleteMutation.isPending}
            >
              削除
            </Button>
          </div>
        ),
      },
    ],
    [deleteMutation],
  );

  const summary = {
    total: facilities.length,
    withContacts: facilities.filter((item) => item.contacts.length > 0).length,
    uniqueTypes: new Set(facilities.map((item) => item.facility_type)).size,
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard label="登録施設数" value={summary.total} />
        <SummaryCard label="連絡先設定済み" value={summary.withContacts} />
        <SummaryCard label="施設種別数" value={summary.uniqueTypes} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {editingId ? '施設マスターを編集' : '施設マスターを追加'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="施設名">
              <Input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              />
            </Field>
          <Field label="施設種別">
            <Select
              value={form.facility_type}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  facility_type: value as FormState['facility_type'],
                }))
              }
            >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FACILITY_TYPES.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="代表電話">
              <Input
                value={form.phone}
                onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
              />
            </Field>
            <Field label="代表FAX">
              <Input
                value={form.fax}
                onChange={(event) => setForm((current) => ({ ...current, fax: event.target.value }))}
              />
            </Field>
            <Field label="受入開始">
              <Input
                type="time"
                value={form.acceptance_time_from}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    acceptance_time_from: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="受入終了">
              <Input
                type="time"
                value={form.acceptance_time_to}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    acceptance_time_to: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="定期訪問曜日" className="md:col-span-2">
              <div className="flex flex-wrap gap-3 rounded-md border border-border p-3">
                {WEEKDAY_OPTIONS.map((weekday) => (
                  <label key={weekday.value} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={form.regular_visit_weekdays.includes(weekday.value)}
                      onCheckedChange={(checked) =>
                        setForm((current) => ({
                          ...current,
                          regular_visit_weekdays: checked
                            ? [...current.regular_visit_weekdays, weekday.value].sort()
                            : current.regular_visit_weekdays.filter(
                                (value) => value !== weekday.value
                              ),
                        }))
                      }
                    />
                    {weekday.label}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="住所" className="md:col-span-2">
              <Textarea
                rows={2}
                value={form.address}
                onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
              />
            </Field>
            <Field label="メモ" className="md:col-span-2">
              <Textarea
                rows={3}
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              />
            </Field>
          </div>

          <div className="space-y-3 rounded-lg border border-dashed border-border p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">施設連絡先</div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    contacts: [...current.contacts, { ...EMPTY_CONTACT, is_primary: false }],
                  }))
                }
              >
                連絡先を追加
              </Button>
            </div>
            {form.contacts.map((contact, index) => (
              <div key={`contact-${index}`} className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-2">
                <Field label="担当者名">
                  <Input
                    value={contact.name}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        contacts: current.contacts.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, name: event.target.value } : item
                        ),
                      }))
                    }
                  />
                </Field>
                <Field label="役割">
                  <Input
                    value={contact.role}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        contacts: current.contacts.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, role: event.target.value } : item
                        ),
                      }))
                    }
                  />
                </Field>
                <Field label="電話">
                  <Input
                    value={contact.phone}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        contacts: current.contacts.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, phone: event.target.value } : item
                        ),
                      }))
                    }
                  />
                </Field>
                <Field label="メール">
                  <Input
                    value={contact.email}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        contacts: current.contacts.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, email: event.target.value } : item
                        ),
                      }))
                    }
                  />
                </Field>
                <Field label="FAX">
                  <Input
                    value={contact.fax}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        contacts: current.contacts.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, fax: event.target.value } : item
                        ),
                      }))
                    }
                  />
                </Field>
                <Field label="メモ">
                  <Input
                    value={contact.notes}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        contacts: current.contacts.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, notes: event.target.value } : item
                        ),
                      }))
                    }
                  />
                </Field>
                <div className="flex items-center justify-between md:col-span-2">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={contact.is_primary}
                      onCheckedChange={(checked) =>
                        setForm((current) => ({
                          ...current,
                          contacts: current.contacts.map((item, itemIndex) => ({
                            ...item,
                            is_primary: itemIndex === index ? checked === true : false,
                          })),
                        }))
                      }
                    />
                    主担当
                  </label>
                  {form.contacts.length > 1 ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          contacts: current.contacts.filter((_, itemIndex) => itemIndex !== index),
                        }))
                      }
                    >
                      削除
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2 justify-end">
            {editingId ? (
              <Button variant="outline" onClick={resetForm}>
                キャンセル
              </Button>
            ) : null}
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? '保存中...' : editingId ? '更新する' : '登録する'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">施設一覧</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable columns={columns} data={facilities} isLoading={isLoading} caption="施設マスター一覧" />
        </CardContent>
      </Card>

      <Sheet open={!!detailId} onOpenChange={(open) => (!open ? setDetailId(null) : null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>施設詳細</SheetTitle>
            <SheetDescription>基本情報・連絡先・所属患者を確認できます。</SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">基本情報</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                <DetailField label="施設名" value={detailQuery.data?.data.name} />
                <DetailField
                  label="施設種別"
                  value={
                    detailQuery.data?.data.facility_type
                      ? facilityTypeLabel(detailQuery.data.data.facility_type)
                      : undefined
                  }
                />
                <DetailField label="代表電話" value={detailQuery.data?.data.phone} />
                <DetailField label="代表FAX" value={detailQuery.data?.data.fax} />
                <DetailField
                  label="受入時間"
                  value={
                    detailQuery.data?.data.acceptance_time_from || detailQuery.data?.data.acceptance_time_to
                      ? `${detailQuery.data?.data.acceptance_time_from ?? '--:--'} - ${detailQuery.data?.data.acceptance_time_to ?? '--:--'}`
                      : '未設定'
                  }
                />
                <DetailField
                  label="定期訪問曜日"
                  value={formatWeekdays(detailQuery.data?.data.regular_visit_weekdays ?? [])}
                />
                <DetailField label="所属患者数" value={`${detailQuery.data?.data.patient_count ?? 0}名`} />
                <DetailField label="住所" value={detailQuery.data?.data.address} className="md:col-span-2" />
                <DetailField label="メモ" value={detailQuery.data?.data.notes} className="md:col-span-2" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">施設担当者</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(detailQuery.data?.data.contacts.length ?? 0) === 0 ? (
                  <div className="text-sm text-muted-foreground">担当者はまだ登録されていません。</div>
                ) : (
                  detailQuery.data?.data.contacts.map((contact) => (
                    <div key={contact.id} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium">{contact.name}</div>
                        {contact.is_primary ? <Badge>主担当</Badge> : null}
                      </div>
                      <div className="mt-2 text-sm text-muted-foreground">
                        {contact.role ?? '役割未設定'} / {contact.phone ?? '電話未設定'}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">所属患者一覧</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {patientsQuery.isLoading ? (
                  <div className="text-sm text-muted-foreground">読み込み中...</div>
                ) : (patientsQuery.data?.data.length ?? 0) === 0 ? (
                  <div className="text-sm text-muted-foreground">この施設に紐づく患者はいません。</div>
                ) : (
                  patientsQuery.data?.data.map((patient) => (
                    <div key={patient.residence_id} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-medium">{patient.patient_name}</div>
                          <div className="text-xs text-muted-foreground">{patient.patient_name_kana}</div>
                        </div>
                        {patient.case_status ? <Badge variant="outline">{patient.case_status}</Badge> : null}
                      </div>
                      <div className="mt-2 text-sm text-muted-foreground">
                        居室: {patient.unit_name ?? '未設定'} / 電話: {patient.phone ?? '未設定'}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">施設訪問履歴</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {visitBatchesQuery.isLoading ? (
                  <div className="text-sm text-muted-foreground">読み込み中...</div>
                ) : (visitBatchesQuery.data?.data.length ?? 0) === 0 ? (
                  <div className="text-sm text-muted-foreground">訪問履歴はまだありません。</div>
                ) : (
                  visitBatchesQuery.data?.data.map((batch) => (
                    <div key={batch.id} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-medium">
                          {new Date(batch.scheduled_date).toLocaleDateString('ja-JP')} / {batch.patient_count}名
                        </div>
                        {batch.estimated_duration ? (
                          <Badge variant="outline">{batch.estimated_duration}分</Badge>
                        ) : null}
                      </div>
                      <div className="mt-2 text-sm text-muted-foreground">
                        {batch.visits.map((visit) => `${visit.route_order ?? '-'}:${visit.patient_name}`).join(' / ')}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent>
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-2 text-3xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block">{label}</Label>
      {children}
    </div>
  );
}

function DetailField({
  label,
  value,
  className,
}: {
  label: string;
  value: string | null | undefined;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm">{value?.trim() ? value : '未設定'}</div>
    </div>
  );
}
