'use client';

import Link from 'next/link';
import { useRef, type TouchEvent } from 'react';
import { Building2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  createFacilityVisitRecordHref,
  type FacilityVisitContext,
  type FacilityVisitContextPatient,
} from '@/lib/visits/facility-visit-context';

type FacilityVisitRecordSwitcherProps = {
  currentScheduleId: string;
  context: FacilityVisitContext | null;
  className?: string;
};

function formatShortDate(value: string | null | undefined) {
  if (!value) return '未設定';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
}

function statusLabel(patient: FacilityVisitContextPatient) {
  if (patient.visitRecordId) return '記録済み';
  if ((patient.preparationBlockersCount ?? 0) > 0) {
    return `準備不足 ${patient.preparationBlockersCount}`;
  }
  if (patient.scheduleStatus === 'in_progress') return '訪問中';
  if (patient.scheduleStatus === 'ready') return '準備完了';
  return '未記録';
}

function placeKindLabel(kind: FacilityVisitContext['placeKind']) {
  if (kind === 'facility') return '施設並行訪問';
  if (kind === 'home_group' || kind === 'address') return '同一個人宅訪問';
  return '同一訪問先';
}

function genderLabel(value: string | null | undefined) {
  if (value === 'male') return '男性';
  if (value === 'female') return '女性';
  if (value === 'other') return 'その他';
  if (value === 'unknown') return '不明';
  return value ?? '未設定';
}

function formatBirthDate(value: string | null | undefined) {
  if (!value) return '生年月日未設定';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${parsed.getFullYear()}/${parsed.getMonth() + 1}/${parsed.getDate()}`;
}

function patientIdentityLine(patient: FacilityVisitContextPatient) {
  const fragments = [
    patient.patientId ? `ID ${patient.patientId}` : 'ID未設定',
    patient.patientNameKana ? `かな ${patient.patientNameKana}` : 'かな未設定',
    formatBirthDate(patient.birthDate),
    genderLabel(patient.gender),
  ];
  return fragments.join(' / ');
}

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
  const nextPatient =
    currentIndex < orderedPatients.length - 1 ? orderedPatients[currentIndex + 1] : null;
  const completedCount = orderedPatients.filter((patient) => patient.visitRecordId).length;
  const effectiveCompletedCount = Math.min(
    orderedPatients.length,
    completedCount + (currentPatient.visitRecordId ? 0 : 1),
  );
  const preparationBlockersCount = orderedPatients.reduce(
    (sum, patient) => sum + (patient.preparationBlockersCount ?? 0),
    0,
  );
  const progressPercent = Math.round((completedCount / orderedPatients.length) * 100);

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
      className={cn('touch-pan-y rounded-xl border border-sky-200 bg-sky-50/70 p-3', className)}
      data-testid="facility-visit-record-switcher"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      aria-label={`${placeKindLabel(context.placeKind)}の患者切替`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Building2 className="size-4 text-sky-700" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-sky-950">{context.label}</h2>
          </div>
          <p className="text-xs text-sky-900/80">
            {placeKindLabel(context.placeKind)} / {context.siteName ?? '拠点未設定'} /{' '}
            {currentIndex + 1} / {orderedPatients.length} 名
          </p>
        </div>
        <Badge variant="outline" className="border-sky-300 bg-white/80 text-sky-900">
          スワイプ切替
        </Badge>
      </div>

      <div className="mt-3 rounded-xl border border-sky-200 bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">訪問先全体の進捗</p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
              記録済み {completedCount}/{orderedPatients.length}
            </Badge>
            <Badge
              variant="outline"
              className={
                preparationBlockersCount > 0
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-800'
              }
            >
              準備不足 {preparationBlockersCount}
            </Badge>
            <Badge variant="outline">
              保存後 {effectiveCompletedCount}/{orderedPatients.length}
            </Badge>
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-sky-100" aria-hidden="true">
          <div className="h-full bg-sky-700" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      {context.commonNotes ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-semibold text-amber-950">訪問先共通メモ</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-amber-950">
            {context.commonNotes}
          </p>
        </div>
      ) : null}

      <div className="mt-3 rounded-xl border border-sky-200 bg-white p-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700">
          現在の患者
        </p>
        <p className="mt-1 text-base font-semibold text-foreground">{currentPatient.patientName}</p>
        <p className="mt-1 text-sm font-medium text-sky-950">
          {patientIdentityLine(currentPatient)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {currentPatient.unitName ? `部屋 ${currentPatient.unitName}` : '部屋番号未設定'}
          {currentPatient.routeOrder != null ? ` / 順路 ${currentPatient.routeOrder}` : ''}
        </p>
      </div>

      <div
        className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1 [scroll-snap-type:x_mandatory]"
        aria-label="同時並行訪問の患者一覧"
      >
        {orderedPatients.map((patient) => {
          const active = patient.scheduleId === currentScheduleId;
          const content = (
            <>
              <span className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-semibold">
                  {patient.routeOrder != null ? `${patient.routeOrder}. ` : ''}
                  {patient.patientName}
                </span>
                <Badge
                  variant={patient.visitRecordId ? 'default' : 'outline'}
                  className={cn(
                    'shrink-0 bg-white text-[11px]',
                    patient.visitRecordId
                      ? 'bg-emerald-600 text-white'
                      : active
                        ? 'border-sky-300 text-sky-900'
                        : 'text-muted-foreground',
                  )}
                >
                  {statusLabel(patient)}
                </Badge>
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {patientIdentityLine(patient)}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {patient.unitName ? `部屋 ${patient.unitName}` : '部屋未設定'} / 服用{' '}
                {formatShortDate(patient.medicationStartDate)}-
                {formatShortDate(patient.medicationEndDate)}
              </span>
            </>
          );

          return active ? (
            <div
              key={patient.scheduleId}
              className="min-w-[220px] scroll-ml-1 rounded-xl border border-sky-300 bg-sky-100 px-3 py-2 text-sky-950 [scroll-snap-align:start]"
              aria-current="true"
            >
              {content}
            </div>
          ) : (
            <Link
              key={patient.scheduleId}
              href={createFacilityVisitRecordHref(patient.scheduleId, context)}
              className="min-w-[220px] scroll-ml-1 rounded-xl border border-sky-200 bg-white px-3 py-2 text-foreground transition hover:bg-sky-50 [scroll-snap-align:start]"
            >
              {content}
            </Link>
          );
        })}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {previousPatient ? (
          <Link
            ref={previousLinkRef}
            href={createFacilityVisitRecordHref(previousPatient.scheduleId, context)}
            className="inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-xl border border-sky-200 bg-white px-3 text-sm font-medium text-sky-900"
          >
            <ChevronLeft className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">前: {previousPatient.patientName}</span>
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
            className="inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-xl border border-sky-200 bg-white px-3 text-sm font-medium text-sky-900"
          >
            <span className="min-w-0 truncate">次: {nextPatient.patientName}</span>
            <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
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
