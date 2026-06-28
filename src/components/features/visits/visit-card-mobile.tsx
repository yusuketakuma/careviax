'use client';

import Link from 'next/link';
import { useRef, type TouchEvent } from 'react';
import { MapPin, Clock, Navigation, Play } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { StateBadge } from '@/components/ui/state-badge';
import { SCHEDULE_STATUS_ROLE } from '@/lib/constants/status-labels';
import type { StatusRole } from '@/lib/constants/status-tokens';
import { cn } from '@/lib/utils';

export type VisitStatus =
  | 'planned'
  | 'in_preparation'
  | 'ready'
  | 'departed'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'postponed'
  | 'rescheduled'
  | 'no_show';

export interface VisitCardMobileProps {
  id: string;
  patientName: string;
  address: string;
  lat?: number;
  lng?: number;
  routeOrder?: number | null;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
  actionContextLabel?: string;
  status: VisitStatus;
  patientHref?: string;
  carryItemsStatus?: string | null;
  mustCheckToday?: string[];
  visitBriefStatus?: 'available' | 'missing' | 'unavailable';
  onStartVisit?: (id: string) => void;
  onCompleteVisit?: (id: string) => void;
  className?: string;
}

const STATUS_LABELS: Record<VisitStatus, string> = {
  planned: '予定',
  in_preparation: '準備中',
  ready: '準備完了',
  departed: '出発',
  in_progress: '訪問中',
  completed: '完了',
  cancelled: 'キャンセル',
  postponed: '延期',
  rescheduled: '再調整',
  no_show: '不在',
};

function resolveStatusRole(status: VisitStatus): StatusRole {
  const role = SCHEDULE_STATUS_ROLE[status];
  return role && role !== 'neutral' ? role : 'info';
}

function buildMapsUrl(address: string, lat?: number, lng?: number): string {
  if (lat != null && lng != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

export function VisitCardMobile({
  id,
  patientName,
  address,
  lat,
  lng,
  routeOrder,
  scheduledTimeStart,
  scheduledTimeEnd,
  actionContextLabel,
  status,
  patientHref,
  carryItemsStatus,
  mustCheckToday = [],
  visitBriefStatus = 'available',
  onStartVisit,
  onCompleteVisit,
  className,
}: VisitCardMobileProps) {
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const statusLabel = STATUS_LABELS[status] ?? status;
  const statusRole = resolveStatusRole(status);
  const isActionable = status === 'ready' || status === 'departed';
  const isCompleted = status === 'completed' || status === 'cancelled';
  const mapsUrl = buildMapsUrl(address, lat, lng);
  const actionContext = actionContextLabel ?? patientName;

  const timeLabel =
    scheduledTimeStart && scheduledTimeEnd
      ? `${scheduledTimeStart} 〜 ${scheduledTimeEnd}`
      : (scheduledTimeStart ?? null);

  const showStartAction = isActionable && onStartVisit;
  const showCompleteAction = status === 'in_progress' && onCompleteVisit;
  const carryItemsLabel =
    carryItemsStatus === 'blocked'
      ? '未確定'
      : carryItemsStatus === 'partial'
        ? '一部未確定'
        : carryItemsStatus;
  const startActionText =
    carryItemsStatus === 'blocked'
      ? '持参物未確定を確認'
      : carryItemsStatus === 'partial'
        ? '警告を確認して訪問開始'
        : '訪問開始';
  const startSwipeHint =
    carryItemsStatus === 'blocked'
      ? '右スワイプで持参物未確定の警告を確認'
      : carryItemsStatus === 'partial'
        ? '右スワイプで警告を確認して訪問開始'
        : '右スワイプで訪問開始';
  const swipeHint = showStartAction
    ? showCompleteAction
      ? '右スワイプで訪問開始、左スワイプで完了'
      : startSwipeHint
    : showCompleteAction
      ? '左スワイプで訪問完了'
      : null;
  const visitBriefLabel =
    visitBriefStatus === 'unavailable'
      ? 'ブリーフ確認不可 - 患者詳細と処方を確認'
      : visitBriefStatus === 'missing'
        ? 'ブリーフ未取得 - 患者詳細と処方を確認'
        : mustCheckToday.length === 0
          ? '本日重要チェックなし（軽量ブリーフ確認済み）'
          : null;
  const showVisitBriefLabel = Boolean(visitBriefLabel);

  const handleTouchStart = (event: TouchEvent<HTMLElement>) => {
    const touch = event.changedTouches[0];
    if (!touch) return;
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = (event: TouchEvent<HTMLElement>) => {
    if (!touchStartRef.current) return;

    const touch = event.changedTouches[0];
    if (!touch) return;

    const { x, y } = touchStartRef.current;
    touchStartRef.current = null;

    const deltaX = touch.clientX - x;
    const deltaY = Math.abs(touch.clientY - y);
    if (deltaY > 48) return;

    if (deltaX > 72 && showStartAction) {
      onStartVisit(id);
      return;
    }

    if (deltaX < -72 && showCompleteAction) {
      onCompleteVisit(id);
    }
  };

  return (
    <article
      className={cn(
        'rounded-lg border border-border bg-card p-4 shadow-sm',
        isCompleted && 'opacity-60',
        className,
      )}
      aria-label={`訪問カード: ${actionContext}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Header: patient name + status badge */}
      <div className="flex items-start justify-between gap-2">
        {patientHref ? (
          <Link
            href={patientHref}
            className="text-base font-semibold leading-tight text-card-foreground hover:underline"
          >
            {patientName}
          </Link>
        ) : (
          <h3 className="text-base font-semibold text-card-foreground leading-tight">
            {patientName}
          </h3>
        )}
        <StateBadge role={statusRole} className="shrink-0">
          {statusLabel}
        </StateBadge>
      </div>

      {/* Address */}
      <div className="mt-2 flex items-start gap-1.5 text-sm text-muted-foreground">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="line-clamp-2">{address}</span>
      </div>

      {(routeOrder != null ||
        carryItemsStatus ||
        mustCheckToday.length > 0 ||
        showVisitBriefLabel) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {routeOrder != null && <Badge variant="secondary">順路 {routeOrder}</Badge>}
          {carryItemsStatus && (
            <Badge
              variant={
                carryItemsStatus === 'blocked'
                  ? 'destructive'
                  : carryItemsStatus === 'partial'
                    ? 'default'
                    : 'outline'
              }
            >
              持参物 {carryItemsLabel}
            </Badge>
          )}
          {mustCheckToday.slice(0, 2).map((item) => (
            <Badge key={item} variant="outline" className="max-w-full truncate">
              {item}
            </Badge>
          ))}
          {visitBriefLabel && (
            <Badge
              variant="outline"
              className={cn(
                'max-w-full truncate',
                visitBriefStatus !== 'available' &&
                  'border-transparent bg-state-confirm/10 text-state-confirm',
              )}
            >
              {visitBriefLabel}
            </Badge>
          )}
        </div>
      )}

      {/* Time */}
      {timeLabel && (
        <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{timeLabel}</span>
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-4 flex gap-2">
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'min-h-[44px] flex-1')}
          aria-label={`${actionContext}の住所をナビで開く`}
        >
          <Navigation className="mr-1.5 h-4 w-4" aria-hidden="true" />
          ナビ起動
        </a>

        {showStartAction && (
          <Button
            size="sm"
            className="flex-1"
            onClick={() => onStartVisit(id)}
            aria-label={`${actionContext}の${startActionText}`}
          >
            <Play className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {startActionText}
          </Button>
        )}

        {!showStartAction && showCompleteAction && (
          <Button
            size="sm"
            className="flex-1 bg-state-done text-white hover:bg-state-done/90"
            onClick={() => onCompleteVisit(id)}
            aria-label={`${patientName}の訪問を完了`}
          >
            <Play className="mr-1.5 h-4 w-4" aria-hidden="true" />
            訪問完了
          </Button>
        )}
      </div>

      {swipeHint && <p className="mt-3 text-xs text-muted-foreground">{swipeHint}</p>}
    </article>
  );
}
