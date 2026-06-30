'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StateBadge } from '@/components/ui/state-badge';
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
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import {
  ADMIN_EXTERNAL_PROFESSIONALS_API_PATH,
  buildAdminExternalProfessionalApiPath,
  buildAdminExternalProfessionalsApiPath,
} from '@/lib/external-professionals/api-paths';
import { buildAdminFacilitiesApiPath } from '@/lib/facilities/api-paths';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { formatDateLabel } from '@/lib/ui/date-format';

type ProfessionType =
  | 'physician'
  | 'nurse'
  | 'care_manager'
  | 'medical_social_worker'
  | 'physical_therapist'
  | 'occupational_therapist'
  | 'speech_therapist'
  | 'registered_dietitian'
  | 'dentist'
  | 'dental_hygienist'
  | 'home_helper'
  | 'care_staff'
  | 'other';

type ContactMethod = 'email' | 'fax' | 'phone' | 'in_person' | 'postal' | 'ses';

export type ExternalProfessional = {
  id: string;
  profession_type: ProfessionType;
  name: string;
  facility_id: string | null;
  facility_name: string | null;
  organization_name: string | null;
  department: string | null;
  phone: string | null;
  email: string | null;
  fax: string | null;
  preferred_contact_method: ContactMethod | null;
  preferred_contact_time: string | null;
  last_contacted_at: string | null;
  last_success_channel: string | null;
  address: string | null;
  notes: string | null;
  patient_count: number;
  created_at: string;
  updated_at: string;
};

type ExternalProfessionalsResponse = {
  data: ExternalProfessional[];
  total_count?: number;
  visible_count?: number;
  hidden_count?: number;
  truncated?: boolean;
};

type FacilityOption = {
  id: string;
  name: string;
};

type FacilitiesResponse = {
  data: FacilityOption[];
};

type FormState = {
  profession_type: ProfessionType;
  name: string;
  facility_id: string;
  organization_name: string;
  department: string;
  phone: string;
  email: string;
  fax: string;
  preferred_contact_method: ContactMethod | typeof NONE_VALUE;
  preferred_contact_time: string;
  address: string;
  notes: string;
};

const NONE_VALUE = '__none__';
const EMPTY_PROFESSIONALS: ExternalProfessional[] = [];
const EMPTY_FACILITY_OPTIONS: FacilityOption[] = [];

const PROFESSION_TYPES: Array<{ value: ProfessionType; label: string }> = [
  { value: 'physician', label: '医師' },
  { value: 'nurse', label: '訪問看護師' },
  { value: 'care_manager', label: 'ケアマネジャー' },
  { value: 'medical_social_worker', label: 'MSW' },
  { value: 'physical_therapist', label: '理学療法士' },
  { value: 'occupational_therapist', label: '作業療法士' },
  { value: 'speech_therapist', label: '言語聴覚士' },
  { value: 'registered_dietitian', label: '管理栄養士' },
  { value: 'dentist', label: '歯科医師' },
  { value: 'dental_hygienist', label: '歯科衛生士' },
  { value: 'home_helper', label: 'ヘルパー' },
  { value: 'care_staff', label: '介護職員' },
  { value: 'other', label: 'その他他職種' },
];

const CONTACT_METHODS: Array<{ value: ContactMethod; label: string }> = [
  { value: 'fax', label: 'FAX' },
  { value: 'phone', label: '電話' },
  { value: 'email', label: 'メール' },
  { value: 'postal', label: '郵送' },
  { value: 'in_person', label: '対面' },
  { value: 'ses', label: 'SESメール' },
];

function createEmptyForm(): FormState {
  return {
    profession_type: 'nurse',
    name: '',
    facility_id: NONE_VALUE,
    organization_name: '',
    department: '',
    phone: '',
    email: '',
    fax: '',
    preferred_contact_method: NONE_VALUE,
    preferred_contact_time: '',
    address: '',
    notes: '',
  };
}

function toForm(item: ExternalProfessional): FormState {
  return {
    profession_type: item.profession_type,
    name: item.name,
    facility_id: item.facility_id ?? NONE_VALUE,
    organization_name: item.organization_name ?? '',
    department: item.department ?? '',
    phone: item.phone ?? '',
    email: item.email ?? '',
    fax: item.fax ?? '',
    preferred_contact_method: item.preferred_contact_method ?? NONE_VALUE,
    preferred_contact_time: item.preferred_contact_time ?? '',
    address: item.address ?? '',
    notes: item.notes ?? '',
  };
}

function trimOrUndefined(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function trimOrNull(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function getProfessionLabel(type: ProfessionType) {
  return PROFESSION_TYPES.find((item) => item.value === type)?.label ?? type;
}

function getContactMethodLabel(method: ContactMethod | null) {
  if (!method) return '送付方法未設定';
  return CONTACT_METHODS.find((item) => item.value === method)?.label ?? method;
}

function formatOptionalDateTime(value: string | null) {
  if (!value) return '記録なし';
  return formatDateLabel(value, { pattern: 'yyyy/M/d HH:mm' });
}

function buildCreatePayload(form: FormState) {
  return {
    profession_type: form.profession_type,
    name: form.name.trim(),
    facility_id: form.facility_id === NONE_VALUE ? undefined : form.facility_id,
    organization_name: trimOrUndefined(form.organization_name),
    department: trimOrUndefined(form.department),
    phone: trimOrUndefined(form.phone),
    email: trimOrUndefined(form.email),
    fax: trimOrUndefined(form.fax),
    preferred_contact_method:
      form.preferred_contact_method === NONE_VALUE ? undefined : form.preferred_contact_method,
    preferred_contact_time: trimOrUndefined(form.preferred_contact_time),
    address: trimOrUndefined(form.address),
    notes: trimOrUndefined(form.notes),
  };
}

function buildUpdatePayload(form: FormState) {
  return {
    profession_type: form.profession_type,
    name: form.name.trim(),
    facility_id: form.facility_id === NONE_VALUE ? null : form.facility_id,
    organization_name: trimOrNull(form.organization_name),
    department: trimOrNull(form.department),
    phone: trimOrNull(form.phone),
    email: trimOrNull(form.email),
    fax: trimOrNull(form.fax),
    preferred_contact_method:
      form.preferred_contact_method === NONE_VALUE ? null : form.preferred_contact_method,
    preferred_contact_time: trimOrNull(form.preferred_contact_time),
    address: trimOrNull(form.address),
    notes: trimOrNull(form.notes),
  };
}

function getFormBlocker(form: FormState) {
  if (!form.name.trim()) return '氏名は必須です。';
  return null;
}

function matchesProfessionalQuery(item: ExternalProfessional, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const haystack = [
    item.name,
    getProfessionLabel(item.profession_type),
    item.facility_name ?? '',
    item.organization_name ?? '',
    item.department ?? '',
    item.phone ?? '',
    item.email ?? '',
    item.fax ?? '',
    item.address ?? '',
    item.notes ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(normalized);
}

function ContactLine({ label, value }: { label: string; value: string | null }) {
  return (
    <p className="text-xs leading-5 text-muted-foreground">
      <span className="font-medium text-foreground">{label}</span>{' '}
      {value?.trim() ? value : '未設定'}
    </p>
  );
}

export function ExternalProfessionalsContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingProfessional, setEditingProfessional] = useState<ExternalProfessional | null>(null);
  const [form, setForm] = useState<FormState>(createEmptyForm);
  const [deleteTarget, setDeleteTarget] = useState<ExternalProfessional | null>(null);

  const professionalsQuery = useQuery({
    queryKey: ['admin-external-professionals', orgId],
    queryFn: async () => {
      const response = await fetch(buildAdminExternalProfessionalsApiPath(new URLSearchParams()), {
        headers: buildOrgHeaders(orgId),
      });
      if (!response.ok) throw new Error('他職種マスターの取得に失敗しました');
      return response.json() as Promise<ExternalProfessionalsResponse>;
    },
    enabled: !!orgId,
  });

  const facilitiesQuery = useQuery({
    queryKey: ['admin-facilities', orgId, 'external-professional-options'],
    queryFn: async () => {
      const response = await fetch(buildAdminFacilitiesApiPath(new URLSearchParams()), {
        headers: buildOrgHeaders(orgId),
      });
      if (!response.ok) throw new Error('施設候補の取得に失敗しました');
      return response.json() as Promise<FacilitiesResponse>;
    },
    enabled: !!orgId,
  });

  const professionals = professionalsQuery.data?.data ?? EMPTY_PROFESSIONALS;
  const facilityOptions = facilitiesQuery.data?.data ?? EMPTY_FACILITY_OPTIONS;
  const filteredProfessionals = useMemo(
    () => professionals.filter((item) => matchesProfessionalQuery(item, query)),
    [professionals, query],
  );
  const totalCount = professionalsQuery.data?.total_count ?? professionals.length;
  const hiddenCount = professionalsQuery.data?.hidden_count ?? 0;
  const formBlocker = getFormBlocker(form);

  function resetForm() {
    setEditingProfessional(null);
    setForm(createEmptyForm());
  }

  function openCreate() {
    resetForm();
    setSheetOpen(true);
  }

  function openEdit(item: ExternalProfessional) {
    setEditingProfessional(item);
    setForm(toForm(item));
    setSheetOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const blocker = getFormBlocker(form);
      if (blocker) throw new Error(blocker);
      const endpoint = editingProfessional
        ? buildAdminExternalProfessionalApiPath(editingProfessional.id)
        : ADMIN_EXTERNAL_PROFESSIONALS_API_PATH;
      const method = editingProfessional ? 'PATCH' : 'POST';
      const response = await fetch(endpoint, {
        method,
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify(
          editingProfessional ? buildUpdatePayload(form) : buildCreatePayload(form),
        ),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? '保存に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success(editingProfessional ? '他職種マスターを更新しました' : '他職種を登録しました');
      setSheetOpen(false);
      resetForm();
      await queryClient.invalidateQueries({ queryKey: ['admin-external-professionals', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '保存に失敗しました');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (item: ExternalProfessional) => {
      if (item.patient_count > 0) {
        throw new Error('担当患者に紐づく他職種マスターは削除できません。');
      }
      const response = await fetch(buildAdminExternalProfessionalApiPath(item.id), {
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
      toast.success('他職種マスターを削除しました');
      await queryClient.invalidateQueries({ queryKey: ['admin-external-professionals', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '削除に失敗しました');
    },
  });

  const columns: ColumnDef<ExternalProfessional>[] = [
    {
      accessorKey: 'name',
      header: '氏名・職種',
      cell: ({ row }) => (
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-foreground">{row.original.name}</p>
          <StateBadge role="readonly">
            {getProfessionLabel(row.original.profession_type)}
          </StateBadge>
        </div>
      ),
    },
    {
      id: 'organization',
      header: '所属',
      cell: ({ row }) => (
        <div className="space-y-1 text-sm">
          <p className="font-medium text-foreground">
            {row.original.facility_name || row.original.organization_name || '所属未設定'}
          </p>
          <p className="text-xs text-muted-foreground">
            {[row.original.department, row.original.address].filter(Boolean).join(' / ') ||
              '部署・住所未設定'}
          </p>
        </div>
      ),
    },
    {
      id: 'contacts',
      header: '連絡先',
      cell: ({ row }) => (
        <div className="space-y-1">
          <ContactLine label="TEL" value={row.original.phone} />
          <ContactLine label="FAX" value={row.original.fax} />
          <ContactLine label="Mail" value={row.original.email} />
          <p className="text-xs leading-5 text-muted-foreground">
            優先: {getContactMethodLabel(row.original.preferred_contact_method)}
            {row.original.preferred_contact_time ? ` / ${row.original.preferred_contact_time}` : ''}
          </p>
        </div>
      ),
    },
    {
      accessorKey: 'patient_count',
      header: '担当患者',
      cell: ({ row }) => (
        <div className="space-y-1">
          <p className="text-sm font-medium tabular-nums">{row.original.patient_count}名</p>
          {row.original.patient_count > 0 ? (
            <p className="text-xs text-muted-foreground">削除前にケアチーム解除が必要</p>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: 'last_contacted_at',
      header: '最終連絡',
      cell: ({ row }) => (
        <div className="space-y-1 text-sm">
          <p>{formatOptionalDateTime(row.original.last_contacted_at)}</p>
          <p className="text-xs text-muted-foreground">
            成功: {getContactMethodLabel(row.original.last_success_channel as ContactMethod | null)}
          </p>
        </div>
      ),
    },
    {
      id: 'actions',
      header: '操作',
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="!h-11 !min-h-[44px]"
            aria-label={`${row.original.name} を編集`}
            onClick={() => openEdit(row.original)}
          >
            編集
          </Button>
          <Button
            type="button"
            variant="outline"
            className="!h-11 !min-h-[44px]"
            aria-label={`${row.original.name} を削除`}
            disabled={row.original.patient_count > 0 || deleteMutation.isPending}
            onClick={() => setDeleteTarget(row.original)}
          >
            削除
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <ConfirmDialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="他職種マスターを削除しますか？"
        description={
          deleteTarget
            ? `${deleteTarget.name} を削除します。担当患者が残っている場合は削除できません。`
            : ''
        }
        variant="destructive"
        confirmLabel="削除する"
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteMutation.mutate(deleteTarget);
          setDeleteTarget(null);
        }}
      />

      <section className="space-y-4" data-testid="external-professionals-master-content">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">他職種一覧</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              患者ケアチーム・報告書送付候補・連絡履歴の参照元になる正本を更新します。
            </p>
          </div>
          <Button className="!h-11 !min-h-[44px]" type="button" onClick={openCreate}>
            <Plus aria-hidden className="mr-2 h-4 w-4" />
            新規登録
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(240px,360px)_1fr] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="external-professional-search">検索</Label>
            <Input
              id="external-professional-search"
              className="!h-11 !min-h-[44px]"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="氏名 / 所属 / 職種 / 連絡先"
            />
          </div>
          <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
            <StateBadge role="readonly">登録 {totalCount}件</StateBadge>
            <StateBadge role={hiddenCount > 0 ? 'confirm' : 'done'}>
              表示 {filteredProfessionals.length}件
            </StateBadge>
            {hiddenCount > 0 || professionalsQuery.data?.truncated ? (
              <StateBadge role="confirm">非表示 {hiddenCount}件</StateBadge>
            ) : null}
          </div>
        </div>

        {professionalsQuery.isError || !orgId ? (
          <Alert variant="destructive" role="alert">
            <AlertTitle>他職種マスターを取得できませんでした</AlertTitle>
            <AlertDescription>
              権限または通信状態を確認して再読み込みしてください。空の他職種一覧として扱いません。
            </AlertDescription>
          </Alert>
        ) : null}

        <DataTable
          columns={columns}
          data={filteredProfessionals}
          isLoading={professionalsQuery.isLoading}
          errorMessage={
            professionalsQuery.isError || !orgId
              ? '他職種マスター一覧を取得できませんでした'
              : undefined
          }
          emptyMessage={
            query.trim() ? '検索条件に一致する他職種はありません' : '他職種はまだ登録されていません'
          }
          onRetry={() => void professionalsQuery.refetch()}
        />
      </section>

      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) resetForm();
        }}
      >
        <SheetContent className="overflow-y-auto sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>{editingProfessional ? '他職種を編集' : '他職種を登録'}</SheetTitle>
            <SheetDescription>
              患者ケアチーム、報告書送付、連絡先プロファイルで再利用する他職種情報を更新します。
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            {facilitiesQuery.isError ? (
              <Alert variant="destructive" role="alert">
                <AlertTitle>施設候補を取得できませんでした</AlertTitle>
                <AlertDescription>
                  所属施設の選択だけ利用できません。氏名や連絡先の保存内容は保持されます。
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="external-professional-name">氏名</Label>
                <Input
                  id="external-professional-name"
                  className="!h-11 !min-h-[44px]"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="external-professional-type">職種</Label>
                <Select
                  value={form.profession_type}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      profession_type: value as ProfessionType,
                    }))
                  }
                >
                  <SelectTrigger id="external-professional-type" className="!h-11 !min-h-[44px]">
                    <SelectValue placeholder="職種" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROFESSION_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="external-professional-facility">所属施設</Label>
                <Select
                  value={form.facility_id}
                  disabled={facilitiesQuery.isError}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      facility_id: value || NONE_VALUE,
                    }))
                  }
                >
                  <SelectTrigger
                    id="external-professional-facility"
                    className="!h-11 !min-h-[44px]"
                  >
                    <SelectValue placeholder="施設を選択" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>施設未紐づけ</SelectItem>
                    {facilityOptions.map((facility) => (
                      <SelectItem key={facility.id} value={facility.id}>
                        {facility.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="external-professional-organization">所属名</Label>
                <Input
                  id="external-professional-organization"
                  className="!h-11 !min-h-[44px]"
                  value={form.organization_name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      organization_name: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="external-professional-department">部署</Label>
                <Input
                  id="external-professional-department"
                  className="!h-11 !min-h-[44px]"
                  value={form.department}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, department: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="external-professional-phone">電話番号</Label>
                <Input
                  id="external-professional-phone"
                  className="!h-11 !min-h-[44px]"
                  value={form.phone}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, phone: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="external-professional-fax">FAX</Label>
                <Input
                  id="external-professional-fax"
                  className="!h-11 !min-h-[44px]"
                  value={form.fax}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, fax: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="external-professional-email">メール</Label>
                <Input
                  id="external-professional-email"
                  type="email"
                  className="!h-11 !min-h-[44px]"
                  value={form.email}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, email: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="external-professional-method">優先連絡方法</Label>
                <Select
                  value={form.preferred_contact_method}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      preferred_contact_method: value as FormState['preferred_contact_method'],
                    }))
                  }
                >
                  <SelectTrigger id="external-professional-method" className="!h-11 !min-h-[44px]">
                    <SelectValue placeholder="優先連絡方法" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>未設定</SelectItem>
                    {CONTACT_METHODS.map((method) => (
                      <SelectItem key={method.value} value={method.value}>
                        {method.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="external-professional-contact-time">連絡しやすい時間</Label>
                <Input
                  id="external-professional-contact-time"
                  className="!h-11 !min-h-[44px]"
                  value={form.preferred_contact_time}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      preferred_contact_time: event.target.value,
                    }))
                  }
                  placeholder="例: 平日13時以降"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="external-professional-address">住所</Label>
                <Input
                  id="external-professional-address"
                  className="!h-11 !min-h-[44px]"
                  value={form.address}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, address: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="external-professional-notes">備考</Label>
                <Textarea
                  id="external-professional-notes"
                  rows={4}
                  value={form.notes}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, notes: event.target.value }))
                  }
                />
              </div>
            </div>

            {formBlocker ? (
              <Alert variant="destructive" role="alert">
                <AlertTitle>保存前に確認してください</AlertTitle>
                <AlertDescription>{formBlocker}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="!h-11 !min-h-[44px]"
                onClick={() => setSheetOpen(false)}
              >
                キャンセル
              </Button>
              <Button
                type="button"
                className="!h-11 !min-h-[44px]"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || Boolean(formBlocker)}
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
