'use client';

import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { formatDistanceLabel, formatDurationLabel } from '@/lib/visits/route-labels';
import type { VisitRoutePlan, VisitRouteTravelMode } from '@/types/visit-route';
import { VisitRouteMap, type VisitRouteMapPoint } from './visit-route-map';
import {
  VISIT_ROUTE_TRAVEL_MODE_LABELS,
  VISIT_ROUTE_TRAVEL_MODE_OPTIONS,
} from './visit-route-shared';

type VisitRoutePreviewPanelProps = {
  title: string;
  description: string;
  selectionLabel?: string | null;
  travelMode: VisitRouteTravelMode;
  onTravelModeChange?: (value: VisitRouteTravelMode) => void;
  plan: VisitRoutePlan | null | undefined;
  points: VisitRouteMapPoint[];
  site?: { name: string; lat: number; lng: number } | null;
  loading?: boolean;
  errorMessage?: string | null;
  emptyMessage?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  actionPending?: boolean;
  className?: string;
  extraSummary?: ReactNode;
  controlId?: string;
  headerControls?: ReactNode;
  orderedIds?: string[];
  currentOrderedIds?: string[];
  onMoveItem?: (scheduleId: string, direction: 'up' | 'down') => void;
  movableIds?: string[];
};

export function VisitRoutePreviewPanel({
  title,
  description,
  selectionLabel,
  travelMode,
  onTravelModeChange,
  plan,
  points,
  site = null,
  loading = false,
  errorMessage = null,
  emptyMessage = 'ルート計算の対象がありません。',
  actionLabel = '最適順を反映',
  onAction,
  actionDisabled = false,
  actionPending = false,
  className,
  extraSummary = null,
  controlId,
  headerControls = null,
  orderedIds,
  currentOrderedIds,
  onMoveItem,
  movableIds,
}: VisitRoutePreviewPanelProps) {
  const travelModeControlId = controlId ?? `${title}-travel-mode`;
  const pointById = new Map(points.map((point) => [point.scheduleId, point]));
  const resolvedOrderedIds =
    orderedIds && orderedIds.length > 0
      ? orderedIds
      : plan?.orderedScheduleIds.length && plan.orderedScheduleIds.length > 0
        ? plan.orderedScheduleIds
        : points.map((point) => point.scheduleId);
  const resolvedCurrentOrderedIds =
    currentOrderedIds && currentOrderedIds.length > 0 ? currentOrderedIds : null;
  const movableIdSet = movableIds ? new Set(movableIds) : null;
  const currentOrderIndexById = new Map(
    (resolvedCurrentOrderedIds ?? []).map((id, index) => [id, index]),
  );
  const optimizedIds =
    plan?.orderedScheduleIds.length && plan.orderedScheduleIds.length > 0
      ? plan.orderedScheduleIds
      : resolvedOrderedIds;
  const summaryById = new Map((plan?.stopSummaries ?? []).map((item) => [item.scheduleId, item]));
  const orderedStops = resolvedOrderedIds
    .map((scheduleId, index) => {
      const point = pointById.get(scheduleId);
      if (!point) return null;
      const stopSummary = summaryById.get(scheduleId);
      return {
        point,
        optimizedOrder: stopSummary?.optimizedOrder ?? index + 1,
        currentOrder:
          resolvedCurrentOrderedIds && currentOrderIndexById.has(scheduleId)
            ? (currentOrderIndexById.get(scheduleId) ?? 0) + 1
            : null,
        isManualOrder:
          optimizedIds.indexOf(scheduleId) !== -1 && optimizedIds.indexOf(scheduleId) !== index,
        isCurrentDiff:
          resolvedCurrentOrderedIds && currentOrderIndexById.has(scheduleId)
            ? (currentOrderIndexById.get(scheduleId) ?? 0) !== index
            : false,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item != null);

  return (
    <Card className={['border-border/70 bg-card/95', className].filter(Boolean).join(' ')}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
            {selectionLabel ? (
              <p className="text-xs text-muted-foreground">{selectionLabel}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {headerControls}
            {onTravelModeChange ? (
              <div className="space-y-1">
                <Label htmlFor={travelModeControlId} className="text-xs">
                  移動手段
                </Label>
                <Select
                  value={travelMode}
                  onValueChange={(value) => onTravelModeChange(value as VisitRouteTravelMode)}
                >
                  <SelectTrigger id={travelModeControlId} className="w-[10rem]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VISIT_ROUTE_TRAVEL_MODE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {onAction ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={actionDisabled || actionPending}
                onClick={onAction}
              >
                {actionPending ? '反映中...' : actionLabel}
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4" aria-busy={loading}>
        {loading ? (
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            ルートを計算中...
          </p>
        ) : errorMessage ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage}
          </p>
        ) : points.length === 0 ? (
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {emptyMessage}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="outline">{VISIT_ROUTE_TRAVEL_MODE_LABELS[travelMode]}</Badge>
              <Badge variant="outline">
                距離{' '}
                {plan?.totalDistanceMeters != null
                  ? formatDistanceLabel(plan.totalDistanceMeters)
                  : '未取得'}
              </Badge>
              <Badge variant="outline">
                移動{' '}
                {plan?.totalDurationSeconds != null
                  ? formatDurationLabel(plan.totalDurationSeconds)
                  : '未取得'}
              </Badge>
              <Badge variant="outline">対象 {points.length} 件</Badge>
              {site ? <Badge variant="outline">起点 {site.name}</Badge> : null}
              {extraSummary}
            </div>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_19rem]">
              <VisitRouteMap
                className="w-full"
                points={points}
                encodedPath={plan?.encodedPath ?? null}
                note={plan?.note ?? null}
                site={site}
              />
              <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                <p className="text-sm font-medium text-foreground">訪問順</p>
                <Separator className="my-3" />
                <div className="space-y-3">
                  {orderedStops.map(
                    ({ point, optimizedOrder, currentOrder, isCurrentDiff }, index) => (
                      <div
                        key={point.scheduleId}
                        className="rounded-xl border border-border/60 bg-background px-3 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              {optimizedOrder}. {point.patientName}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              {point.address}
                            </p>
                          </div>
                          {point.pointKind ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline">
                                {point.pointKind === 'proposal' ? '候補' : '確定予定'}
                              </Badge>
                              {isCurrentDiff && currentOrder ? (
                                <Badge
                                  variant="outline"
                                  className="border-sky-200 bg-sky-50 text-sky-800"
                                >
                                  現順 {currentOrder}
                                </Badge>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          {point.timeLabel ? <span>時間 {point.timeLabel}</span> : null}
                          {point.etaLabel ? <span>ETA {point.etaLabel}</span> : null}
                        </div>
                        {onMoveItem && (!movableIdSet || movableIdSet.has(point.scheduleId)) ? (
                          <div className="mt-3 flex gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={index === 0}
                              onClick={() => onMoveItem(point.scheduleId, 'up')}
                            >
                              前へ
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={index === orderedStops.length - 1}
                              onClick={() => onMoveItem(point.scheduleId, 'down')}
                            >
                              後ろへ
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ),
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
