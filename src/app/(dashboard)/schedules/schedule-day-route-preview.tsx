'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { VisitRoutePreviewPanel } from '@/components/features/visits/visit-route-preview-panel';
import type { VisitRoutePlan } from '@/server/services/visit-route-engine';
import type { ScheduleDayRouteTravelMode } from './schedule-day-planner';
import type {
  ScheduleDayRouteMapPoint,
  ScheduleDayRouteMapSite,
  ScheduleDayRoutePharmacistOption,
} from './schedule-day-view.helpers';

type ScheduleDayRouteOrderDraft = {
  currentIds: string[];
  draftIds: string[];
  diffCount: number;
  manualDirty: boolean;
  moveItem: (scheduleId: string, direction: 'up' | 'down') => void;
  resetToOptimized: () => void;
};

export type ScheduleDayRoutePreviewProps = {
  controlId: string;
  routePharmacistControlId: string;
  className?: string;
  routeSelectionLabel: string | null;
  routeTravelMode: ScheduleDayRouteTravelMode;
  onRouteTravelModeChange: (value: ScheduleDayRouteTravelMode) => void;
  routePlan: VisitRoutePlan | null | undefined;
  routeMapPoints: ScheduleDayRouteMapPoint[];
  routeMapSite: ScheduleDayRouteMapSite | null;
  routeOrderDraft: ScheduleDayRouteOrderDraft;
  routePharmacistOptions: ScheduleDayRoutePharmacistOption[];
  resolvedRoutePharmacistId: string;
  onRoutePharmacistChange: (value: string) => void;
  routePlanLoading: boolean;
  routeOptimizationDirty: boolean;
  applyPending: boolean;
  onApplyOptimizedRoute: () => void;
  actionLabel: string;
  showRouteMapScheduleCount?: boolean;
  routeMapScheduleCount?: number;
};

export function ScheduleDayRoutePreview({
  controlId,
  routePharmacistControlId,
  className,
  routeSelectionLabel,
  routeTravelMode,
  onRouteTravelModeChange,
  routePlan,
  routeMapPoints,
  routeMapSite,
  routeOrderDraft,
  routePharmacistOptions,
  resolvedRoutePharmacistId,
  onRoutePharmacistChange,
  routePlanLoading,
  routeOptimizationDirty,
  applyPending,
  onApplyOptimizedRoute,
  actionLabel,
  showRouteMapScheduleCount = false,
  routeMapScheduleCount = 0,
}: ScheduleDayRoutePreviewProps) {
  return (
    <VisitRoutePreviewPanel
      controlId={controlId}
      className={className}
      title="日次ルートマップ"
      description="薬局から訪問先までの経路を確認し、そのまま route_order へ反映できます。"
      selectionLabel={routeSelectionLabel}
      travelMode={routeTravelMode}
      onTravelModeChange={onRouteTravelModeChange}
      plan={routePlan}
      points={routeMapPoints}
      site={routeMapSite}
      orderedIds={routeOrderDraft.draftIds}
      currentOrderedIds={routeOrderDraft.currentIds}
      onMoveItem={routeOrderDraft.moveItem}
      headerControls={
        <>
          <div className="space-y-1">
            <Label htmlFor={routePharmacistControlId} className="text-xs">
              対象薬剤師
            </Label>
            <Select
              value={resolvedRoutePharmacistId}
              onValueChange={(value) => onRoutePharmacistChange(value ?? '')}
            >
              <SelectTrigger id={routePharmacistControlId} className="w-[12rem]">
                <SelectValue placeholder="薬剤師を選択" />
              </SelectTrigger>
              <SelectContent>
                {routePharmacistOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                    {option.siteName ? ` / ${option.siteName}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {routeOrderDraft.manualDirty ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={routeOrderDraft.resetToOptimized}
            >
              最適順へ戻す
            </Button>
          ) : null}
        </>
      }
      loading={routePlanLoading}
      actionLabel={actionLabel}
      actionDisabled={routePlanLoading || applyPending || !routeOptimizationDirty}
      actionPending={applyPending}
      onAction={onApplyOptimizedRoute}
      extraSummary={
        <>
          {showRouteMapScheduleCount ? (
            <Badge variant="outline">対象 {routeMapScheduleCount} 件</Badge>
          ) : null}
          {routeOrderDraft.diffCount > 0 ? (
            <Badge variant="outline">差分 {routeOrderDraft.diffCount} 件</Badge>
          ) : null}
        </>
      }
    />
  );
}
