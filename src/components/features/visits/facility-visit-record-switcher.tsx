'use client';

import Link from 'next/link';
import { useRef, type TouchEvent } from 'react';
import { Building2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  createFacilityVisitRecordHref,
  type FacilityVisitContext,
} from '@/lib/visits/facility-visit-context';

type FacilityVisitRecordSwitcherProps = {
  currentScheduleId: string;
  context: FacilityVisitContext | null;
  className?: string;
};

export function FacilityVisitRecordSwitcher({
  currentScheduleId,
  context,
  className,
}: FacilityVisitRecordSwitcherProps) {
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const previousLinkRef = useRef<HTMLAnchorElement>(null);
  const nextLinkRef = useRef<HTMLAnchorElement>(null);

  if (!context || context.patients.length < 2) return null;

  const orderedPatients = context.patients
    .slice()
    .sort((left, right) => (left.routeOrder ?? 999) - (right.routeOrder ?? 999));
  const currentIndex = orderedPatients.findIndex(
    (patient) => patient.scheduleId === currentScheduleId,
  );
  if (currentIndex === -1) return null;

  const currentPatient = orderedPatients[currentIndex] ?? orderedPatients[0];
  const previousPatient = currentIndex > 0 ? orderedPatients[currentIndex - 1] : null;
  const nextPatient = currentIndex < orderedPatients.length - 1 ? orderedPatients[currentIndex + 1] : null;

  const handleTouchStart = (event: TouchEvent<HTMLElement>) => {
    const touch = event.changedTouches[0];
    if (!touch) return;
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = (event: TouchEvent<HTMLElement>) => {
    if (!touchStartRef.current) return;
    const touch = event.changedTouches[0];
    if (!touch) return;

    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = Math.abs(touch.clientY - touchStartRef.current.y);
    touchStartRef.current = null;
    if (deltaY > 48 || Math.abs(deltaX) < 72) return;

    if (deltaX > 0) {
      previousLinkRef.current?.click();
    } else {
      nextLinkRef.current?.click();
    }
  };

  return (
    <section
      className={cn('rounded-2xl border border-sky-200 bg-sky-50/70 p-3', className)}
      data-testid="facility-visit-record-switcher"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      aria-label="施設内患者切替"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Building2 className="size-4 text-sky-700" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-sky-950">{context.label}</h2>
          </div>
          <p className="text-xs text-sky-900/80">
            {context.siteName ?? '拠点未設定'} / {currentIndex + 1} / {orderedPatients.length} 名
          </p>
        </div>
        <Badge variant="outline" className="border-sky-300 bg-white/80 text-sky-900">
          スワイプ切替
        </Badge>
      </div>

      <div className="mt-3 rounded-xl border border-sky-200 bg-white p-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700">
          現在の患者
        </p>
        <p className="mt-1 text-base font-semibold text-foreground">{currentPatient.patientName}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {currentPatient.unitName ? `部屋 ${currentPatient.unitName}` : '部屋番号未設定'}
          {currentPatient.routeOrder != null ? ` / 順路 ${currentPatient.routeOrder}` : ''}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {previousPatient ? (
          <Link
            ref={previousLinkRef}
            href={createFacilityVisitRecordHref(previousPatient.scheduleId, context)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-sky-200 bg-white px-3 text-sm font-medium text-sky-900"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            前: {previousPatient.patientName}
          </Link>
        ) : (
          <div className="inline-flex min-h-11 items-center justify-center rounded-xl border border-dashed border-sky-200 bg-white/60 px-3 text-sm text-sky-900/60">
            先頭
          </div>
        )}
        {nextPatient ? (
          <Link
            ref={nextLinkRef}
            href={createFacilityVisitRecordHref(nextPatient.scheduleId, context)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-sky-200 bg-white px-3 text-sm font-medium text-sky-900"
          >
            次: {nextPatient.patientName}
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        ) : (
          <div className="inline-flex min-h-11 items-center justify-center rounded-xl border border-dashed border-sky-200 bg-white/60 px-3 text-sm text-sky-900/60">
            最後
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-sky-900/70">
        同一施設または個人宅の夫婦・同居人は、左右スワイプでも前後の患者へ切り替えできます。未保存時は確認が表示されます。
      </p>
    </section>
  );
}
