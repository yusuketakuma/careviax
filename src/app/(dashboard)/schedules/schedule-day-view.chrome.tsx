import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/loading';
import {
  getScheduleDayOnboardingReadinessWarnings,
  type ScheduleDayOnboardingReadinessWarning,
} from './schedule-day-preparation';

export type OnboardingReadiness = {
  consent_obtained: boolean;
  first_visit_doc_delivered: boolean;
  emergency_contact_set: boolean;
  management_plan_approved: boolean;
  primary_physician_set: boolean;
};

export function getOnboardingReadinessWarnings(readiness: OnboardingReadiness) {
  return getScheduleDayOnboardingReadinessWarnings(
    readiness,
  ) satisfies ScheduleDayOnboardingReadinessWarning[];
}

export function OnboardingWarningBadges({ readiness }: { readiness: OnboardingReadiness }) {
  const warnings = getOnboardingReadinessWarnings(readiness);

  if (warnings.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" role="list" aria-label="訪問前提の未完了項目">
      {warnings.map((warning) => (
        <li key={warning.key}>
          <Badge
            variant={warning.variant}
            className={
              warning.variant === 'outline'
                ? 'border-state-confirm text-xs text-state-confirm'
                : 'text-xs'
            }
          >
            {warning.label}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

export function ScheduleBoardSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="スケジュールボード読み込み中">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-24 w-full rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-40 w-full rounded-3xl" />
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Skeleton className="h-72 w-full rounded-2xl" />
    </div>
  );
}
