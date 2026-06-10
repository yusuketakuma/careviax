'use client';

import Link from 'next/link';
import { useRef, type TouchEvent } from 'react';
import { MapPin, Clock, Navigation, Play } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
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
  onStartVisit?: (id: string) => void;
  onCompleteVisit?: (id: string) => void;
  className?: string;
}

const STATUS_CONFIG: Record<
  VisitStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  planned: { label: '予定', variant: 'outline' },
  in_preparation: { label: '準備中', variant: 'secondary' },
  ready: { label: '準備完了', variant: 'default' },
  departed: { label: '出発', variant: 'default' },
  in_progress: { label: '訪問中', variant: 'default' },
  completed: { label: '完了', variant: 'secondary' },
  cancelled: { label: 'キャンセル', variant: 'destructive' },
  postponed: { label: '延期', variant: 'outline' },
  rescheduled: { label: '再調整', variant: 'outline' },
  no_show: { label: '不在', variant: 'destructive' },
};

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
  onStartVisit,
  onCompleteVisit,
  className,
}: VisitCardMobileProps) {
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const config = STATUS_CONFIG[status] ?? { label: status, variant: 'outline' as const };
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
        <Badge variant={config.variant} className="shrink-0">
          {config.label}
        </Badge>
      </div>

      {/* Address */}
      <div className="mt-2 flex items-start gap-1.5 text-sm text-muted-foreground">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="line-clamp-2">{address}</span>
      </div>

      {(routeOrder != null || carryItemsStatus || mustCheckToday.length > 0) && (
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
            className="min-h-[44px] flex-1"
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
            className="min-h-[44px] flex-1 bg-emerald-600 hover:bg-emerald-700"
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
