'use client';

import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import { FormErrorSummary } from '@/components/ui/form-error-summary';
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
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { collectFormErrorSummaryItems } from '@/lib/forms/errors';
import { japanDateKey } from '@/lib/utils/date-boundary';
import { messageFromError } from '@/lib/utils/error-message';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { PHARMACY_SITES_API_PATH } from '@/lib/pharmacy-sites/api-paths';
import { formatDateLabel } from '@/lib/ui/date-format';
import {
  VISIT_VEHICLE_RESOURCES_API_PATH,
  buildVisitVehicleResourceApiPath,
  buildVisitVehicleResourcesApiPath,
} from '@/lib/visit-vehicle-resources/api-paths';
import type {
  VisitVehicleResource,
  VisitVehicleResourcesResponse,
  VisitVehicleResourceTravelMode,
} from '@/types/api/visit-vehicle-resources';

type PharmacySiteOption = {
  id: string;
  name: string;
};

type PharmacySitesResponse = {
  data: PharmacySiteOption[];
};

type FormState = {
  site_id: string;
  label: string;
  vehicle_code: string;
  travel_mode: VisitVehicleResourceTravelMode;
  max_stops: string;
  max_route_duration_minutes: string;
  available: boolean;
  next_inspection_date: string;
  notes: string;
};

const NONE_VALUE = '__none__';
const EMPTY_VEHICLES: VisitVehicleResource[] = [];
const EMPTY_SITE_OPTIONS: PharmacySiteOption[] = [];
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const TRAVEL_MODES: Array<{ value: VisitVehicleResourceTravelMode; label: string }> = [
  { value: 'DRIVE', label: '自動車' },
  { value: 'TWO_WHEELER', label: '二輪' },
  { value: 'BICYCLE', label: '自転車' },
  { value: 'WALK', label: '徒歩' },
];

function createEmptyForm(siteId = NONE_VALUE): FormState {
  return {
    site_id: siteId,
    label: '',
    vehicle_code: '',
    travel_mode: 'DRIVE',
    max_stops: '8',
    max_route_duration_minutes: '',
    available: true,
    next_inspection_date: '',
    notes: '',
  };
}

function toDateInputValue(value: string | null | undefined) {
  return value ? value.slice(0, 10) : '';
}

function toForm(item: VisitVehicleResource): FormState {
  return {
    site_id: item.site_id,
    label: item.label,
    vehicle_code: item.vehicle_code ?? '',
    travel_mode: item.travel_mode,
    max_stops: String(item.max_stops),
    max_route_duration_minutes:
      item.max_route_duration_minutes == null ? '' : String(item.max_route_duration_minutes),
    available: item.available,
    next_inspection_date: toDateInputValue(item.next_inspection_date),
    notes: item.notes ?? '',
  };
}

function normalizeVehicleForm(form?: Partial<FormState> | null): FormState {
  return {
    site_id: form?.site_id ?? NONE_VALUE,
    label: form?.label ?? '',
    vehicle_code: form?.vehicle_code ?? '',
    travel_mode: form?.travel_mode ?? 'DRIVE',
    max_stops: form?.max_stops ?? '8',
    max_route_duration_minutes: form?.max_route_duration_minutes ?? '',
    available: form?.available ?? true,
    next_inspection_date: form?.next_inspection_date ?? '',
    notes: form?.notes ?? '',
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

function readIntegerInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : null;
}

function getTravelModeLabel(value: VisitVehicleResourceTravelMode) {
  return TRAVEL_MODES.find((item) => item.value === value)?.label ?? value;
}

function getInspectionState(value: string | null) {
  const dateKey = toDateInputValue(value);
  if (!dateKey) return { role: 'confirm' as const, label: '点検日未設定' };
  if (dateKey < japanDateKey()) return { role: 'blocked' as const, label: '点検期限超過' };
  return { role: 'done' as const, label: formatDateLabel(value) };
}

function getFormBlocker(form: FormState, editingVehicle: VisitVehicleResource | null) {
  if (!form.label.trim()) return '車両名は必須です。';
  if (!editingVehicle && form.site_id === NONE_VALUE) return '所属店舗は必須です。';

  const maxStops = readIntegerInput(form.max_stops);
  if (maxStops == null || maxStops < 1 || maxStops > 50) {
    return '最大訪問件数は1〜50件で指定してください。';
  }

  if (form.max_route_duration_minutes.trim()) {
    const maxRouteDuration = readIntegerInput(form.max_route_duration_minutes);
    if (maxRouteDuration == null || maxRouteDuration < 1 || maxRouteDuration > 24 * 60) {
      return '最大ルート時間は1〜1440分で指定してください。';
    }
  }

  if (form.next_inspection_date.trim() && !DATE_KEY_PATTERN.test(form.next_inspection_date)) {
    return '点検期限はYYYY-MM-DD形式で指定してください。';
  }

  return null;
}

function getFormBlockerPath(
  form: FormState,
  editingVehicle: VisitVehicleResource | null,
): keyof FormState {
  if (!form.label.trim()) return 'label';
  if (!editingVehicle && form.site_id === NONE_VALUE) return 'site_id';

  const maxStops = readIntegerInput(form.max_stops);
  if (maxStops == null || maxStops < 1 || maxStops > 50) return 'max_stops';

  if (form.max_route_duration_minutes.trim()) {
    const maxRouteDuration = readIntegerInput(form.max_route_duration_minutes);
    if (maxRouteDuration == null || maxRouteDuration < 1 || maxRouteDuration > 24 * 60) {
      return 'max_route_duration_minutes';
    }
  }

  if (form.next_inspection_date.trim() && !DATE_KEY_PATTERN.test(form.next_inspection_date)) {
    return 'next_inspection_date';
  }

  return 'label';
}

function createVehicleFormSchema(editingVehicle: VisitVehicleResource | null) {
  return z
    .object({
      site_id: z.string(),
      label: z.string(),
      vehicle_code: z.string(),
      travel_mode: z.custom<VisitVehicleResourceTravelMode>(),
      max_stops: z.string(),
      max_route_duration_minutes: z.string(),
      available: z.boolean(),
      next_inspection_date: z.string(),
      notes: z.string(),
    })
    .superRefine((value, ctx) => {
      const form = normalizeVehicleForm(value);
      const blocker = getFormBlocker(form, editingVehicle);
      if (!blocker) return;

      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [getFormBlockerPath(form, editingVehicle)],
        message: blocker,
      });
    });
}

function buildCreatePayload(form: FormState) {
  return {
    site_id: form.site_id,
    label: form.label.trim(),
    vehicle_code: trimOrUndefined(form.vehicle_code),
    travel_mode: form.travel_mode,
    max_stops: readIntegerInput(form.max_stops) ?? 8,
    max_route_duration_minutes: form.max_route_duration_minutes.trim()
      ? readIntegerInput(form.max_route_duration_minutes)
      : undefined,
    available: form.available,
    next_inspection_date: trimOrUndefined(form.next_inspection_date),
    notes: trimOrUndefined(form.notes),
  };
}

function buildUpdatePayload(form: FormState) {
  return {
    label: form.label.trim(),
    vehicle_code: trimOrNull(form.vehicle_code),
    travel_mode: form.travel_mode,
    max_stops: readIntegerInput(form.max_stops) ?? 8,
    max_route_duration_minutes: form.max_route_duration_minutes.trim()
      ? readIntegerInput(form.max_route_duration_minutes)
      : null,
    available: form.available,
    next_inspection_date: trimOrNull(form.next_inspection_date),
    notes: trimOrNull(form.notes),
  };
}

function matchesVehicleQuery(item: VisitVehicleResource, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const haystack = [
    item.label,
    item.vehicle_code ?? '',
    getTravelModeLabel(item.travel_mode),
    item.site?.name ?? '',
    item.notes ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(normalized);
}

function buildListPath() {
  const params = new URLSearchParams({ limit: '200' });
  return buildVisitVehicleResourcesApiPath(params);
}

export function VehiclesContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const errorSummaryId = 'vehicle-resource-form-error-summary';
  const [query, setQuery] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<VisitVehicleResource | null>(null);
  const [availabilityTarget, setAvailabilityTarget] = useState<{
    item: VisitVehicleResource;
    available: boolean;
  } | null>(null);
  const vehicleFormSchema = createVehicleFormSchema(editingVehicle);
  const {
    control,
    formState: { errors },
    handleSubmit,
    register,
    reset,
  } = useForm<FormState>({
    resolver: zodResolver(vehicleFormSchema),
    defaultValues: createEmptyForm(),
  });
  const watchedForm = useWatch({ control, defaultValue: createEmptyForm() });
  const form = normalizeVehicleForm(watchedForm);
  const errorSummaryItems = collectFormErrorSummaryItems(errors, {
    site_id: '所属店舗',
    label: '車両名',
    vehicle_code: '管理番号',
    travel_mode: '移動モード',
    max_stops: '最大訪問件数',
    max_route_duration_minutes: '最大ルート時間',
    available: '運用状態',
    next_inspection_date: '次回点検期限',
    notes: '備考',
  });

  function focusErrorSummary() {
    if (typeof document === 'undefined') return;
    document.getElementById(errorSummaryId)?.focus();
  }

  const vehiclesQuery = useQuery({
    queryKey: ['admin-visit-vehicle-resources', orgId],
    queryFn: async () => {
      const response = await fetch(buildListPath(), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<VisitVehicleResourcesResponse>(
        response,
        '車両マスターの取得に失敗しました',
      );
    },
    enabled: !!orgId,
  });

  const sitesQuery = useQuery({
    queryKey: ['pharmacy-sites', orgId, 'vehicle-resource-options'],
    queryFn: async () => {
      const response = await fetch(PHARMACY_SITES_API_PATH, {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<PharmacySitesResponse>(response, '店舗候補の取得に失敗しました');
    },
    enabled: !!orgId,
  });

  const vehicles = vehiclesQuery.data?.data ?? EMPTY_VEHICLES;
  const siteOptions = sitesQuery.data?.data ?? EMPTY_SITE_OPTIONS;
  const filteredVehicles = useMemo(
    () => vehicles.filter((item) => matchesVehicleQuery(item, query)),
    [vehicles, query],
  );
  const totalCount = vehiclesQuery.data?.total_count ?? vehicles.length;
  const hiddenCount = vehiclesQuery.data?.hidden_count ?? 0;
  const activeCount = vehicles.filter((item) => item.available).length;
  const inactiveCount = vehicles.length - activeCount;
  const formBlocker = getFormBlocker(form, editingVehicle);

  function resetForm() {
    setEditingVehicle(null);
    reset(createEmptyForm());
  }

  function openCreate() {
    setEditingVehicle(null);
    reset(createEmptyForm(siteOptions[0]?.id ?? NONE_VALUE));
    setSheetOpen(true);
  }

  function openEdit(item: VisitVehicleResource) {
    setEditingVehicle(item);
    reset(toForm(item));
    setSheetOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: async (values: FormState) => {
      const vehicle = editingVehicle;
      const blocker = getFormBlocker(values, vehicle);
      if (blocker) throw new Error(blocker);
      const endpoint = vehicle
        ? buildVisitVehicleResourceApiPath(vehicle.id)
        : VISIT_VEHICLE_RESOURCES_API_PATH;
      const response = await fetch(endpoint, {
        method: vehicle ? 'PATCH' : 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify(vehicle ? buildUpdatePayload(values) : buildCreatePayload(values)),
      });
      await readApiJson<unknown>(response, '保存に失敗しました');
      return { wasEditing: Boolean(vehicle) };
    },
    onSuccess: async ({ wasEditing }) => {
      toast.success(wasEditing ? '車両マスターを更新しました' : '車両を登録しました');
      setSheetOpen(false);
      resetForm();
      await queryClient.invalidateQueries({ queryKey: ['admin-visit-vehicle-resources', orgId] });
    },
    onError: (error) => {
      toast.error(messageFromError(error, '保存に失敗しました'));
    },
  });

  const availabilityMutation = useMutation({
    mutationFn: async (target: { item: VisitVehicleResource; available: boolean }) => {
      const response = await fetch(buildVisitVehicleResourceApiPath(target.item.id), {
        method: 'PATCH',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({ available: target.available }),
      });
      return readApiJson<unknown>(response, '状態変更に失敗しました');
    },
    onSuccess: async (_payload, target) => {
      toast.success(target.available ? '車両を有効化しました' : '車両を無効化しました');
      await queryClient.invalidateQueries({ queryKey: ['admin-visit-vehicle-resources', orgId] });
    },
    onError: (error) => {
      toast.error(messageFromError(error, '状態変更に失敗しました'));
    },
  });

  const columns: ColumnDef<VisitVehicleResource>[] = [
    {
      accessorKey: 'label',
      header: '車両',
      cell: ({ row }) => (
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-foreground">{row.original.label}</p>
          <p className="text-xs text-muted-foreground">
            {row.original.vehicle_code ? `管理番号 ${row.original.vehicle_code}` : '管理番号未設定'}
          </p>
        </div>
      ),
    },
    {
      id: 'site',
      header: '所属店舗',
      cell: ({ row }) => (
        <div className="space-y-1 text-sm">
          <p className="font-medium text-foreground">{row.original.site?.name ?? '店舗未設定'}</p>
          <p className="text-xs text-muted-foreground">{row.original.site_id}</p>
        </div>
      ),
    },
    {
      id: 'constraints',
      header: 'ルート制約',
      cell: ({ row }) => (
        <div className="space-y-1">
          <StateBadge role="readonly">{getTravelModeLabel(row.original.travel_mode)}</StateBadge>
          <p className="text-xs leading-5 text-muted-foreground">
            最大 {row.original.max_stops}件
            {row.original.max_route_duration_minutes
              ? ` / ${row.original.max_route_duration_minutes}分`
              : ' / 時間上限未設定'}
          </p>
        </div>
      ),
    },
    {
      id: 'status',
      header: '状態・点検',
      cell: ({ row }) => {
        const inspectionState = getInspectionState(row.original.next_inspection_date);
        return (
          <div className="space-y-1">
            <StateBadge role={row.original.available ? 'done' : 'blocked'}>
              {row.original.available ? '運用中' : '無効'}
            </StateBadge>
            <StateBadge role={inspectionState.role}>{inspectionState.label}</StateBadge>
          </div>
        );
      },
    },
    {
      accessorKey: 'notes',
      header: '備考',
      cell: ({ row }) => (
        <p className="max-w-sm whitespace-pre-wrap text-sm text-muted-foreground">
          {row.original.notes?.trim() || '備考なし'}
        </p>
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
            aria-label={`${row.original.label} を編集`}
            onClick={() => openEdit(row.original)}
          >
            編集
          </Button>
          <Button
            type="button"
            variant="outline"
            className="!h-11 !min-h-[44px]"
            aria-label={`${row.original.label} を${row.original.available ? '無効化' : '有効化'}`}
            disabled={availabilityMutation.isPending}
            onClick={() =>
              setAvailabilityTarget({ item: row.original, available: !row.original.available })
            }
          >
            {row.original.available ? '無効化' : '有効化'}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <ConfirmDialog
        open={availabilityTarget != null}
        onOpenChange={(open) => {
          if (!open) setAvailabilityTarget(null);
        }}
        title={availabilityTarget?.available ? '車両を有効化しますか？' : '車両を無効化しますか？'}
        description={
          availabilityTarget
            ? `${availabilityTarget.item.label} の運用状態を変更します。既存の訪問予定や履歴は保持されます。`
            : ''
        }
        variant={availabilityTarget?.available ? 'default' : 'destructive'}
        confirmLabel={availabilityTarget?.available ? '有効化する' : '無効化する'}
        onConfirm={() => {
          if (!availabilityTarget) return;
          availabilityMutation.mutate(availabilityTarget);
          setAvailabilityTarget(null);
        }}
      />

      <section className="space-y-4" data-testid="vehicles-master-content">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">車両一覧</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              訪問ルート、共有車両キャパシティ、スケジュール提案で使用する車両リソースを管理します。
            </p>
          </div>
          <Button className="!h-11 !min-h-[44px]" type="button" onClick={openCreate}>
            <Plus aria-hidden className="mr-2 h-4 w-4" />
            新規登録
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(240px,360px)_1fr] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="vehicle-resource-search">検索</Label>
            <Input
              id="vehicle-resource-search"
              className="!h-11 !min-h-[44px]"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="車両名 / 管理番号 / 店舗 / 備考"
            />
          </div>
          <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
            <StateBadge role="readonly">登録 {totalCount}件</StateBadge>
            <StateBadge role="done">運用中 {activeCount}件</StateBadge>
            {inactiveCount > 0 ? (
              <StateBadge role="blocked">無効 {inactiveCount}件</StateBadge>
            ) : null}
            <StateBadge role={hiddenCount > 0 ? 'confirm' : 'done'}>
              表示 {filteredVehicles.length}件
            </StateBadge>
            {hiddenCount > 0 || vehiclesQuery.data?.truncated ? (
              <StateBadge role="confirm">非表示 {hiddenCount}件</StateBadge>
            ) : null}
          </div>
        </div>

        {vehiclesQuery.isError || !orgId ? (
          <Alert variant="destructive" role="alert">
            <AlertTitle>車両マスターを取得できませんでした</AlertTitle>
            <AlertDescription>
              権限または通信状態を確認して再読み込みしてください。空の車両一覧として扱いません。
            </AlertDescription>
          </Alert>
        ) : null}

        <DataTable
          columns={columns}
          data={filteredVehicles}
          isLoading={vehiclesQuery.isLoading}
          errorMessage={
            vehiclesQuery.isError || !orgId ? '車両マスター一覧を取得できませんでした' : undefined
          }
          emptyMessage={
            query.trim() ? '検索条件に一致する車両はありません' : '車両はまだ登録されていません'
          }
          onRetry={() => void vehiclesQuery.refetch()}
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
            <SheetTitle>{editingVehicle ? '車両を編集' : '車両を登録'}</SheetTitle>
            <SheetDescription>
              ルート計画と訪問スケジュール提案で使う車両の制約と点検状態を更新します。
            </SheetDescription>
          </SheetHeader>

          <form
            className="mt-6 space-y-6"
            onSubmit={handleSubmit((values) => saveMutation.mutate(values), focusErrorSummary)}
            noValidate
          >
            <FormErrorSummary id={errorSummaryId} items={errorSummaryItems} />

            {sitesQuery.isError ? (
              <Alert variant="destructive" role="alert">
                <AlertTitle>店舗候補を取得できませんでした</AlertTitle>
                <AlertDescription>
                  所属店舗の選択ができないため、新規登録は保存前に再読み込みしてください。
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="vehicle-resource-label">車両名</Label>
                <Input
                  id="vehicle-resource-label"
                  className="!h-11 !min-h-[44px]"
                  aria-invalid={Boolean(errors.label)}
                  {...register('label')}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="vehicle-resource-site">所属店舗</Label>
                <Controller
                  control={control}
                  name="site_id"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      disabled={Boolean(editingVehicle) || sitesQuery.isError}
                      onValueChange={(value) => field.onChange(value || NONE_VALUE)}
                    >
                      <SelectTrigger
                        id="vehicle-resource-site"
                        className="!h-11 !min-h-[44px]"
                        aria-invalid={Boolean(errors.site_id)}
                      >
                        <SelectValue placeholder="所属店舗" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE_VALUE}>店舗未選択</SelectItem>
                        {siteOptions.map((site) => (
                          <SelectItem key={site.id} value={site.id}>
                            {site.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="vehicle-resource-code">管理番号</Label>
                <Input
                  id="vehicle-resource-code"
                  className="!h-11 !min-h-[44px]"
                  aria-invalid={Boolean(errors.vehicle_code)}
                  {...register('vehicle_code')}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="vehicle-resource-travel-mode">移動モード</Label>
                <Controller
                  control={control}
                  name="travel_mode"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(value) =>
                        field.onChange(value as VisitVehicleResourceTravelMode)
                      }
                    >
                      <SelectTrigger
                        id="vehicle-resource-travel-mode"
                        className="!h-11 !min-h-[44px]"
                        aria-invalid={Boolean(errors.travel_mode)}
                      >
                        <SelectValue placeholder="移動モード" />
                      </SelectTrigger>
                      <SelectContent>
                        {TRAVEL_MODES.map((mode) => (
                          <SelectItem key={mode.value} value={mode.value}>
                            {mode.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="vehicle-resource-available">運用状態</Label>
                <Controller
                  control={control}
                  name="available"
                  render={({ field }) => (
                    <Select
                      value={field.value ? 'true' : 'false'}
                      onValueChange={(value) => field.onChange(value === 'true')}
                    >
                      <SelectTrigger
                        id="vehicle-resource-available"
                        className="!h-11 !min-h-[44px]"
                        aria-invalid={Boolean(errors.available)}
                      >
                        <SelectValue placeholder="運用状態" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">運用中</SelectItem>
                        <SelectItem value="false">無効</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="vehicle-resource-max-stops">最大訪問件数</Label>
                <Input
                  id="vehicle-resource-max-stops"
                  className="!h-11 !min-h-[44px]"
                  inputMode="numeric"
                  aria-invalid={Boolean(errors.max_stops)}
                  {...register('max_stops')}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="vehicle-resource-max-route-duration">最大ルート時間（分）</Label>
                <Input
                  id="vehicle-resource-max-route-duration"
                  className="!h-11 !min-h-[44px]"
                  inputMode="numeric"
                  aria-invalid={Boolean(errors.max_route_duration_minutes)}
                  {...register('max_route_duration_minutes')}
                  placeholder="空欄=上限なし"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="vehicle-resource-next-inspection-date">次回点検期限</Label>
                <Input
                  id="vehicle-resource-next-inspection-date"
                  type="date"
                  className="!h-11 !min-h-[44px]"
                  aria-invalid={Boolean(errors.next_inspection_date)}
                  {...register('next_inspection_date')}
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="vehicle-resource-notes">備考</Label>
                <Textarea
                  id="vehicle-resource-notes"
                  rows={4}
                  aria-invalid={Boolean(errors.notes)}
                  {...register('notes')}
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
                type="submit"
                className="!h-11 !min-h-[44px]"
                disabled={saveMutation.isPending || Boolean(formBlocker)}
              >
                {saveMutation.isPending ? '保存中...' : '保存'}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
