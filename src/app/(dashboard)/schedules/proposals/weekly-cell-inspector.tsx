'use client';

import { CalendarClock } from 'lucide-react';
import { VisitRoutePreviewPanel } from '@/components/features/visits/visit-route-preview-panel';
import {
  VisitProposalDiagnosticsCard,
  type ProposalGenerationDiagnosticsCardData,
} from '@/components/features/visits/visit-proposal-diagnostics-card';
import { Badge } from '@/components/ui/badge';
import { StateBadge } from '@/components/ui/state-badge';
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
import type { VisitRoutePlan, VisitRouteTravelMode } from '@/types/visit-route';
import { VISIT_PROPOSAL_STATUS_ROLE } from '@/lib/constants/status-labels';
import type { StatusRole } from '@/lib/constants/status-tokens';
import {
  PROPOSAL_STATUS_LABELS,
  timeLabel,
  type Proposal,
  type VisitSchedule,
} from '../day-view.shared';
import { buildOptimizerDiagnosticActions } from './schedule-proposal-diagnostic-actions';

/** 提案ステータス → 6 軸ロール。neutral は候補カードでは情報(info)として扱う。 */
function resolveProposalStatusRole(status: string): StatusRole {
  const role = VISIT_PROPOSAL_STATUS_ROLE[status];
  return role && role !== 'neutral' ? role : 'info';
}

type WeeklyCellInspectorProps = {
  title: string;
  description: string;
  selectionLabel: string | null;
  pharmacistOptions: Array<{
    id: string;
    name: string;
    siteName: string | null;
  }>;
  selectedPharmacistId: string;
  onSelectPharmacist: (value: string) => void;
  dayOptions: Array<{
    value: string;
    label: string;
  }>;
  selectedDateKey: string;
  onSelectDate: (value: string) => void;
  travelMode: VisitRouteTravelMode;
  onTravelModeChange: (value: VisitRouteTravelMode) => void;
  plan: VisitRoutePlan | null | undefined;
  points: Array<{
    scheduleId: string;
    patientName: string;
    address: string;
    lat: number;
    lng: number;
    orderLabel: string;
    status: VisitSchedule['schedule_status'];
    priority: VisitSchedule['priority'];
    pointKind?: 'proposal' | 'schedule';
    timeLabel?: string | null;
    etaLabel: string | null;
  }>;
  site: { name: string; lat: number; lng: number } | null;
  currentOrderedIds: string[];
  draftOrderedIds: string[];
  onMoveRouteItem: (scheduleId: string, direction: 'up' | 'down') => void;
  onResetRouteDraft: () => void;
  routeDiffCount: number;
  routeLoading: boolean;
  routeError: string | null;
  onApplyRoute: () => void;
  applyRouteDisabled: boolean;
  applyRoutePending: boolean;
  schedules: VisitSchedule[];
  proposals: Proposal[];
  selectedCaseId: string;
  onGenerateForCell: () => void;
  generateDisabled: boolean;
  generateDisabledReasonId?: string;
  diagnostics: ProposalGenerationDiagnosticsCardData | null;
  onApplyTimeExpansion: () => void;
  onSwitchToDrive: () => void;
  onMoveSelectionToNextDay: () => void;
  onSelectAlternatePharmacist: () => void;
};

export function WeeklyCellInspector({
  title,
  description,
  selectionLabel,
  pharmacistOptions,
  selectedPharmacistId,
  onSelectPharmacist,
  dayOptions,
  selectedDateKey,
  onSelectDate,
  travelMode,
  onTravelModeChange,
  plan,
  points,
  site,
  currentOrderedIds,
  draftOrderedIds,
  onMoveRouteItem,
  onResetRouteDraft,
  routeDiffCount,
  routeLoading,
  routeError,
  onApplyRoute,
  applyRouteDisabled,
  applyRoutePending,
  schedules,
  proposals,
  selectedCaseId,
  onGenerateForCell,
  generateDisabled,
  generateDisabledReasonId,
  diagnostics,
  onApplyTimeExpansion,
  onSwitchToDrive,
  onMoveSelectionToNextDay,
  onSelectAlternatePharmacist,
}: WeeklyCellInspectorProps) {
  return (
    <div className="space-y-4">
      <Card className="border-border/70 bg-card/95">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="weekly-inspector-pharmacist">薬剤師</Label>
            <Select
              value={selectedPharmacistId}
              onValueChange={(value) => onSelectPharmacist(value ?? '')}
            >
              <SelectTrigger id="weekly-inspector-pharmacist" className="w-full">
                <SelectValue placeholder="薬剤師を選択" />
              </SelectTrigger>
              <SelectContent>
                {pharmacistOptions.map((pharmacist) => (
                  <SelectItem key={pharmacist.id} value={pharmacist.id}>
                    {pharmacist.name}
                    {pharmacist.siteName ? ` / ${pharmacist.siteName}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="weekly-inspector-date">対象日</Label>
            <Select value={selectedDateKey} onValueChange={(value) => onSelectDate(value ?? '')}>
              <SelectTrigger id="weekly-inspector-date" className="w-full">
                <SelectValue placeholder="日付を選択" />
              </SelectTrigger>
              <SelectContent>
                {dayOptions.map((day) => (
                  <SelectItem key={day.value} value={day.value}>
                    {day.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <VisitRoutePreviewPanel
        controlId="weekly-cell-inspector-route"
        title="選択セルのルートプレビュー"
        description="確定予定と未確定候補を混在させて route_order を確認できます。"
        selectionLabel={selectionLabel}
        travelMode={travelMode}
        onTravelModeChange={onTravelModeChange}
        plan={plan}
        points={points}
        site={site}
        orderedIds={draftOrderedIds}
        currentOrderedIds={currentOrderedIds}
        onMoveItem={onMoveRouteItem}
        headerControls={
          routeDiffCount > 0 ? (
            <Button type="button" size="sm" variant="outline" onClick={onResetRouteDraft}>
              最適順へ戻す
            </Button>
          ) : null
        }
        loading={routeLoading}
        errorMessage={routeError}
        emptyMessage="このセルに訪問予定・候補はありません。"
        actionLabel="最適順を反映"
        actionDisabled={applyRouteDisabled}
        actionPending={applyRoutePending}
        onAction={onApplyRoute}
        extraSummary={
          <>
            {schedules.length > 0 ? (
              <Badge variant="outline">確定 {schedules.length} 件</Badge>
            ) : null}
            {proposals.length > 0 ? (
              <Badge variant="outline">候補 {proposals.length} 件</Badge>
            ) : null}
            {routeDiffCount > 0 ? <Badge variant="outline">差分 {routeDiffCount} 件</Badge> : null}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="border-border/70 bg-card/95">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">確定予定</CardTitle>
            <CardDescription>このセルの既存訪問です。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {schedules.length === 0 ? (
              <p className="text-sm text-muted-foreground">確定予定はありません。</p>
            ) : (
              schedules.map((schedule) => (
                <div
                  key={schedule.id}
                  className="rounded-xl border border-border/70 bg-background px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {schedule.case_.patient.name}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {timeLabel(schedule.time_window_start, schedule.time_window_end)}
                      </p>
                    </div>
                    <Badge variant="outline">#{schedule.route_order ?? '-'}</Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/95">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">未確定候補</CardTitle>
                <CardDescription>同じセルにある open proposal です。</CardDescription>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onGenerateForCell}
                disabled={generateDisabled}
                aria-describedby={generateDisabledReasonId}
              >
                <CalendarClock className="mr-1.5 size-4" />
                {selectedCaseId ? 'このセルに提案' : 'ケース選択が必要'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {proposals.length === 0 ? (
              <p className="text-sm text-muted-foreground">未確定候補はありません。</p>
            ) : (
              proposals.map((proposal) => (
                <div
                  key={proposal.id}
                  className="rounded-xl border border-border/70 bg-background px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {proposal.case_.patient.name}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {timeLabel(proposal.time_window_start, proposal.time_window_end)}
                      </p>
                    </div>
                    <StateBadge role={resolveProposalStatusRole(proposal.proposal_status)}>
                      {PROPOSAL_STATUS_LABELS[proposal.proposal_status]}
                    </StateBadge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {diagnostics ? (
        <VisitProposalDiagnosticsCard
          diagnostics={diagnostics}
          actions={buildOptimizerDiagnosticActions({
            diagnostics,
            onExpandTimeWindow: onApplyTimeExpansion,
            onSwitchToDrive,
            onMoveSelectionToNextDay,
            onSelectAlternatePharmacist,
          })}
        />
      ) : null}
    </div>
  );
}
