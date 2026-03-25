'use client';

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
  | 'postponed';

export interface VisitCardMobileProps {
  id: string;
  patientName: string;
  address: string;
  lat?: number;
  lng?: number;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
  status: VisitStatus;
  onStartVisit?: (id: string) => void;
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
  scheduledTimeStart,
  scheduledTimeEnd,
  status,
  onStartVisit,
  className,
}: VisitCardMobileProps) {
  const config = STATUS_CONFIG[status] ?? { label: status, variant: 'outline' as const };
  const isActionable = status === 'ready' || status === 'in_preparation';
  const isCompleted = status === 'completed' || status === 'cancelled';
  const mapsUrl = buildMapsUrl(address, lat, lng);

  const timeLabel =
    scheduledTimeStart && scheduledTimeEnd
      ? `${scheduledTimeStart} 〜 ${scheduledTimeEnd}`
      : scheduledTimeStart ?? null;

  return (
    <article
      className={cn(
        'rounded-lg border border-border bg-card p-4 shadow-sm',
        isCompleted && 'opacity-60',
        className
      )}
      aria-label={`訪問カード: ${patientName}`}
    >
      {/* Header: patient name + status badge */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold text-card-foreground leading-tight">
          {patientName}
        </h3>
        <Badge variant={config.variant} className="shrink-0">
          {config.label}
        </Badge>
      </div>

      {/* Address */}
      <div className="mt-2 flex items-start gap-1.5 text-sm text-muted-foreground">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="line-clamp-2">{address}</span>
      </div>

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
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            'min-h-[44px] flex-1'
          )}
          aria-label={`${patientName}の住所をナビで開く`}
        >
          <Navigation className="mr-1.5 h-4 w-4" aria-hidden="true" />
          ナビ起動
        </a>

        {isActionable && onStartVisit && (
          <Button
            size="sm"
            className="min-h-[44px] flex-1"
            onClick={() => onStartVisit(id)}
            aria-label={`${patientName}の訪問を開始`}
          >
            <Play className="mr-1.5 h-4 w-4" aria-hidden="true" />
            訪問開始
          </Button>
        )}
      </div>
    </article>
  );
}
