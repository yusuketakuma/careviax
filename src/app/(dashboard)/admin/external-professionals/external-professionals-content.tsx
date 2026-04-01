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
import { useOrgId } from '@/lib/hooks/use-org-id';

type ExternalProfessional = {
  id: string;
  profession_type: string;
  name: string;
  facility_id: string | null;
  facility_name: string | null;
  organization_name: string | null;
  department: string | null;
  phone: string | null;
  email: string | null;
  fax: string | null;
  preferred_contact_method: string | null;
  preferred_contact_time: string | null;
  last_contacted_at: string | null;
  last_success_channel: string | null;
  address: string | null;
  notes: string | null;
  patient_count: number;
  created_at: string;
  updated_at: string;
};

type ExternalProfessionalPatient = {
  id: string;
  role: string;
  is_primary: boolean;
  case_id: string;
  case_status: string;
  patient_id: string;
  patient_name: string;
  patient_name_kana: string;
};

type ExternalProfessionalCommunication = {
  id: string;
  kind: 'request' | 'event';
  request_type?: string;
  recipient_name?: string | null;
  recipient_role?: string | null;
  status?: string;
  event_type?: string;
  channel?: string;
  direction?: string;
  counterpart_name?: string | null;
  subject?: string | null;
  occurred_at: string;
};

type FormState = {
  profession_type: string;
  name: string;
  facility_id: string;
  organization_name: string;
  department: string;
  phone: string;
  email: string;
  fax: string;
  preferred_contact_method: string;
  preferred_contact_time: string;
  address: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  profession_type: 'physician',
  name: '',
  facility_id: '',
  organization_name: '',
  department: '',
  phone: '',
  email: '',
  fax: '',
  preferred_contact_method: '',
  preferred_contact_time: '',
  address: '',
  notes: '',
};

const PROFESSION_OPTIONS = [
  ['physician', '医師'],
  ['nurse', '看護師'],
  ['care_manager', 'ケアマネジャー'],
  ['medical_social_worker', '医療ソーシャルワーカー'],
  ['physical_therapist', '理学療法士'],
  ['occupational_therapist', '作業療法士'],
  ['speech_therapist', '言語聴覚士'],
  ['registered_dietitian', '管理栄養士'],
  ['dentist', '歯科医師'],
  ['dental_hygienist', '歯科衛生士'],
  ['home_helper', 'ホームヘルパー'],
  ['care_staff', '介護職'],
  ['other', 'その他'],
] as const;

function professionLabel(value: string) {
  return PROFESSION_OPTIONS.find(([key]) => key === value)?.[1] ?? value;
}

const CONTACT_METHOD_OPTIONS = [
  ['phone', '電話'],
  ['fax', 'FAX'],
  ['email', 'メール'],
  ['postal', '郵送'],
  ['in_person', '対面'],
  ['ses', 'SESメール'],
] as const;

function contactMethodLabel(value: string | null | undefined) {
  return CONTACT_METHOD_OPTIONS.find(([key]) => key === value)?.[1] ?? value ?? '未設定';
}

export function ExternalProfessionalsContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [professionFilter, setProfessionFilter] = useState<string>('all');
  const [facilityFilter, setFacilityFilter] = useState<string>('all');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const facilitiesQuery = useQuery({
    queryKey: ['facilities', orgId],
    queryFn: async () => {
      const response = await fetch('/api/facilities', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('施設一覧の取得に失敗しました');
      return response.json() as Promise<{ data: Array<{ id: string; name: string }> }>;
    },
    enabled: !!orgId,
    staleTime: 300_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['admin-external-professionals', orgId, searchQuery, professionFilter, facilityFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      if (professionFilter !== 'all') params.set('profession_type', professionFilter);
      if (facilityFilter !== 'all') params.set('facility_id', facilityFilter);
      const response = await fetch(`/api/admin/external-professionals?${params.toString()}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('他職種マスターの取得に失敗しました');
      return response.json() as Promise<{ data: ExternalProfessional[] }>;
    },
    enabled: !!orgId,
    staleTime: 300_000,
  });

  const detailQuery = useQuery({
    queryKey: ['admin-external-professional-detail', orgId, detailId],
    queryFn: async () => {
      const response = await fetch(`/api/admin/external-professionals/${detailId}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('他職種詳細の取得に失敗しました');
      return response.json() as Promise<{ data: ExternalProfessional }>;
    },
    enabled: !!orgId && !!detailId,
    staleTime: 300_000,
  });

  const patientsQuery = useQuery({
    queryKey: ['admin-external-professional-patients', orgId, detailId],
    queryFn: async () => {
      const response = await fetch(`/api/admin/external-professionals/${detailId}/patients`, {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('担当患者一覧の取得に失敗しました');
      return response.json() as Promise<{ data: ExternalProfessionalPatient[] }>;
    },
    enabled: !!orgId && !!detailId,
    staleTime: 300_000,
  });

  const communicationsQuery = useQuery({
    queryKey: ['admin-external-professional-communications', orgId, detailId],
    queryFn: async () => {
      const response = await fetch(`/api/admin/external-professionals/${detailId}/communications`, {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('連絡履歴の取得に失敗しました');
      return response.json() as Promise<{
        data: {
          requests: ExternalProfessionalCommunication[];
          events: ExternalProfessionalCommunication[];
        };
      }>;
    },
    enabled: !!orgId && !!detailId,
    staleTime: 300_000,
  });

  const professionals = data?.data ?? [];

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const endpoint = editingId
        ? `/api/admin/external-professionals/${editingId}`
        : '/api/admin/external-professionals';
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
      toast.success(editingId ? '他職種を更新しました' : '他職種を登録しました');
      resetForm();
      await queryClient.invalidateQueries({ queryKey: ['admin-external-professionals', orgId] });
      if (detailId === editingId && editingId) {
        await queryClient.invalidateQueries({
          queryKey: ['admin-external-professional-detail', orgId, editingId],
        });
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '保存に失敗しました');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/admin/external-professionals/${id}`, {
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
      toast.success('他職種を削除しました');
      await queryClient.invalidateQueries({ queryKey: ['admin-external-professionals', orgId] });
      if (detailId === deletedId) {
        setDetailId(null);
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '削除に失敗しました');
    },
  });

  const columns = useMemo<ColumnDef<ExternalProfessional>[]>(
    () => [
      {
        accessorKey: 'name',
        header: '氏名',
        cell: ({ row }) => (
          <div className="space-y-1">
            <div className="font-medium">{row.original.name}</div>
            <div className="text-xs text-muted-foreground">
              {row.original.facility_name ?? row.original.organization_name ?? '所属未設定'}
            </div>
            <div className="text-xs text-muted-foreground">
              {contactMethodLabel(row.original.preferred_contact_method)}
              {row.original.preferred_contact_time
                ? ` / ${row.original.preferred_contact_time}`
                : ''}
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'profession_type',
        header: '職種',
        cell: ({ row }) => <Badge variant="outline">{professionLabel(row.original.profession_type)}</Badge>,
      },
      {
        id: 'contact',
        header: '連絡先',
        cell: ({ row }) => (
          <div className="space-y-1 text-xs text-muted-foreground">
            <div>{row.original.phone ?? '電話なし'}</div>
            <div>{row.original.email ?? 'メールなし'}</div>
          </div>
        ),
      },
      {
        accessorKey: 'patient_count',
        header: '担当患者',
        cell: ({ row }) => `${row.original.patient_count}名`,
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
                  profession_type: row.original.profession_type,
                  name: row.original.name,
	                  facility_id: row.original.facility_id ?? '',
	                  organization_name: row.original.organization_name ?? '',
	                  department: row.original.department ?? '',
	                  phone: row.original.phone ?? '',
	                  email: row.original.email ?? '',
	                  fax: row.original.fax ?? '',
	                  preferred_contact_method: row.original.preferred_contact_method ?? '',
	                  preferred_contact_time: row.original.preferred_contact_time ?? '',
	                  address: row.original.address ?? '',
	                  notes: row.original.notes ?? '',
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
    total: professionals.length,
    organizations: new Set(
      professionals.map((item) => item.organization_name).filter((value): value is string => Boolean(value)),
    ).size,
    withContact: professionals.filter((item) => item.phone || item.email).length,
    linkedPatients: professionals.reduce((total, item) => total + item.patient_count, 0),
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard label="登録件数" value={summary.total} />
        <SummaryCard label="所属組織数" value={summary.organizations} />
        <SummaryCard label="担当患者リンク" value={summary.linkedPatients} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">検索・フィルタ</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px_260px]">
          <Field label="氏名・所属組織で検索">
            <Input
              placeholder="例: 佐藤 / 訪看 / さくら荘"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </Field>
          <Field label="職種">
            <Select value={professionFilter} onValueChange={(value) => setProfessionFilter(value ?? 'all')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">すべて</SelectItem>
                {PROFESSION_OPTIONS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="所属施設">
            <Select value={facilityFilter} onValueChange={(value) => setFacilityFilter(value ?? 'all')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">すべて</SelectItem>
                {(facilitiesQuery.data?.data ?? []).map((facility) => (
                  <SelectItem key={facility.id} value={facility.id}>
                    {facility.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {editingId ? '他職種マスターを編集' : '他職種マスターを追加'}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="職種">
            <Select
              value={form.profession_type}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  profession_type: value as FormState['profession_type'],
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROFESSION_OPTIONS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="氏名">
            <Input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </Field>
          <Field label="所属施設">
            <Select
              value={form.facility_id || '__none__'}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  facility_id: value && value !== '__none__' ? value : '',
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="施設を選択" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">未設定</SelectItem>
                {(facilitiesQuery.data?.data ?? []).map((facility) => (
                  <SelectItem key={facility.id} value={facility.id}>
                    {facility.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="所属組織">
            <Input
              value={form.organization_name}
              onChange={(event) =>
                setForm((current) => ({ ...current, organization_name: event.target.value }))
              }
            />
          </Field>
          <Field label="部署">
            <Input
              value={form.department}
              onChange={(event) => setForm((current) => ({ ...current, department: event.target.value }))}
            />
          </Field>
          <Field label="電話">
            <Input
              value={form.phone}
              onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
            />
          </Field>
          <Field label="メール">
            <Input
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
            />
          </Field>
          <Field label="FAX">
            <Input
              value={form.fax}
              onChange={(event) => setForm((current) => ({ ...current, fax: event.target.value }))}
            />
          </Field>
          <Field label="希望連絡チャネル">
            <Select
              value={form.preferred_contact_method || '__none__'}
              onValueChange={(value) => {
                const nextValue: FormState['preferred_contact_method'] =
                  value && value !== '__none__' ? value : '';
                setForm((current) => ({
                  ...current,
                  preferred_contact_method: nextValue,
                }));
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">未設定</SelectItem>
                {CONTACT_METHOD_OPTIONS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="希望連絡時間帯">
            <Input
              value={form.preferred_contact_time}
              onChange={(event) =>
                setForm((current) => ({ ...current, preferred_contact_time: event.target.value }))
              }
              placeholder="例: 平日 14:00-17:00"
            />
          </Field>
          <Field label="住所">
            <Input
              value={form.address}
              onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
            />
          </Field>
          <Field label="メモ" className="md:col-span-2">
            <Textarea
              rows={4}
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
            />
          </Field>
          <div className="flex gap-2 md:col-span-2 md:justify-end">
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
          <CardTitle className="text-base">他職種一覧</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={professionals}
            isLoading={isLoading}
            caption="他職種マスター一覧"
          />
        </CardContent>
      </Card>

      <Sheet open={!!detailId} onOpenChange={(open) => (!open ? setDetailId(null) : null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>他職種詳細</SheetTitle>
            <SheetDescription>基本情報と担当患者一覧を確認できます。</SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">基本情報</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                <DetailField label="氏名" value={detailQuery.data?.data.name} />
                <DetailField
                  label="職種"
                  value={
                    detailQuery.data?.data.profession_type
                      ? professionLabel(detailQuery.data.data.profession_type)
                      : undefined
                  }
                />
                <DetailField label="所属施設" value={detailQuery.data?.data.facility_name} />
                <DetailField label="所属組織" value={detailQuery.data?.data.organization_name} />
                <DetailField label="部署" value={detailQuery.data?.data.department} />
                <DetailField label="電話" value={detailQuery.data?.data.phone} />
                <DetailField label="メール" value={detailQuery.data?.data.email} />
                <DetailField label="FAX" value={detailQuery.data?.data.fax} />
                <DetailField
                  label="希望連絡"
                  value={`${contactMethodLabel(detailQuery.data?.data.preferred_contact_method)}${
                    detailQuery.data?.data.preferred_contact_time
                      ? ` / ${detailQuery.data.data.preferred_contact_time}`
                      : ''
                  }`}
                />
                <DetailField
                  label="連絡学習"
                  value={`最終連絡 ${
                    detailQuery.data?.data.last_contacted_at
                      ? new Date(detailQuery.data.data.last_contacted_at).toLocaleString('ja-JP')
                      : 'なし'
                  }${
                    detailQuery.data?.data.last_success_channel
                      ? ` / 成功 ${contactMethodLabel(detailQuery.data.data.last_success_channel)}`
                      : ''
                  }`}
                />
                <DetailField label="担当患者数" value={`${detailQuery.data?.data.patient_count ?? 0}名`} />
                <DetailField
                  label="住所"
                  value={detailQuery.data?.data.address}
                  className="md:col-span-2"
                />
                <DetailField
                  label="メモ"
                  value={detailQuery.data?.data.notes}
                  className="md:col-span-2"
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">担当患者一覧</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {patientsQuery.isLoading ? (
                  <div className="text-sm text-muted-foreground">読み込み中...</div>
                ) : (patientsQuery.data?.data.length ?? 0) === 0 ? (
                  <div className="text-sm text-muted-foreground">担当患者はまだ紐づいていません。</div>
                ) : (
                  patientsQuery.data?.data.map((item) => (
                    <div key={item.id} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-medium">{item.patient_name}</div>
                          <div className="text-xs text-muted-foreground">{item.patient_name_kana}</div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline">{item.case_status}</Badge>
                          <Badge variant={item.is_primary ? 'default' : 'secondary'}>
                            {item.is_primary ? '主要担当' : '連携先'}
                          </Badge>
                        </div>
                      </div>
                      <div className="mt-2 text-sm text-muted-foreground">
                        役割: {item.role} / ケース: {item.case_id.slice(-6).toUpperCase()}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">連絡履歴</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {communicationsQuery.isLoading ? (
                  <div className="text-sm text-muted-foreground">読み込み中...</div>
                ) : [...(communicationsQuery.data?.data.requests ?? []), ...(communicationsQuery.data?.data.events ?? [])]
                    .sort((left, right) => right.occurred_at.localeCompare(left.occurred_at))
                    .slice(0, 10)
                    .map((item) => (
                      <div key={`${item.kind}-${item.id}`} className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{item.kind === 'request' ? '依頼' : 'イベント'}</Badge>
                          <div className="text-sm font-medium">
                            {item.subject || item.request_type || item.event_type || '件名未設定'}
                          </div>
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {item.kind === 'request'
                            ? `${item.recipient_name ?? '宛先未設定'} / ${item.status ?? 'draft'}`
                            : `${item.counterpart_name ?? '相手先未設定'} / ${item.channel ?? 'channel未設定'} / ${item.direction ?? 'direction未設定'}`}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {new Date(item.occurred_at).toLocaleString('ja-JP')}
                        </div>
                      </div>
                    ))}
                {!communicationsQuery.isLoading &&
                (communicationsQuery.data?.data.requests.length ?? 0) === 0 &&
                (communicationsQuery.data?.data.events.length ?? 0) === 0 ? (
                  <div className="text-sm text-muted-foreground">関連する連絡履歴はまだありません。</div>
                ) : null}
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
