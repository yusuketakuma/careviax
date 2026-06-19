'use client';

import Link from 'next/link';
import { Building2, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { createFacilityVisitRecordHref } from '@/lib/visits/facility-visit-context';

export type FacilitySwipePatient = {
  scheduleId: string;
  patientName: string;
  unitName: string | null;
  routeOrder: number | null;
};

export type FacilitySwipeGroup = {
  key: string;
  label: string;
  siteName: string | null;
  patientNames: string[];
  patients: FacilitySwipePatient[];
  preparedCount: number;
  carryPendingCount: number;
  incompleteCount: number;
};

type FacilityPatientSwipeRailProps = {
  groups: readonly FacilitySwipeGroup[];
  activeGroupKey?: string | null;
  onSelectGroup?: (groupKey: string | null) => void;
  className?: string;
};

export function FacilityPatientSwipeRail({
  groups,
  activeGroupKey = null,
  onSelectGroup,
  className,
}: FacilityPatientSwipeRailProps) {
  if (groups.length === 0) return null;

  const visibleGroups =
    activeGroupKey != null ? groups.filter((group) => group.key === activeGroupKey) : groups;

  return (
    <section
      className={cn('space-y-3 rounded-2xl border border-sky-200 bg-sky-50/60 p-3', className)}
      data-testid="facility-patient-swipe-rail"
      aria-labelledby="facility-patient-swipe-rail-heading"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Building2 className="size-4 text-sky-700" aria-hidden="true" />
            <h3
              id="facility-patient-swipe-rail-heading"
              className="text-sm font-semibold text-sky-950"
            >
              同一訪問先の患者をスワイプで切替
            </h3>
          </div>
          <p className="text-xs leading-5 text-sky-900/80">
            同一施設または個人宅の夫婦・同居人は横スワイプで患者を切り替え、順路どおりに記録画面へ進みます。
          </p>
        </div>
        <Badge variant="outline" className="border-sky-300 bg-white/70 text-sky-900">
          {groups.reduce((sum, group) => sum + group.patients.length, 0)}名
        </Badge>
      </div>

      {groups.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="訪問先グループ">
          <button
            type="button"
            className={cn(
              'min-h-11 shrink-0 rounded-full border px-3 text-xs font-medium',
              activeGroupKey == null
                ? 'border-sky-700 bg-sky-900 text-white'
                : 'border-sky-200 bg-white/80 text-sky-900',
            )}
            onClick={() => onSelectGroup?.(null)}
          >
            全グループ
          </button>
          {groups.map((group) => (
            <button
              key={group.key}
              type="button"
              className={cn(
                'min-h-11 shrink-0 rounded-full border px-3 text-xs font-medium',
                activeGroupKey === group.key
                  ? 'border-sky-700 bg-sky-900 text-white'
                  : 'border-sky-200 bg-white/80 text-sky-900',
              )}
              onClick={() => onSelectGroup?.(group.key)}
            >
              {group.label} {group.patients.length}名
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [-webkit-overflow-scrolling:touch]">
        {visibleGroups.flatMap((group) =>
          group.patients
            .slice()
            .sort((left, right) => (left.routeOrder ?? 999) - (right.routeOrder ?? 999))
            .map((patient, index) => (
              <article
                key={`${group.key}-${patient.scheduleId}`}
                className="min-w-[82%] snap-center rounded-xl border border-sky-200 bg-white p-3 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700">
                      {group.label}
                    </p>
                    <h4 className="mt-1 truncate text-base font-semibold text-foreground">
                      {patient.patientName}
                    </h4>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {group.siteName ?? '拠点未設定'}
                      {patient.unitName ? ` / ${patient.unitName}` : ''}
                    </p>
                  </div>
                  <Badge variant="secondary">#{patient.routeOrder ?? index + 1}</Badge>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <Badge variant="outline">
                    準備 {group.preparedCount}/{group.patients.length}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={
                      group.carryPendingCount > 0
                        ? 'border-transparent bg-state-confirm/10 text-state-confirm'
                        : 'border-transparent bg-state-done/10 text-state-done'
                    }
                  >
                    持参未確認 {group.carryPendingCount}
                  </Badge>
                  <Badge variant="outline">未完了 {group.incompleteCount}</Badge>
                </div>

                <Link
                  href={createFacilityVisitRecordHref(patient.scheduleId, {
                    label: group.label,
                    siteName: group.siteName,
                    patients: group.patients,
                  })}
                  className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-sky-900 px-3 text-sm font-medium text-white"
                >
                  この患者を記録
                  <ChevronRight className="size-4" aria-hidden="true" />
                </Link>
              </article>
            )),
        )}
      </div>
    </section>
  );
}
