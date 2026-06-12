'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/loading';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { cn } from '@/lib/utils';
import {
  buildVehicleSavePayload,
  MASTER_CATEGORY_LINKS,
  toVehicleFormState,
  TRAVEL_MODE_LABELS,
  vehicleAvailabilityLabel,
  type VehicleFormState,
  type VehicleResource,
  type VehicleTravelMode,
} from './vehicles-content.shared';

/**
 * P0-43 車両マスター(design/images/P0/p0_43_vehicle_master.png)。
 * 左: カテゴリ(マスター区分の導線)/ 中央: 車両一覧 / 右: 詳細を編集 の 3 カラム。
 * 一覧は visit-vehicle-resources を表示し、行クリックで右カラムの編集対象を切替える。
 */

/** 左カラム「カテゴリ」: マスター区分の導線。車両=現在地(薄青)。 */
function CategoryColumn() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">カテゴリ</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {MASTER_CATEGORY_LINKS.map((category) => {
          if (category.current) {
            return (
              <div
                key={category.key}
                aria-current="page"
                className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm font-semibold text-primary"
              >
                {category.label}
              </div>
            );
          }
          if (!category.href) {
            return (
              <div
                key={category.key}
                className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground"
              >
                <span>{category.label}</span>
                <span className="text-xs">準備中</span>
              </div>
            );
          }
          return (
            <Link
              key={category.key}
              href={category.href}
              className="block rounded-lg border border-border/70 bg-card px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
            >
              {category.label}
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** 中央カラム「車両 一覧」: 行クリックで編集対象を切替。 */
function VehicleListColumn({
  vehicles,
  isLoading,
  isError,
  selectedId,
  onSelect,
  onRetry,
}: {
  vehicles: VehicleResource[];
  isLoading: boolean;
  isError: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRetry: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">車両 一覧</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3" role="status" aria-label="車両一覧を読み込み中">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState
            variant="server"
            title="車両一覧を表示できません"
            description="車両リソースの取得に失敗しました。再試行してください。"
            action={{ label: '再試行', onClick: onRetry }}
          />
        ) : vehicles.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            車両がまだ登録されていません。
          </p>
        ) : (
          <ul className="space-y-3" data-testid="vehicle-list">
            {vehicles.map((vehicle) => {
              const selected = vehicle.id === selectedId;
              return (
                <li key={vehicle.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(vehicle.id)}
                    aria-pressed={selected}
                    className={cn(
                      'flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                      selected
                        ? 'border-primary/50 bg-primary/5'
                        : 'border-border/70 bg-card hover:bg-accent',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-foreground">
                        {vehicle.label}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {vehicle.vehicle_code ?? 'コード未設定'} ·{' '}
                        {TRAVEL_MODE_LABELS[vehicle.travel_mode]}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'shrink-0 text-sm font-medium',
                        vehicle.available ? 'text-emerald-600' : 'text-amber-600',
                      )}
                    >
                      {vehicleAvailabilityLabel(vehicle.available)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** 右カラム「詳細を編集」: 選択中車両のフォーム。保存は PATCH。 */
function VehicleEditor({ vehicle, orgId }: { vehicle: VehicleResource; orgId: string }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<VehicleFormState>(() => toVehicleFormState(vehicle));

  const saveMutation = useMutation({
    mutationFn: async () => {
      const result = buildVehicleSavePayload(form);
      if (!result.ok) throw new Error(result.message);

      const response = await fetch(`/api/visit-vehicle-resources/${vehicle.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify(result.payload),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((payload as { message?: string }).message ?? '保存に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      toast.success('車両を保存しました');
      await queryClient.invalidateQueries({ queryKey: ['visit-vehicle-resources', orgId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '保存に失敗しました');
    },
  });

  const fieldRowClass = 'grid gap-1.5 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-center';

  return (
    <div className="space-y-5">
      <div className={fieldRowClass}>
        <Label htmlFor="vehicle-label">名称</Label>
        <Input
          id="vehicle-label"
          value={form.label}
          onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
        />
      </div>
      <div className={fieldRowClass}>
        <Label htmlFor="vehicle-code">コード</Label>
        <Input
          id="vehicle-code"
          value={form.vehicleCode}
          placeholder="VEH-001 など"
          onChange={(event) =>
            setForm((current) => ({ ...current, vehicleCode: event.target.value }))
          }
        />
      </div>
      <div className={fieldRowClass}>
        <Label htmlFor="vehicle-travel-mode">分類</Label>
        <Select
          value={form.travelMode}
          onValueChange={(value) =>
            setForm((current) => ({ ...current, travelMode: value as VehicleTravelMode }))
          }
        >
          <SelectTrigger id="vehicle-travel-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(TRAVEL_MODE_LABELS) as VehicleTravelMode[]).map((mode) => (
              <SelectItem key={mode} value={mode}>
                {TRAVEL_MODE_LABELS[mode]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className={cn(fieldRowClass, 'sm:items-start')}>
        <Label htmlFor="vehicle-notes" className="sm:pt-2.5">
          注意ポイント
        </Label>
        <Textarea
          id="vehicle-notes"
          rows={2}
          value={form.notes}
          placeholder="点検期限 6/21 など(マスター鮮度の判定に使用)"
          onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
        />
      </div>
      <div className={fieldRowClass}>
        <Label htmlFor="vehicle-availability">稼働状態</Label>
        <Select
          value={form.availability}
          onValueChange={(value) =>
            setForm((current) => ({
              ...current,
              availability: value as VehicleFormState['availability'],
            }))
          }
        >
          <SelectTrigger id="vehicle-availability">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">有効(配車候補に含める)</SelectItem>
            <SelectItem value="inactive">停止中(配車候補から除外)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className={fieldRowClass}>
        <Label htmlFor="vehicle-max-stops">最大訪問件数</Label>
        <Input
          id="vehicle-max-stops"
          type="number"
          min={1}
          max={50}
          value={form.maxStops}
          onChange={(event) => setForm((current) => ({ ...current, maxStops: event.target.value }))}
        />
      </div>
      <div className="grid gap-1.5 sm:grid-cols-[140px_minmax(0,1fr)]">
        <span aria-hidden="true" className="hidden sm:block" />
        <div>
          <Button
            className="min-h-11 min-w-44"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? '保存中...' : '保存する'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function VehiclesContent() {
  const orgId = useOrgId();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const vehiclesQuery = useQuery({
    queryKey: ['visit-vehicle-resources', orgId],
    queryFn: async () => {
      const response = await fetch('/api/visit-vehicle-resources', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('車両リソースの取得に失敗しました');
      return response.json() as Promise<{ data: VehicleResource[] }>;
    },
    enabled: !!orgId,
  });

  const vehicles = vehiclesQuery.data?.data ?? [];
  // 明示選択が無ければ一覧先頭を編集対象にする。
  const selectedVehicle =
    vehicles.find((vehicle) => vehicle.id === selectedId) ?? vehicles[0] ?? null;

  return (
    <section
      aria-label="車両マスター"
      data-testid="vehicle-master"
      className="grid items-start gap-4 xl:grid-cols-[260px_minmax(0,1fr)_minmax(0,1.25fr)]"
    >
      <CategoryColumn />
      <VehicleListColumn
        vehicles={vehicles}
        isLoading={!orgId || vehiclesQuery.isLoading}
        isError={vehiclesQuery.isError}
        selectedId={selectedVehicle?.id ?? null}
        onSelect={setSelectedId}
        onRetry={() => void vehiclesQuery.refetch()}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">詳細を編集</CardTitle>
        </CardHeader>
        <CardContent>
          {selectedVehicle ? (
            <VehicleEditor key={selectedVehicle.id} vehicle={selectedVehicle} orgId={orgId} />
          ) : (
            <p className="py-6 text-sm text-muted-foreground">
              編集する車両を一覧から選択してください。
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
