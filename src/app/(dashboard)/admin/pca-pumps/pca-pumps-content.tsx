'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { messageFromError } from '@/lib/utils/error-message';
import { StateBadge } from '@/components/ui/state-badge';
import type { StatusRole } from '@/lib/constants/status-tokens';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageSection } from '@/components/layout/page-section';
import { DataTable } from '@/components/ui/data-table';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatYen } from '@/lib/ui/currency-format';
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
import { formatDateKey } from '@/lib/date-key';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import {
  buildPcaPumpApiPath,
  buildPcaPumpRentalApiPath,
  buildPcaPumpRentalsApiPath,
  buildPcaPumpsApiPath,
} from '@/lib/pca-pumps/api-paths';
import { PRESCRIBER_INSTITUTIONS_API_PATH } from '@/lib/prescriber-institutions/api-paths';
import { isValidDateKey } from '@/lib/validations/date-key';

type PcaPumpStatus = 'available' | 'rented' | 'maintenance' | 'retired';
type PcaPumpRentalStatus = 'scheduled' | 'active' | 'overdue' | 'returned' | 'cancelled';
type PcaPumpReturnInspectionStatus = 'pending' | 'passed' | 'needs_maintenance';
type PcaPumpAccessoryStatus = 'unchecked' | 'ok' | 'missing' | 'damaged' | 'not_applicable';
type PcaPumpAccessoryKey =
  | 'pump_body'
  | 'power_adapter'
  | 'power_cable'
  | 'carrying_case'
  | 'manual'
  | 'lock_key'
  | 'clamp'
  | 'cleaning_completed'
  | 'operation_check';

type PcaPumpAccessoryChecklistItem = {
  status: PcaPumpAccessoryStatus;
  notes: string;
};

type PcaPumpAccessoryChecklistState = Record<PcaPumpAccessoryKey, PcaPumpAccessoryChecklistItem>;
type PcaPumpMaintenanceEventType =
  | 'manual_status_change'
  | 'return_inspection'
  | 'maintenance_completed'
  | 'repair_required';
type PcaPumpMaintenanceResult = 'available' | 'maintenance_continues' | 'retired';

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
  maintenance_events: Array<{
    id: string;
    event_type: PcaPumpMaintenanceEventType;
    result: PcaPumpMaintenanceResult;
    performed_at: string;
    performed_by: string | null;
    notes: string | null;
    next_maintenance_due_at: string | null;
  }>;
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
  return_inspection_status: PcaPumpReturnInspectionStatus | null;
  return_inspection_notes: string | null;
  accessory_checklist: unknown;
  inspected_at: string | null;
  inspected_by: string | null;
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

type RentalFormErrorKey = 'pump_id' | 'institution_id' | 'rented_at' | 'due_at' | 'rental_fee_yen';
type RentalFormErrors = Partial<Record<RentalFormErrorKey, string>>;

type ReturnInspectionFormState = {
  rental: PcaPumpRental | null;
  notes: string;
  checklist: PcaPumpAccessoryChecklistState;
};

type MaintenanceCompletionFormState = {
  pump: PcaPump | null;
  notes: string;
  next_maintenance_due_at: string;
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

const ACCESSORY_STATUS_LABELS: Record<PcaPumpAccessoryStatus, string> = {
  unchecked: '未確認',
  ok: 'OK',
  missing: '不足',
  damaged: '破損',
  not_applicable: '該当なし',
};

const MAINTENANCE_EVENT_LABELS: Record<PcaPumpMaintenanceEventType, string> = {
  manual_status_change: '状態変更',
  return_inspection: '返却検品',
  maintenance_completed: '整備完了',
  repair_required: '要修理',
};

export const PCA_RETURN_INSPECTION_ITEMS: Array<{
  key: PcaPumpAccessoryKey;
  label: string;
}> = [
  { key: 'pump_body', label: 'ポンプ本体' },
  { key: 'power_adapter', label: 'ACアダプタ' },
  { key: 'power_cable', label: '電源コード' },
  { key: 'carrying_case', label: '携行ケース' },
  { key: 'manual', label: '取扱説明書' },
  { key: 'lock_key', label: 'ロックキー' },
  { key: 'clamp', label: 'クランプ/固定具' },
  { key: 'cleaning_completed', label: '清拭完了' },
  { key: 'operation_check', label: '動作確認' },
];

const EMPTY_PUMP_FORM: PumpFormState = {
  asset_code: '',
  serial_number: '',
  model_name: '',
  manufacturer: '',
  status: 'available',
  maintenance_due_at: '',
  notes: '',
};

const RENTAL_SAVE_BLOCKER_ID = 'rental-save-blocker';
const RETURN_INSPECTION_SAVE_BLOCKER_ID = 'return-inspection-save-blocker';
const PLAIN_INTEGER_PATTERN = /^\d+$/;

function todayDateKey() {
  return formatDateKey(new Date());
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

export function createDefaultPcaReturnInspectionChecklist(): PcaPumpAccessoryChecklistState {
  return Object.fromEntries(
    PCA_RETURN_INSPECTION_ITEMS.map((item) => [item.key, { status: 'unchecked', notes: '' }]),
  ) as PcaPumpAccessoryChecklistState;
}

export function getPcaReturnInspectionUncheckedLabels(checklist: PcaPumpAccessoryChecklistState) {
  return PCA_RETURN_INSPECTION_ITEMS.flatMap((item) =>
    checklist[item.key].status === 'unchecked' ? [item.label] : [],
  );
}

export function getPcaReturnInspectionMissingNoteLabels(checklist: PcaPumpAccessoryChecklistState) {
  return PCA_RETURN_INSPECTION_ITEMS.flatMap((item) => {
    const value = checklist[item.key];
    if ((value.status === 'missing' || value.status === 'damaged') && !value.notes.trim()) {
      return [item.label];
    }
    return [];
  });
}

function getReturnInspectionItemStatusError(status: PcaPumpAccessoryStatus) {
  return status === 'unchecked' ? '検品状態を選択してください。' : null;
}

function getReturnInspectionItemNoteError(item: PcaPumpAccessoryChecklistItem) {
  return (item.status === 'missing' || item.status === 'damaged') && !item.notes.trim()
    ? '不足・破損の詳細メモを入力してください。'
    : null;
}

function getReturnInspectionSaveBlocker(form: ReturnInspectionFormState) {
  if (!form.rental) return '検品対象のPCAポンプレンタルが選択されていません';
  const uncheckedLabels = getPcaReturnInspectionUncheckedLabels(form.checklist);
  if (uncheckedLabels.length > 0) {
    return `未確認の検品項目があります: ${uncheckedLabels.join('、')}`;
  }
  const missingNoteLabels = getPcaReturnInspectionMissingNoteLabels(form.checklist);
  if (missingNoteLabels.length > 0) {
    return `不足・破損の詳細メモを入力してください: ${missingNoteLabels.join('、')}`;
  }
  return null;
}

export function buildPcaReturnInspectionPayload(form: {
  notes: string;
  checklist: PcaPumpAccessoryChecklistState;
}) {
  const uncheckedLabels = getPcaReturnInspectionUncheckedLabels(form.checklist);
  if (uncheckedLabels.length > 0) {
    throw new Error(`未確認の検品項目があります: ${uncheckedLabels.join('、')}`);
  }
  const hasBlockingItem = Object.values(form.checklist).some(
    (item) => item.status === 'missing' || item.status === 'damaged',
  );
  return {
    return_inspection_status: hasBlockingItem ? 'needs_maintenance' : 'passed',
    return_inspection_notes: toNullableString(form.notes),
    accessory_checklist: Object.fromEntries(
      PCA_RETURN_INSPECTION_ITEMS.map((item) => {
        const value = form.checklist[item.key];
        return [
          item.key,
          {
            status: value.status as Exclude<PcaPumpAccessoryStatus, 'unchecked'>,
            notes: toNullableString(value.notes),
          },
        ];
      }),
    ),
  };
}

export function buildPcaPumpStatusUpdatePayload(args: {
  currentStatus: PcaPumpStatus;
  nextStatus: PcaPumpStatus;
  maintenanceNotes?: string;
  nextMaintenanceDueAt?: string;
}) {
  if (args.currentStatus === 'maintenance' && args.nextStatus === 'available') {
    return {
      status: args.nextStatus,
      maintenance_event_type: 'maintenance_completed',
      maintenance_result: 'available',
      maintenance_notes: toNullableString(args.maintenanceNotes ?? '') ?? '整備完了（台帳操作）',
      maintenance_due_at: toNullableString(args.nextMaintenanceDueAt ?? ''),
    };
  }

  if (args.nextStatus === 'maintenance') {
    return {
      status: args.nextStatus,
      maintenance_event_type: 'manual_status_change',
      maintenance_result: 'maintenance_continues',
      maintenance_notes: 'メンテナンスへ変更（台帳操作）',
    };
  }

  return { status: args.nextStatus };
}

function emptyReturnInspectionForm(rental: PcaPumpRental | null = null): ReturnInspectionFormState {
  return {
    rental,
    notes: '',
    checklist: createDefaultPcaReturnInspectionChecklist(),
  };
}

function emptyMaintenanceCompletionForm(
  pump: PcaPump | null = null,
): MaintenanceCompletionFormState {
  return {
    pump,
    notes: '',
    next_maintenance_due_at: pump?.maintenance_due_at ?? '',
  };
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const dateKey = value.includes('T') ? value.slice(0, 10) : value;
  return new Date(`${dateKey}T00:00:00+09:00`).toLocaleDateString('ja-JP');
}

// ポンプ/貸出の状態セマンティック:
//   利用可能/返却済=done(緑) / 貸出中・予定=info(進行中) / 延滞・メンテ=confirm(橙, 要対応) /
//   取消=blocked(赤, 止まった理由) / 退役=readonly(灰, 過去/中立)
export function statusRole(status: PcaPumpStatus | PcaPumpRentalStatus): StatusRole {
  if (status === 'available' || status === 'returned') {
    return 'done';
  }
  if (status === 'rented' || status === 'active' || status === 'scheduled') {
    return 'info';
  }
  if (status === 'overdue' || status === 'maintenance') {
    return 'confirm';
  }
  if (status === 'cancelled') {
    return 'blocked';
  }
  return 'readonly';
}

function toNullableString(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNullableInteger(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? Number(trimmed) : null;
}

function descriptionIds(...ids: Array<string | false | null | undefined>) {
  const value = ids.filter(Boolean).join(' ');
  return value || undefined;
}

function getRentalFormErrors(form: RentalFormState): RentalFormErrors {
  const errors: RentalFormErrors = {};
  if (!form.pump_id) errors.pump_id = 'PCAポンプを選択してください。';
  if (!form.institution_id) errors.institution_id = '貸出先医療機関を選択してください。';
  if (!isValidDateKey(form.rented_at)) {
    errors.rented_at = '貸出日はYYYY-MM-DD形式で指定してください。';
  }
  if (!form.due_at) {
    errors.due_at = '貸出中のPCAポンプには返却予定日が必須です。';
  } else if (!isValidDateKey(form.due_at)) {
    errors.due_at = '返却予定日はYYYY-MM-DD形式で指定してください。';
  } else if (isValidDateKey(form.rented_at) && form.due_at < form.rented_at) {
    errors.due_at = '返却予定日は貸出日以降の日付を指定してください。';
  }
  const fee = form.rental_fee_yen.trim();
  if (fee && !PLAIN_INTEGER_PATTERN.test(fee)) {
    errors.rental_fee_yen = '請求予定額は0以上の整数で入力してください。';
  }
  return errors;
}

function getRentalSaveBlocker(errors: RentalFormErrors) {
  return (
    errors.pump_id ??
    errors.institution_id ??
    errors.rented_at ??
    errors.due_at ??
    errors.rental_fee_yen ??
    null
  );
}

function getReturnInspectionActionLabel(rental: PcaPumpRental) {
  return `検品 ${rental.pump.asset_code} ${rental.institution.name} 返却日 ${formatDate(
    rental.returned_at,
  )}`;
}

function yen(value: number | null) {
  return formatYen(value);
}

export function PcaPumpsContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 300);
  const [pumpSheetOpen, setPumpSheetOpen] = useState(false);
  const [rentalSheetOpen, setRentalSheetOpen] = useState(false);
  const [inspectionSheetOpen, setInspectionSheetOpen] = useState(false);
  const [maintenanceSheetOpen, setMaintenanceSheetOpen] = useState(false);
  const [pumpForm, setPumpForm] = useState<PumpFormState>(EMPTY_PUMP_FORM);
  const [rentalForm, setRentalForm] = useState<RentalFormState>(emptyRentalForm());
  const [inspectionForm, setInspectionForm] = useState<ReturnInspectionFormState>(
    emptyReturnInspectionForm(),
  );
  const [maintenanceForm, setMaintenanceForm] = useState<MaintenanceCompletionFormState>(
    emptyMaintenanceCompletionForm(),
  );

  const pumpsQuery = useQuery({
    queryKey: ['pca-pumps', orgId, debouncedQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim());
      const response = await fetch(buildPcaPumpsApiPath(params), {
        headers: buildOrgHeaders(orgId),
      });
      if (!response.ok) throw new Error('PCAポンプ台帳の取得に失敗しました');
      return response.json() as Promise<{ data: PcaPump[] }>;
    },
    enabled: !!orgId,
  });

  const rentalsQuery = useQuery({
    queryKey: ['pca-pump-rentals', orgId],
    queryFn: async () => {
      const response = await fetch(buildPcaPumpRentalsApiPath({ status: 'open' }), {
        headers: buildOrgHeaders(orgId),
      });
      if (!response.ok) throw new Error('PCAポンプレンタル履歴の取得に失敗しました');
      return response.json() as Promise<{ data: PcaPumpRental[] }>;
    },
    enabled: !!orgId,
  });

  const returnInspectionRentalsQuery = useQuery({
    queryKey: ['pca-pump-rentals', orgId, 'return-inspection-pending'],
    queryFn: async () => {
      const response = await fetch(
        buildPcaPumpRentalsApiPath({ status: 'returned', inspection_status: 'pending' }),
        {
          headers: buildOrgHeaders(orgId),
        },
      );
      if (!response.ok) throw new Error('PCAポンプ返却検品待ちの取得に失敗しました');
      return response.json() as Promise<{ data: PcaPumpRental[] }>;
    },
    enabled: !!orgId,
  });

  const institutionsQuery = useQuery({
    queryKey: ['prescriber-institutions', orgId, 'pca-pump-rental'],
    queryFn: async () => {
      const response = await fetch(PRESCRIBER_INSTITUTIONS_API_PATH, {
        headers: buildOrgHeaders(orgId),
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
  const openRentals = rentals;
  const returnInspectionRentals = useMemo(
    () =>
      (returnInspectionRentalsQuery.data?.data ?? []).filter(
        (rental) => rental.return_inspection_status === 'pending',
      ),
    [returnInspectionRentalsQuery.data?.data],
  );
  const pendingInspectionPumpIds = useMemo(
    () => new Set(returnInspectionRentals.map((rental) => rental.pump.id)),
    [returnInspectionRentals],
  );
  // 返却検品待ちの取得が失敗/未完了の間は、どのポンプが検品未完了か確定できない。
  // 空Set扱いで再貸出・整備完了を通すと未検品のオピオイドポンプが再貸出され得るため、
  // 検品状況が不明な間は安全側（fail-close）で再貸出/整備操作をブロックする。
  const returnInspectionUnknown =
    returnInspectionRentalsQuery.isError || returnInspectionRentalsQuery.isLoading;

  const availablePumps = useMemo(
    () =>
      returnInspectionUnknown
        ? []
        : pumps.filter(
            (pump) =>
              (pump.status === 'available' || pump.id === rentalForm.pump_id) &&
              !pendingInspectionPumpIds.has(pump.id),
          ),
    [returnInspectionUnknown, pumps, pendingInspectionPumpIds, rentalForm.pump_id],
  );
  const rentalFormErrors = getRentalFormErrors(rentalForm);
  const rentalFieldBlocker = getRentalSaveBlocker(rentalFormErrors);
  // 返却検品状況が不明(取得失敗/確認中)・未完了のポンプは availablePumps から除外される。
  // 行の「貸出」ボタン等で pump_id が pre-fill されても select の option 一覧に依存せず、
  // submission 時点で availablePumps メンバーシップを検査して未検品オピオイドポンプの再貸出を fail-close で遮断する。
  const rentalPumpUnavailable =
    rentalForm.pump_id !== '' && !availablePumps.some((pump) => pump.id === rentalForm.pump_id);
  const rentalSaveBlocker =
    rentalFieldBlocker ??
    (returnInspectionUnknown
      ? '返却検品状況を確認できないため貸出登録できません。'
      : rentalPumpUnavailable
        ? '選択したポンプは返却検品が未完了のため貸出できません。'
        : null);
  const returnInspectionSaveBlocker = getReturnInspectionSaveBlocker(inspectionForm);

  async function invalidateAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['pca-pumps', orgId] }),
      queryClient.invalidateQueries({ queryKey: ['pca-pump-rentals', orgId] }),
    ]);
  }

  const createPumpMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(buildPcaPumpsApiPath(), {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
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
      toast.error(messageFromError(error, '保存に失敗しました'));
    },
  });

  const createRentalMutation = useMutation({
    mutationFn: async () => {
      if (rentalSaveBlocker) {
        throw new Error(rentalSaveBlocker);
      }
      const response = await fetch(buildPcaPumpRentalsApiPath(), {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          pump_id: rentalForm.pump_id,
          institution_id: rentalForm.institution_id,
          status: 'active',
          rented_at: rentalForm.rented_at,
          due_at: toNullableString(rentalForm.due_at),
          contact_name: toNullableString(rentalForm.contact_name),
          contact_phone: toNullableString(rentalForm.contact_phone),
          rental_fee_yen: toNullableInteger(rentalForm.rental_fee_yen),
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
      toast.error(messageFromError(error, '貸出登録に失敗しました'));
    },
  });

  const updateRentalMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: PcaPumpRentalStatus }) => {
      const response = await fetch(buildPcaPumpRentalApiPath(id), {
        method: 'PATCH',
        headers: buildOrgJsonHeaders(orgId),
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
      toast.error(messageFromError(error, '更新に失敗しました'));
    },
  });

  const updatePumpStatusMutation = useMutation({
    mutationFn: async ({
      id,
      currentStatus,
      status,
    }: {
      id: string;
      currentStatus: PcaPumpStatus;
      status: PcaPumpStatus;
    }) => {
      const response = await fetch(buildPcaPumpApiPath(id), {
        method: 'PATCH',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify(
          buildPcaPumpStatusUpdatePayload({
            currentStatus,
            nextStatus: status,
            maintenanceNotes: maintenanceForm.notes,
            nextMaintenanceDueAt: maintenanceForm.next_maintenance_due_at,
          }),
        ),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? '状態更新に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success('PCAポンプの状態を更新しました');
      setMaintenanceSheetOpen(false);
      setMaintenanceForm(emptyMaintenanceCompletionForm());
      await invalidateAll();
    },
    onError: (error) => {
      toast.error(messageFromError(error, '状態更新に失敗しました'));
    },
  });

  const completeReturnInspectionMutation = useMutation({
    mutationFn: async () => {
      const blocker = getReturnInspectionSaveBlocker(inspectionForm);
      if (blocker) throw new Error(blocker);
      if (!inspectionForm.rental)
        throw new Error('検品対象のPCAポンプレンタルが選択されていません');
      const response = await fetch(buildPcaPumpRentalApiPath(inspectionForm.rental.id), {
        method: 'PATCH',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify(buildPcaReturnInspectionPayload(inspectionForm)),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          (payload as { message?: string }).message ?? '返却検品の保存に失敗しました',
        );
      }
      return payload;
    },
    onSuccess: async () => {
      const payload = buildPcaReturnInspectionPayload(inspectionForm);
      toast.success(
        payload.return_inspection_status === 'passed'
          ? '返却検品を完了し、利用可能にしました'
          : '返却検品を完了し、メンテ状態を継続しました',
      );
      setInspectionSheetOpen(false);
      setInspectionForm(emptyReturnInspectionForm());
      await invalidateAll();
    },
    onError: (error) => {
      toast.error(messageFromError(error, '返却検品の保存に失敗しました'));
    },
  });

  function openRental(pump?: PcaPump) {
    setRentalForm(emptyRentalForm(pump?.id ?? ''));
    setRentalSheetOpen(true);
  }

  function openReturnInspection(rental: PcaPumpRental) {
    setInspectionForm(emptyReturnInspectionForm(rental));
    setInspectionSheetOpen(true);
  }

  function openMaintenanceCompletion(pump: PcaPump) {
    setMaintenanceForm(emptyMaintenanceCompletionForm(pump));
    setMaintenanceSheetOpen(true);
  }

  function updateInspectionItem(
    key: PcaPumpAccessoryKey,
    patch: Partial<PcaPumpAccessoryChecklistItem>,
  ) {
    setInspectionForm((current) => ({
      ...current,
      checklist: {
        ...current.checklist,
        [key]: {
          ...current.checklist[key],
          ...patch,
        },
      },
    }));
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
        <StateBadge role={statusRole(row.original.status)}>
          {PUMP_STATUS_LABELS[row.original.status]}
        </StateBadge>
      ),
    },
    {
      id: 'maintenance_history',
      header: '直近整備',
      cell: ({ row }) => {
        const latestEvent = row.original.maintenance_events[0];
        return latestEvent ? (
          <div>
            <p>{MAINTENANCE_EVENT_LABELS[latestEvent.event_type]}</p>
            <p className="text-xs text-muted-foreground">{formatDate(latestEvent.performed_at)}</p>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
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
            className="h-11 sm:h-11 sm:min-h-[44px]"
            size="sm"
            variant="outline"
            onClick={() => openRental(row.original)}
            disabled={
              row.original.status !== 'available' ||
              returnInspectionUnknown ||
              pendingInspectionPumpIds.has(row.original.id)
            }
            title={
              returnInspectionUnknown
                ? '返却検品状況を確認できないため操作できません'
                : pendingInspectionPumpIds.has(row.original.id)
                  ? '返却検品が未完了のため貸出できません'
                  : undefined
            }
          >
            貸出
          </Button>
          <Button
            className="h-11 sm:h-11 sm:min-h-[44px]"
            size="sm"
            variant="outline"
            onClick={() =>
              row.original.status === 'maintenance'
                ? openMaintenanceCompletion(row.original)
                : updatePumpStatusMutation.mutate({
                    id: row.original.id,
                    currentStatus: row.original.status,
                    status: 'maintenance',
                  })
            }
            disabled={
              row.original.status === 'rented' ||
              updatePumpStatusMutation.isPending ||
              returnInspectionUnknown ||
              pendingInspectionPumpIds.has(row.original.id)
            }
            title={
              returnInspectionUnknown
                ? '返却検品状況を確認できないため操作できません'
                : pendingInspectionPumpIds.has(row.original.id)
                  ? '返却検品が未完了のため利用可能にできません'
                  : undefined
            }
          >
            {row.original.status === 'maintenance' ? '整備完了' : 'メンテ'}
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
        <StateBadge role={statusRole(row.original.status)}>
          {RENTAL_STATUS_LABELS[row.original.status]}
        </StateBadge>
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
            className="h-11 sm:h-11 sm:min-h-[44px]"
            size="sm"
            variant="outline"
            onClick={() => updateRentalMutation.mutate({ id: row.original.id, status: 'returned' })}
            disabled={updateRentalMutation.isPending}
          >
            返却
          </Button>
          <Button
            className="h-11 sm:h-11 sm:min-h-[44px]"
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
        <PageSection
          title="返却検品待ち"
          description="返却済みで、付属品・清拭・動作確認が未完了のPCAポンプを先に確認します。"
          actions={
            returnInspectionRentalsQuery.isError ? (
              <Badge variant="destructive">取得失敗</Badge>
            ) : returnInspectionRentalsQuery.isLoading ? (
              <Badge variant="outline" className="text-muted-foreground">
                確認中
              </Badge>
            ) : returnInspectionRentals.length > 0 ? (
              <StateBadge role="confirm">検品待ち {returnInspectionRentals.length}件</StateBadge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                検品待ち 0件
              </Badge>
            )
          }
          contentClassName="space-y-4"
        >
          {returnInspectionRentalsQuery.isError ? (
            <ErrorState
              variant="server"
              size="inline"
              headingLevel={3}
              title="返却検品待ちを取得できませんでした"
              description="検品未完了のPCAポンプを確認できていません。0件ではなく取得エラーです。安全のため、確認できるまで再貸出・整備操作をブロックしています。再読み込みしてください。"
              onRetry={() => void returnInspectionRentalsQuery.refetch()}
              retryLabel="再読み込み"
            />
          ) : returnInspectionRentalsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">返却検品待ちを確認しています…</p>
          ) : returnInspectionRentals.length === 0 ? (
            <p className="text-sm text-muted-foreground">返却検品待ちはありません。</p>
          ) : (
            <div className="divide-y divide-border/70 rounded-md border border-border/70 bg-card">
              {returnInspectionRentals.map((rental) => (
                <div
                  key={rental.id}
                  className="flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">
                      {rental.pump.asset_code} / {rental.pump.model_name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {rental.institution.name} ・返却日 {formatDate(rental.returned_at)}
                    </p>
                  </div>
                  <Button
                    className="h-11 sm:h-11 sm:min-h-[44px]"
                    variant="outline"
                    onClick={() => openReturnInspection(rental)}
                    aria-label={getReturnInspectionActionLabel(rental)}
                    disabled={completeReturnInspectionMutation.isPending}
                  >
                    検品
                  </Button>
                </div>
              ))}
            </div>
          )}
        </PageSection>

        <PageSection
          title="貸出中・対応待ち"
          description="医療機関へ貸出中、返却検品待ち、延滞扱いのPCAポンプを確認します。"
        >
          <DataTable
            columns={rentalColumns}
            data={openRentals}
            isLoading={rentalsQuery.isLoading}
            errorMessage={
              rentalsQuery.isError ? 'PCAポンプ貸出一覧を取得できませんでした' : undefined
            }
            emptyMessage="貸出中・対応待ちのPCAポンプはありません"
            onRetry={() => void rentalsQuery.refetch()}
          />
        </PageSection>

        <PageSection
          title="PCAポンプ台帳"
          description="管理番号、機種、貸出状態、メンテ予定を確認します。"
          actions={
            <>
              <Button
                className="h-11 sm:h-11 sm:min-h-[44px]"
                variant="outline"
                onClick={() => openRental()}
              >
                貸出登録
              </Button>
              <Button
                className="h-11 sm:h-11 sm:min-h-[44px]"
                onClick={() => setPumpSheetOpen(true)}
              >
                ポンプ登録
              </Button>
            </>
          }
          contentClassName="space-y-4"
        >
          <div className="max-w-sm">
            <Label htmlFor="pca-pump-search">検索</Label>
            <Input
              id="pca-pump-search"
              className="h-11 sm:h-11 sm:min-h-[44px]"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="管理番号 / シリアル / 機種"
            />
          </div>
          <DataTable
            columns={pumpColumns}
            data={pumps}
            isLoading={pumpsQuery.isLoading}
            errorMessage={pumpsQuery.isError ? 'PCAポンプ台帳を取得できませんでした' : undefined}
            emptyMessage="PCAポンプはまだ登録されていません"
            onRetry={() => void pumpsQuery.refetch()}
          />
        </PageSection>
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
                <SelectTrigger
                  id="rental-pump"
                  aria-invalid={Boolean(rentalFormErrors.pump_id)}
                  aria-describedby={descriptionIds(
                    'rental-pump-help',
                    rentalFormErrors.pump_id && 'rental-pump-error',
                  )}
                >
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
              <p id="rental-pump-help" className="text-xs text-muted-foreground">
                利用可能で返却検品待ちではないPCAポンプを選択します。
              </p>
              {rentalFormErrors.pump_id ? (
                <p id="rental-pump-error" className="text-xs text-destructive" role="alert">
                  {rentalFormErrors.pump_id}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rental-institution">貸出先医療機関</Label>
              <Select
                value={rentalForm.institution_id}
                onValueChange={(value) =>
                  setRentalForm((current) => ({ ...current, institution_id: value ?? '' }))
                }
              >
                <SelectTrigger
                  id="rental-institution"
                  aria-invalid={Boolean(rentalFormErrors.institution_id)}
                  aria-describedby={descriptionIds(
                    'rental-institution-help',
                    rentalFormErrors.institution_id && 'rental-institution-error',
                  )}
                >
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
              <p id="rental-institution-help" className="text-xs text-muted-foreground">
                請求と返却確認の対象になる医療機関を選択します。
              </p>
              {rentalFormErrors.institution_id ? (
                <p id="rental-institution-error" className="text-xs text-destructive" role="alert">
                  {rentalFormErrors.institution_id}
                </p>
              ) : null}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rental-start">貸出日</Label>
                <Input
                  id="rental-start"
                  type="date"
                  max={rentalForm.due_at || undefined}
                  value={rentalForm.rented_at}
                  onChange={(event) =>
                    setRentalForm((current) => ({ ...current, rented_at: event.target.value }))
                  }
                  aria-invalid={Boolean(rentalFormErrors.rented_at)}
                  aria-describedby={descriptionIds(
                    'rental-start-help',
                    rentalFormErrors.rented_at && 'rental-start-error',
                  )}
                />
                <p id="rental-start-help" className="text-xs text-muted-foreground">
                  貸出を開始する日付を入力します。
                </p>
                {rentalFormErrors.rented_at ? (
                  <p id="rental-start-error" className="text-xs text-destructive" role="alert">
                    {rentalFormErrors.rented_at}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rental-due">返却予定日</Label>
                <Input
                  id="rental-due"
                  type="date"
                  min={rentalForm.rented_at || undefined}
                  value={rentalForm.due_at}
                  onChange={(event) =>
                    setRentalForm((current) => ({ ...current, due_at: event.target.value }))
                  }
                  aria-invalid={Boolean(rentalFormErrors.due_at)}
                  aria-describedby={descriptionIds(
                    'rental-due-help',
                    rentalFormErrors.due_at && 'rental-due-error',
                  )}
                />
                <p id="rental-due-help" className="text-xs text-muted-foreground">
                  貸出日以降の日付を入力します。
                </p>
                {rentalFormErrors.due_at ? (
                  <p id="rental-due-error" className="text-xs text-destructive" role="alert">
                    {rentalFormErrors.due_at}
                  </p>
                ) : null}
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
                step={1}
                inputMode="numeric"
                value={rentalForm.rental_fee_yen}
                onChange={(event) =>
                  setRentalForm((current) => ({ ...current, rental_fee_yen: event.target.value }))
                }
                aria-invalid={Boolean(rentalFormErrors.rental_fee_yen)}
                aria-describedby={descriptionIds(
                  'rental-fee-help',
                  rentalFormErrors.rental_fee_yen && 'rental-fee-error',
                )}
              />
              <p id="rental-fee-help" className="text-xs text-muted-foreground">
                0以上の整数。空欄は未設定。
              </p>
              {rentalFormErrors.rental_fee_yen ? (
                <p id="rental-fee-error" className="text-xs text-destructive" role="alert">
                  {rentalFormErrors.rental_fee_yen}
                </p>
              ) : null}
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
              {rentalSaveBlocker ? (
                <p id={RENTAL_SAVE_BLOCKER_ID} className="self-center text-xs text-destructive">
                  {rentalSaveBlocker}
                </p>
              ) : null}
              <Button
                onClick={() => createRentalMutation.mutate()}
                disabled={createRentalMutation.isPending || Boolean(rentalSaveBlocker)}
                aria-describedby={rentalSaveBlocker ? RENTAL_SAVE_BLOCKER_ID : undefined}
              >
                {createRentalMutation.isPending ? '登録中...' : '貸出登録'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={maintenanceSheetOpen} onOpenChange={setMaintenanceSheetOpen}>
        <SheetContent className="sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>整備完了</SheetTitle>
            <SheetDescription>
              整備結果、次回メンテ予定日、作業メモを記録して利用可能に戻します。
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            {maintenanceForm.pump ? (
              <div className="rounded-md border border-border/70 bg-muted/20 p-4">
                <p className="font-medium text-foreground">
                  {maintenanceForm.pump.asset_code} / {maintenanceForm.pump.model_name}
                </p>
                <p className="text-sm text-muted-foreground">
                  現在の状態 {PUMP_STATUS_LABELS[maintenanceForm.pump.status]}
                </p>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="maintenance-next-due">次回メンテ予定日</Label>
              <Input
                id="maintenance-next-due"
                type="date"
                value={maintenanceForm.next_maintenance_due_at}
                onChange={(event) =>
                  setMaintenanceForm((current) => ({
                    ...current,
                    next_maintenance_due_at: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="maintenance-notes">作業メモ</Label>
              <Textarea
                id="maintenance-notes"
                rows={4}
                value={maintenanceForm.notes}
                onChange={(event) =>
                  setMaintenanceForm((current) => ({ ...current, notes: event.target.value }))
                }
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setMaintenanceSheetOpen(false)}>
                キャンセル
              </Button>
              <Button
                onClick={() => {
                  if (!maintenanceForm.pump) return;
                  updatePumpStatusMutation.mutate({
                    id: maintenanceForm.pump.id,
                    currentStatus: maintenanceForm.pump.status,
                    status: 'available',
                  });
                }}
                disabled={!maintenanceForm.pump || updatePumpStatusMutation.isPending}
              >
                {updatePumpStatusMutation.isPending ? '保存中...' : '整備完了'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={inspectionSheetOpen} onOpenChange={setInspectionSheetOpen}>
        <SheetContent className="overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>返却検品</SheetTitle>
            <SheetDescription>
              付属品、清拭、動作確認を記録し、次の貸出可否を確定します。
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-5">
            {inspectionForm.rental ? (
              <div className="rounded-md border border-border/70 bg-muted/20 p-4">
                <p className="font-medium text-foreground">
                  {inspectionForm.rental.pump.asset_code} / {inspectionForm.rental.pump.model_name}
                </p>
                <p className="text-sm text-muted-foreground">
                  {inspectionForm.rental.institution.name} ・返却日{' '}
                  {formatDate(inspectionForm.rental.returned_at)}
                </p>
              </div>
            ) : null}
            <div className="space-y-3">
              {PCA_RETURN_INSPECTION_ITEMS.map((item) => {
                const value = inspectionForm.checklist[item.key];
                const statusError = getReturnInspectionItemStatusError(value.status);
                const noteError = getReturnInspectionItemNoteError(value);
                const statusErrorId = `inspection-${item.key}-status-error`;
                const noteErrorId = `inspection-${item.key}-note-error`;
                return (
                  <div
                    key={item.key}
                    className="grid gap-3 rounded-md border border-border/70 p-3 md:grid-cols-[160px_180px_1fr] md:items-center"
                  >
                    <Label htmlFor={`inspection-${item.key}`}>{item.label}</Label>
                    <div className="space-y-1.5">
                      <Select
                        value={value.status}
                        onValueChange={(status) =>
                          updateInspectionItem(item.key, {
                            status: status as PcaPumpAccessoryStatus,
                          })
                        }
                      >
                        <SelectTrigger
                          id={`inspection-${item.key}`}
                          aria-invalid={Boolean(statusError)}
                          aria-describedby={statusError ? statusErrorId : undefined}
                        >
                          {/* default は非空 enum(unchecked)。bare SelectValue の生 enum 漏れ防止に明示ラベル。 */}
                          <SelectValue>
                            {ACCESSORY_STATUS_LABELS[value.status] ?? value.status}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(ACCESSORY_STATUS_LABELS).map(([status, label]) => (
                            <SelectItem key={status} value={status}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {statusError ? (
                        <p id={statusErrorId} className="text-xs text-destructive" role="alert">
                          {statusError}
                        </p>
                      ) : null}
                    </div>
                    <div className="space-y-1.5">
                      <Input
                        value={value.notes}
                        onChange={(event) =>
                          updateInspectionItem(item.key, { notes: event.target.value })
                        }
                        placeholder={
                          value.status === 'missing' || value.status === 'damaged'
                            ? '不足・破損の詳細'
                            : 'メモ'
                        }
                        aria-label={`${item.label}の検品メモ`}
                        aria-invalid={Boolean(noteError)}
                        aria-describedby={noteError ? noteErrorId : undefined}
                      />
                      {noteError ? (
                        <p id={noteErrorId} className="text-xs text-destructive" role="alert">
                          {noteError}
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="return-inspection-notes">検品メモ</Label>
              <Textarea
                id="return-inspection-notes"
                rows={3}
                value={inspectionForm.notes}
                onChange={(event) =>
                  setInspectionForm((current) => ({ ...current, notes: event.target.value }))
                }
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setInspectionSheetOpen(false)}>
                キャンセル
              </Button>
              {returnInspectionSaveBlocker ? (
                <p
                  id={RETURN_INSPECTION_SAVE_BLOCKER_ID}
                  className="self-center text-xs text-destructive"
                >
                  {returnInspectionSaveBlocker}
                </p>
              ) : null}
              <Button
                onClick={() => completeReturnInspectionMutation.mutate()}
                disabled={
                  completeReturnInspectionMutation.isPending || Boolean(returnInspectionSaveBlocker)
                }
                aria-describedby={
                  returnInspectionSaveBlocker ? RETURN_INSPECTION_SAVE_BLOCKER_ID : undefined
                }
              >
                {completeReturnInspectionMutation.isPending ? '保存中...' : '検品完了'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
