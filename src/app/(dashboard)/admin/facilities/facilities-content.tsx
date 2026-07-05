'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Trash2 } from 'lucide-react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SkeletonRows } from '@/components/ui/loading';
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
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { messageFromError } from '@/lib/utils/error-message';
import {
  ADMIN_FACILITIES_API_PATH,
  buildAdminFacilitiesApiPath,
  buildAdminFacilityApiPath,
  buildAdminFacilityUnitApiPath,
  buildAdminFacilityUnitsApiPath,
} from '@/lib/facilities/api-paths';

type FacilityType =
  | 'nursing_home'
  | 'group_home'
  | 'assisted_living'
  | 'clinic'
  | 'hospital'
  | 'day_service'
  | 'home'
  | 'other';

export type FacilityContact = {
  id?: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  fax: string | null;
  is_primary: boolean;
  notes: string | null;
};

export type Facility = {
  id: string;
  name: string;
  facility_type: FacilityType;
  address: string | null;
  phone: string | null;
  fax: string | null;
  acceptance_time_from: string | null;
  acceptance_time_to: string | null;
  regular_visit_weekdays: number[];
  notes: string | null;
  patient_count: number;
  contacts: FacilityContact[];
  updated_at?: string;
};

type FacilitiesResponse = {
  data: Facility[];
  total_count?: number;
  visible_count?: number;
  hidden_count?: number;
  truncated?: boolean;
};

export type FacilityUnit = {
  id: string;
  name: string;
  floor: string | null;
  unit_type: 'floor' | 'wing' | 'unit';
  capacity: number | null;
  notes: string | null;
  display_order: number;
  patient_count: number;
};

type FacilityUnitsResponse = {
  data: FacilityUnit[];
};

type ContactForm = {
  id?: string;
  name: string;
  role: string;
  phone: string;
  email: string;
  fax: string;
  is_primary: boolean;
  notes: string;
};

type FacilityForm = {
  name: string;
  facility_type: FacilityType;
  address: string;
  phone: string;
  fax: string;
  acceptance_time_from: string;
  acceptance_time_to: string;
  regular_visit_weekdays: number[];
  notes: string;
  contacts: ContactForm[];
};

type FacilityFormInput = Partial<Omit<FacilityForm, 'contacts' | 'regular_visit_weekdays'>> & {
  regular_visit_weekdays?: number[] | null;
  contacts?: Array<Partial<ContactForm> | null | undefined> | null;
};

type UnitForm = {
  name: string;
  floor: string;
  unit_type: FacilityUnit['unit_type'];
  capacity: string;
  notes: string;
  display_order: string;
};

const FACILITY_TYPES: Array<{ value: FacilityType; label: string }> = [
  { value: 'nursing_home', label: '介護施設' },
  { value: 'group_home', label: 'グループホーム' },
  { value: 'assisted_living', label: 'サ高住' },
  { value: 'clinic', label: '診療所' },
  { value: 'hospital', label: '病院' },
  { value: 'day_service', label: '通所サービス' },
  { value: 'home', label: '居宅' },
  { value: 'other', label: 'その他' },
];

const WEEKDAYS = [
  { value: 0, label: '日' },
  { value: 1, label: '月' },
  { value: 2, label: '火' },
  { value: 3, label: '水' },
  { value: 4, label: '木' },
  { value: 5, label: '金' },
  { value: 6, label: '土' },
] as const;

const EMPTY_FACILITIES: Facility[] = [];
const EMPTY_UNITS: FacilityUnit[] = [];

const UNIT_TYPES: Array<{ value: FacilityUnit['unit_type']; label: string }> = [
  { value: 'unit', label: 'ユニット' },
  { value: 'floor', label: 'フロア' },
  { value: 'wing', label: '棟' },
];

function createEmptyForm(): FacilityForm {
  return {
    name: '',
    facility_type: 'nursing_home',
    address: '',
    phone: '',
    fax: '',
    acceptance_time_from: '',
    acceptance_time_to: '',
    regular_visit_weekdays: [],
    notes: '',
    contacts: [],
  };
}

function createEmptyContact(): ContactForm {
  return {
    name: '',
    role: '',
    phone: '',
    email: '',
    fax: '',
    is_primary: false,
    notes: '',
  };
}

function normalizeContactForm(contact?: Partial<ContactForm> | null): ContactForm {
  return {
    ...createEmptyContact(),
    ...contact,
    id: contact?.id,
    name: contact?.name ?? '',
    role: contact?.role ?? '',
    phone: contact?.phone ?? '',
    email: contact?.email ?? '',
    fax: contact?.fax ?? '',
    is_primary: contact?.is_primary ?? false,
    notes: contact?.notes ?? '',
  };
}

function normalizeFacilityForm(form?: FacilityFormInput | null): FacilityForm {
  const base = createEmptyForm();
  return {
    name: form?.name ?? base.name,
    facility_type: form?.facility_type ?? base.facility_type,
    address: form?.address ?? base.address,
    phone: form?.phone ?? base.phone,
    fax: form?.fax ?? base.fax,
    acceptance_time_from: form?.acceptance_time_from ?? base.acceptance_time_from,
    acceptance_time_to: form?.acceptance_time_to ?? base.acceptance_time_to,
    regular_visit_weekdays: form?.regular_visit_weekdays ?? [],
    notes: form?.notes ?? base.notes,
    contacts: (form?.contacts ?? []).map(normalizeContactForm),
  };
}

function createEmptyUnitForm(): UnitForm {
  return {
    name: '',
    floor: '',
    unit_type: 'unit',
    capacity: '',
    notes: '',
    display_order: '0',
  };
}

function toForm(facility: Facility): FacilityForm {
  return {
    name: facility.name,
    facility_type: facility.facility_type,
    address: facility.address ?? '',
    phone: facility.phone ?? '',
    fax: facility.fax ?? '',
    acceptance_time_from: facility.acceptance_time_from ?? '',
    acceptance_time_to: facility.acceptance_time_to ?? '',
    regular_visit_weekdays: [...facility.regular_visit_weekdays],
    notes: facility.notes ?? '',
    contacts: facility.contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      role: contact.role ?? '',
      phone: contact.phone ?? '',
      email: contact.email ?? '',
      fax: contact.fax ?? '',
      is_primary: contact.is_primary,
      notes: contact.notes ?? '',
    })),
  };
}

function toUnitForm(unit: FacilityUnit): UnitForm {
  return {
    name: unit.name,
    floor: unit.floor ?? '',
    unit_type: unit.unit_type,
    capacity: unit.capacity == null ? '' : String(unit.capacity),
    notes: unit.notes ?? '',
    display_order: String(unit.display_order),
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

function parseOptionalInteger(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function contactHasInput(contact: ContactForm) {
  return Boolean(
    contact.name.trim() ||
    contact.role.trim() ||
    contact.phone.trim() ||
    contact.email.trim() ||
    contact.fax.trim() ||
    contact.notes.trim() ||
    contact.is_primary,
  );
}

function normalizeContacts(contacts: ContactForm[]) {
  return contacts.filter(contactHasInput).map((contact) => ({
    id: contact.id,
    name: contact.name.trim(),
    role: trimOrUndefined(contact.role),
    phone: trimOrUndefined(contact.phone),
    email: trimOrUndefined(contact.email),
    fax: trimOrUndefined(contact.fax),
    is_primary: contact.is_primary,
    notes: trimOrUndefined(contact.notes),
  }));
}

function getFacilityTypeLabel(type: FacilityType) {
  return FACILITY_TYPES.find((item) => item.value === type)?.label ?? type;
}

function getWeekdayLabel(values: number[]) {
  if (values.length === 0) return '曜日未設定';
  const labels = WEEKDAYS.filter((weekday) => values.includes(weekday.value)).map(
    (weekday) => weekday.label,
  );
  return labels.join('・');
}

function getFormBlocker(form: FacilityForm, editingFacility: Facility | null) {
  if (!form.name.trim()) return '施設名は必須です。';
  const incompleteContact = form.contacts.find(
    (contact) => contactHasInput(contact) && !contact.name.trim(),
  );
  if (incompleteContact) return '担当者を登録する場合は担当者名を入力してください。';
  if (editingFacility && !editingFacility.updated_at) {
    return '版情報を取得できませんでした。再読み込みしてから保存してください。';
  }
  return null;
}

function getUnitFormBlocker(form: UnitForm | null) {
  if (!form) return null;
  if (!form.name.trim()) return 'ユニット名は必須です。';
  if (form.capacity.trim() && parseOptionalInteger(form.capacity) === undefined) {
    return '定員は整数で入力してください。';
  }
  if (form.display_order.trim() && parseOptionalInteger(form.display_order) === undefined) {
    return '表示順は整数で入力してください。';
  }
  return null;
}

function buildCreatePayload(form: FacilityForm) {
  return {
    name: form.name.trim(),
    facility_type: form.facility_type,
    address: trimOrUndefined(form.address),
    phone: trimOrUndefined(form.phone),
    fax: trimOrUndefined(form.fax),
    acceptance_time_from: trimOrUndefined(form.acceptance_time_from),
    acceptance_time_to: trimOrUndefined(form.acceptance_time_to),
    regular_visit_weekdays: [...form.regular_visit_weekdays].sort((a, b) => a - b),
    notes: trimOrUndefined(form.notes),
    contacts: normalizeContacts(form.contacts),
  };
}

function buildUpdatePayload(form: FacilityForm, facility: Facility) {
  return {
    expected_updated_at: facility.updated_at,
    name: form.name.trim(),
    facility_type: form.facility_type,
    address: trimOrNull(form.address),
    phone: trimOrNull(form.phone),
    fax: trimOrNull(form.fax),
    acceptance_time_from: trimOrNull(form.acceptance_time_from),
    acceptance_time_to: trimOrNull(form.acceptance_time_to),
    regular_visit_weekdays: [...form.regular_visit_weekdays].sort((a, b) => a - b),
    notes: trimOrNull(form.notes),
    contacts: normalizeContacts(form.contacts),
  };
}

function buildCreateUnitPayload(form: UnitForm) {
  return {
    name: form.name.trim(),
    floor: trimOrUndefined(form.floor),
    unit_type: form.unit_type,
    capacity: parseOptionalInteger(form.capacity),
    notes: trimOrUndefined(form.notes),
    display_order: parseOptionalInteger(form.display_order) ?? 0,
  };
}

function buildUpdateUnitPayload(form: UnitForm) {
  return {
    name: form.name.trim(),
    floor: trimOrNull(form.floor),
    unit_type: form.unit_type,
    capacity: form.capacity.trim() ? parseOptionalInteger(form.capacity) : null,
    notes: trimOrNull(form.notes),
    display_order: parseOptionalInteger(form.display_order) ?? 0,
  };
}

function matchesFacilityQuery(facility: Facility, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const haystack = [
    facility.name,
    getFacilityTypeLabel(facility.facility_type),
    facility.address ?? '',
    facility.phone ?? '',
    facility.fax ?? '',
    ...facility.contacts.flatMap((contact) => [
      contact.name,
      contact.role ?? '',
      contact.phone ?? '',
      contact.email ?? '',
      contact.fax ?? '',
    ]),
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(normalized);
}

export function FacilitiesContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingFacility, setEditingFacility] = useState<Facility | null>(null);
  const {
    control: facilityFormControl,
    register: registerFacilityField,
    getValues: getFacilityFormValues,
    reset: resetFacilityForm,
    setValue: setFacilityFormValue,
  } = useForm<FacilityForm>({
    defaultValues: createEmptyForm(),
  });
  const watchedFacilityForm = useWatch({
    control: facilityFormControl,
    defaultValue: createEmptyForm(),
  });
  const [deleteTarget, setDeleteTarget] = useState<Facility | null>(null);
  const [unitForm, setUnitForm] = useState<UnitForm | null>(null);
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [unitDeleteTarget, setUnitDeleteTarget] = useState<FacilityUnit | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-facilities', orgId],
    queryFn: async () => {
      const response = await fetch(buildAdminFacilitiesApiPath(new URLSearchParams()), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<FacilitiesResponse>(response, '施設マスターの取得に失敗しました');
    },
    enabled: !!orgId,
  });

  const facilities = data?.data ?? EMPTY_FACILITIES;
  const unitsQuery = useQuery({
    queryKey: ['admin-facility-units', orgId, editingFacility?.id],
    queryFn: async () => {
      if (!editingFacility) throw new Error('施設が選択されていません');
      const response = await fetch(buildAdminFacilityUnitsApiPath(editingFacility.id), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<FacilityUnitsResponse>(response, '施設ユニットの取得に失敗しました');
    },
    enabled: !!orgId && !!editingFacility && sheetOpen,
  });
  const units = unitsQuery.data?.data ?? EMPTY_UNITS;
  const filteredFacilities = useMemo(
    () => facilities.filter((facility) => matchesFacilityQuery(facility, query)),
    [facilities, query],
  );
  const form = normalizeFacilityForm(watchedFacilityForm);
  const formBlocker = getFormBlocker(form, editingFacility);
  const unitFormBlocker = getUnitFormBlocker(unitForm);
  const totalCount = data?.total_count ?? facilities.length;
  const hiddenCount = data?.hidden_count ?? 0;

  function getCurrentFacilityForm() {
    return normalizeFacilityForm(getFacilityFormValues());
  }

  function setFacilityContacts(contacts: ContactForm[]) {
    setFacilityFormValue('contacts', contacts, { shouldDirty: true });
  }

  function resetForm() {
    setEditingFacility(null);
    resetFacilityForm(createEmptyForm());
    setUnitForm(null);
    setEditingUnitId(null);
    setUnitDeleteTarget(null);
  }

  function openCreate() {
    resetForm();
    setSheetOpen(true);
  }

  function openEdit(facility: Facility) {
    setEditingFacility(facility);
    resetFacilityForm(toForm(facility));
    setUnitForm(null);
    setEditingUnitId(null);
    setSheetOpen(true);
  }

  function updateContact(index: number, next: Partial<ContactForm>) {
    const contacts = getFacilityFormValues('contacts') ?? [];
    setFacilityContacts(
      contacts.map((contact, contactIndex) =>
        contactIndex === index ? { ...contact, ...next } : contact,
      ),
    );
  }

  function toggleWeekday(value: number, checked: boolean) {
    const weekdays = getFacilityFormValues('regular_visit_weekdays') ?? [];
    const nextValues = checked
      ? Array.from(new Set([...weekdays, value]))
      : weekdays.filter((weekday) => weekday !== value);
    setFacilityFormValue(
      'regular_visit_weekdays',
      nextValues.sort((a, b) => a - b),
      {
        shouldDirty: true,
      },
    );
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const currentForm = getCurrentFacilityForm();
      const blocker = getFormBlocker(currentForm, editingFacility);
      if (blocker) throw new Error(blocker);
      const endpoint = editingFacility
        ? buildAdminFacilityApiPath(editingFacility.id)
        : ADMIN_FACILITIES_API_PATH;
      const method = editingFacility ? 'PATCH' : 'POST';
      const response = await fetch(endpoint, {
        method,
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify(
          editingFacility
            ? buildUpdatePayload(currentForm, editingFacility)
            : buildCreatePayload(currentForm),
        ),
      });
      return readApiJson<unknown>(response, '保存に失敗しました');
    },
    onSuccess: async () => {
      toast.success(editingFacility ? '施設マスターを更新しました' : '施設を登録しました');
      setSheetOpen(false);
      resetForm();
      await queryClient.invalidateQueries({ queryKey: ['admin-facilities', orgId] });
    },
    onError: async (error) => {
      toast.error(messageFromError(error, '保存に失敗しました'));
      if (error instanceof Error && error.message.includes('更新されています')) {
        await queryClient.invalidateQueries({ queryKey: ['admin-facilities', orgId] });
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (facilityId: string) => {
      const response = await fetch(buildAdminFacilityApiPath(facilityId), {
        method: 'DELETE',
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<unknown>(response, '削除に失敗しました');
    },
    onSuccess: async () => {
      toast.success('施設マスターを削除しました');
      await queryClient.invalidateQueries({ queryKey: ['admin-facilities', orgId] });
    },
    onError: (error) => {
      toast.error(messageFromError(error, '削除に失敗しました'));
    },
  });

  const saveUnitMutation = useMutation({
    mutationFn: async () => {
      if (!editingFacility || !unitForm) throw new Error('施設とユニットを選択してください');
      const blocker = getUnitFormBlocker(unitForm);
      if (blocker) throw new Error(blocker);
      const endpoint = editingUnitId
        ? buildAdminFacilityUnitApiPath(editingFacility.id, editingUnitId)
        : buildAdminFacilityUnitsApiPath(editingFacility.id);
      const method = editingUnitId ? 'PATCH' : 'POST';
      const response = await fetch(endpoint, {
        method,
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify(
          editingUnitId ? buildUpdateUnitPayload(unitForm) : buildCreateUnitPayload(unitForm),
        ),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? 'ユニット保存に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success(editingUnitId ? 'ユニットを更新しました' : 'ユニットを登録しました');
      setUnitForm(null);
      setEditingUnitId(null);
      await queryClient.invalidateQueries({
        queryKey: ['admin-facility-units', orgId, editingFacility?.id],
      });
    },
    onError: (error) => {
      toast.error(messageFromError(error, 'ユニット保存に失敗しました'));
    },
  });

  const deleteUnitMutation = useMutation({
    mutationFn: async (unitId: string) => {
      if (!editingFacility) throw new Error('施設が選択されていません');
      const response = await fetch(buildAdminFacilityUnitApiPath(editingFacility.id, unitId), {
        method: 'DELETE',
        headers: buildOrgHeaders(orgId),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? 'ユニット削除に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success('ユニットを削除しました');
      setUnitDeleteTarget(null);
      await queryClient.invalidateQueries({
        queryKey: ['admin-facility-units', orgId, editingFacility?.id],
      });
    },
    onError: (error) => {
      toast.error(messageFromError(error, 'ユニット削除に失敗しました'));
    },
  });

  const columns: ColumnDef<Facility>[] = [
    {
      accessorKey: 'name',
      header: '施設',
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="font-medium text-foreground">{row.original.name}</p>
          <p className="text-xs leading-5 text-muted-foreground">
            {row.original.address || '住所未設定'}
          </p>
        </div>
      ),
    },
    {
      accessorKey: 'facility_type',
      header: '種別',
      cell: ({ row }) => (
        <StateBadge role="readonly">{getFacilityTypeLabel(row.original.facility_type)}</StateBadge>
      ),
    },
    {
      accessorKey: 'patient_count',
      header: '患者',
      cell: ({ row }) => (
        <div className="space-y-1">
          <p className="text-sm font-medium tabular-nums">{row.original.patient_count}名</p>
          {row.original.patient_count > 0 ? (
            <p className="text-xs text-muted-foreground">削除前に患者居宅の変更が必要</p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'visit-window',
      header: '訪問条件',
      cell: ({ row }) => (
        <div className="space-y-1 text-sm">
          <p>
            {row.original.acceptance_time_from || '--:--'} -{' '}
            {row.original.acceptance_time_to || '--:--'}
          </p>
          <p className="text-xs text-muted-foreground">
            {getWeekdayLabel(row.original.regular_visit_weekdays)}
          </p>
        </div>
      ),
    },
    {
      id: 'primary-contact',
      header: '主担当',
      cell: ({ row }) => {
        const primary = row.original.contacts.find((contact) => contact.is_primary);
        const fallback = row.original.contacts[0];
        const contact = primary ?? fallback;
        if (!contact) return <span className="text-sm text-muted-foreground">担当者未設定</span>;
        return (
          <div className="space-y-1">
            <p className="text-sm font-medium">{contact.name}</p>
            <p className="text-xs text-muted-foreground">
              {[contact.role, contact.phone, contact.email].filter(Boolean).join(' / ') ||
                '連絡先未設定'}
            </p>
          </div>
        );
      },
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
        title="施設マスターを削除しますか？"
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
      <ConfirmDialog
        open={unitDeleteTarget != null}
        onOpenChange={(open) => {
          if (!open) setUnitDeleteTarget(null);
        }}
        title="ユニットを削除しますか？"
        description={
          unitDeleteTarget
            ? `${unitDeleteTarget.name} を削除します。患者が在籍中の場合は削除できません。`
            : ''
        }
        variant="destructive"
        confirmLabel="削除する"
        onConfirm={() => {
          if (!unitDeleteTarget) return;
          deleteUnitMutation.mutate(unitDeleteTarget.id);
        }}
      />

      <section className="space-y-4" data-testid="facility-master-content">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">施設一覧</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              患者居宅・訪問条件・施設担当者を同じ正本として更新します。
            </p>
          </div>
          <Button className="!h-11 !min-h-[44px]" type="button" onClick={openCreate}>
            <Plus aria-hidden className="mr-2 h-4 w-4" />
            新規登録
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(240px,360px)_1fr] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="facility-search">検索</Label>
            <Input
              id="facility-search"
              className="!h-11 !min-h-[44px]"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="施設名 / 住所 / 担当者"
            />
          </div>
          <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
            <StateBadge role="readonly">登録 {totalCount}件</StateBadge>
            <StateBadge role={hiddenCount > 0 ? 'confirm' : 'done'}>
              表示 {filteredFacilities.length}件
            </StateBadge>
            {hiddenCount > 0 || data?.truncated ? (
              <StateBadge role="confirm">非表示 {hiddenCount}件</StateBadge>
            ) : null}
          </div>
        </div>

        {isError || !orgId ? (
          <Alert variant="destructive" role="alert">
            <AlertTitle>施設マスターを取得できませんでした</AlertTitle>
            <AlertDescription>
              権限または通信状態を確認して再読み込みしてください。空の施設一覧として扱いません。
            </AlertDescription>
          </Alert>
        ) : null}

        <DataTable
          columns={columns}
          data={filteredFacilities}
          isLoading={isLoading}
          errorMessage={isError || !orgId ? '施設マスター一覧を取得できませんでした' : undefined}
          emptyMessage={
            query.trim() ? '検索条件に一致する施設はありません' : '施設はまだ登録されていません'
          }
          onRetry={() => void refetch()}
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
            <SheetTitle>{editingFacility ? '施設を編集' : '施設を登録'}</SheetTitle>
            <SheetDescription>
              患者訪問・施設連携・連絡先プロファイルの参照元になる施設マスターを更新します。
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            {editingFacility?.updated_at ? (
              <Alert>
                <AlertTitle>版情報を確認して保存します</AlertTitle>
                <AlertDescription>
                  保存時に表示中の版 {editingFacility.updated_at} とDBの最新版を照合します。
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="facility-name">施設名</Label>
                <Input id="facility-name" {...registerFacilityField('name')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="facility-type">施設種別</Label>
                <Controller
                  control={facilityFormControl}
                  name="facility_type"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="facility-type" className="!h-11 !min-h-[44px]">
                        <SelectValue placeholder="施設種別" />
                      </SelectTrigger>
                      <SelectContent>
                        {FACILITY_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="facility-address">住所</Label>
                <Input id="facility-address" {...registerFacilityField('address')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="facility-phone">電話番号</Label>
                <Input id="facility-phone" {...registerFacilityField('phone')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="facility-fax">FAX</Label>
                <Input id="facility-fax" {...registerFacilityField('fax')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="facility-time-from">受入開始</Label>
                <Input
                  id="facility-time-from"
                  type="time"
                  className="!h-11 !min-h-[44px]"
                  {...registerFacilityField('acceptance_time_from')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="facility-time-to">受入終了</Label>
                <Input
                  id="facility-time-to"
                  type="time"
                  className="!h-11 !min-h-[44px]"
                  {...registerFacilityField('acceptance_time_to')}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <p className="text-sm font-medium text-foreground">定期訪問曜日</p>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map((weekday) => (
                    <Label
                      key={weekday.value}
                      className="flex min-h-[44px] items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
                    >
                      <Checkbox
                        checked={form.regular_visit_weekdays.includes(weekday.value)}
                        onCheckedChange={(checked) =>
                          toggleWeekday(weekday.value, Boolean(checked))
                        }
                      />
                      {weekday.label}
                    </Label>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="facility-notes">備考</Label>
                <Textarea id="facility-notes" rows={4} {...registerFacilityField('notes')} />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">施設担当者</h3>
                  <p className="text-sm text-muted-foreground">
                    主担当・電話・FAX・メールを訪問連絡の正本として管理します。
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="!h-11 !min-h-[44px]"
                  onClick={() =>
                    setFacilityContacts([
                      ...(getFacilityFormValues('contacts') ?? []),
                      createEmptyContact(),
                    ])
                  }
                >
                  <Plus aria-hidden className="mr-2 h-4 w-4" />
                  担当者を追加
                </Button>
              </div>

              {form.contacts.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  施設担当者は未登録です。必要な場合は担当者を追加してください。
                </p>
              ) : (
                <div className="space-y-3">
                  {form.contacts.map((contact, index) => (
                    <div
                      key={contact.id ?? index}
                      className="space-y-3 rounded-lg border border-border/70 p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <Label className="flex min-h-[44px] items-center gap-2 text-sm">
                          <Checkbox
                            checked={contact.is_primary}
                            onCheckedChange={(checked) =>
                              updateContact(index, { is_primary: Boolean(checked) })
                            }
                          />
                          主担当
                        </Label>
                        <Button
                          type="button"
                          variant="ghost"
                          className="!h-11 !min-h-[44px] !w-11 px-0"
                          aria-label={`担当者${index + 1}を削除`}
                          onClick={() =>
                            setFacilityContacts(
                              (getFacilityFormValues('contacts') ?? []).filter(
                                (_contact, contactIndex) => contactIndex !== index,
                              ),
                            )
                          }
                        >
                          <Trash2 aria-hidden className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor={`facility-contact-name-${index}`}>担当者名</Label>
                          <Input
                            id={`facility-contact-name-${index}`}
                            value={contact.name}
                            onChange={(event) => updateContact(index, { name: event.target.value })}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`facility-contact-role-${index}`}>役割</Label>
                          <Input
                            id={`facility-contact-role-${index}`}
                            value={contact.role}
                            onChange={(event) => updateContact(index, { role: event.target.value })}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`facility-contact-phone-${index}`}>電話番号</Label>
                          <Input
                            id={`facility-contact-phone-${index}`}
                            value={contact.phone}
                            onChange={(event) =>
                              updateContact(index, { phone: event.target.value })
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`facility-contact-fax-${index}`}>FAX</Label>
                          <Input
                            id={`facility-contact-fax-${index}`}
                            value={contact.fax}
                            onChange={(event) => updateContact(index, { fax: event.target.value })}
                          />
                        </div>
                        <div className="space-y-1.5 md:col-span-2">
                          <Label htmlFor={`facility-contact-email-${index}`}>メール</Label>
                          <Input
                            id={`facility-contact-email-${index}`}
                            type="email"
                            value={contact.email}
                            onChange={(event) =>
                              updateContact(index, { email: event.target.value })
                            }
                          />
                        </div>
                        <div className="space-y-1.5 md:col-span-2">
                          <Label htmlFor={`facility-contact-notes-${index}`}>担当者メモ</Label>
                          <Textarea
                            id={`facility-contact-notes-${index}`}
                            rows={2}
                            value={contact.notes}
                            onChange={(event) =>
                              updateContact(index, { notes: event.target.value })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">ユニット・フロア</h3>
                  <p className="text-sm text-muted-foreground">
                    患者居宅のユニットIDに使うフロア・棟・ユニットを管理します。
                  </p>
                </div>
                {editingFacility ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="!h-11 !min-h-[44px]"
                    onClick={() => {
                      setEditingUnitId(null);
                      setUnitForm(createEmptyUnitForm());
                    }}
                  >
                    <Plus aria-hidden className="mr-2 h-4 w-4" />
                    ユニットを追加
                  </Button>
                ) : null}
              </div>

              {!editingFacility ? (
                <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  ユニットは施設登録後に追加できます。
                </p>
              ) : unitsQuery.isError ? (
                <Alert variant="destructive" role="alert">
                  <AlertTitle>ユニットを取得できませんでした</AlertTitle>
                  <AlertDescription>
                    施設の保存内容は保持したまま、ユニット一覧だけ再読み込みしてください。
                  </AlertDescription>
                </Alert>
              ) : unitsQuery.isLoading ? (
                <div
                  role="status"
                  aria-label="施設ユニットを読み込み中"
                  className="rounded-lg border border-dashed border-border p-4"
                >
                  <SkeletonRows rows={2} cols={1} status={false} />
                </div>
              ) : units.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  ユニットは未登録です。施設内で訪問順や居室管理を分ける場合に追加してください。
                </p>
              ) : (
                <div className="space-y-2">
                  {units.map((unit) => (
                    <div
                      key={unit.id}
                      className="flex flex-col gap-3 rounded-lg border border-border/70 p-3 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-foreground">{unit.name}</p>
                          <StateBadge role="readonly">
                            {UNIT_TYPES.find((type) => type.value === unit.unit_type)?.label ??
                              unit.unit_type}
                          </StateBadge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {[unit.floor, unit.capacity == null ? null : `定員${unit.capacity}名`]
                            .filter(Boolean)
                            .join(' / ') || '階・定員未設定'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          入居患者 {unit.patient_count}名 / 表示順 {unit.display_order}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="!h-11 !min-h-[44px]"
                          aria-label={`${unit.name}を編集`}
                          onClick={() => {
                            setEditingUnitId(unit.id);
                            setUnitForm(toUnitForm(unit));
                          }}
                        >
                          編集
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="!h-11 !min-h-[44px]"
                          aria-label={`${unit.name}を削除`}
                          disabled={unit.patient_count > 0 || deleteUnitMutation.isPending}
                          onClick={() => setUnitDeleteTarget(unit)}
                        >
                          削除
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {unitForm ? (
                <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="facility-unit-name">ユニット名</Label>
                      <Input
                        id="facility-unit-name"
                        value={unitForm.name}
                        onChange={(event) =>
                          setUnitForm((current) =>
                            current ? { ...current, name: event.target.value } : current,
                          )
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="facility-unit-type">ユニット種別</Label>
                      <Select
                        value={unitForm.unit_type}
                        onValueChange={(value) =>
                          setUnitForm((current) =>
                            current
                              ? { ...current, unit_type: value as FacilityUnit['unit_type'] }
                              : current,
                          )
                        }
                      >
                        <SelectTrigger id="facility-unit-type" className="!h-11 !min-h-[44px]">
                          <SelectValue placeholder="ユニット種別" />
                        </SelectTrigger>
                        <SelectContent>
                          {UNIT_TYPES.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="facility-unit-floor">階・棟</Label>
                      <Input
                        id="facility-unit-floor"
                        value={unitForm.floor}
                        onChange={(event) =>
                          setUnitForm((current) =>
                            current ? { ...current, floor: event.target.value } : current,
                          )
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="facility-unit-capacity">定員</Label>
                      <Input
                        id="facility-unit-capacity"
                        type="number"
                        min={0}
                        value={unitForm.capacity}
                        onChange={(event) =>
                          setUnitForm((current) =>
                            current ? { ...current, capacity: event.target.value } : current,
                          )
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="facility-unit-display-order">表示順</Label>
                      <Input
                        id="facility-unit-display-order"
                        type="number"
                        min={0}
                        value={unitForm.display_order}
                        onChange={(event) =>
                          setUnitForm((current) =>
                            current ? { ...current, display_order: event.target.value } : current,
                          )
                        }
                      />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <Label htmlFor="facility-unit-notes">ユニットメモ</Label>
                      <Textarea
                        id="facility-unit-notes"
                        rows={2}
                        value={unitForm.notes}
                        onChange={(event) =>
                          setUnitForm((current) =>
                            current ? { ...current, notes: event.target.value } : current,
                          )
                        }
                      />
                    </div>
                  </div>

                  {unitFormBlocker ? (
                    <p
                      id="facility-unit-save-blocker"
                      className="text-sm text-destructive"
                      role="alert"
                    >
                      {unitFormBlocker}
                    </p>
                  ) : null}

                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="!h-11 !min-h-[44px]"
                      onClick={() => {
                        setUnitForm(null);
                        setEditingUnitId(null);
                      }}
                    >
                      ユニット編集を閉じる
                    </Button>
                    <Button
                      type="button"
                      className="!h-11 !min-h-[44px]"
                      onClick={() => saveUnitMutation.mutate()}
                      disabled={Boolean(unitFormBlocker) || saveUnitMutation.isPending}
                      aria-describedby={unitFormBlocker ? 'facility-unit-save-blocker' : undefined}
                    >
                      {saveUnitMutation.isPending ? '保存中...' : 'ユニットを保存'}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>

            {formBlocker ? (
              <p id="facility-save-blocker" className="text-sm text-destructive" role="alert">
                {formBlocker}
              </p>
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
                disabled={Boolean(formBlocker) || saveMutation.isPending}
                aria-describedby={formBlocker ? 'facility-save-blocker' : undefined}
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
