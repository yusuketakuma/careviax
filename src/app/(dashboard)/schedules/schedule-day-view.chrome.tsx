import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/loading';

export type OnboardingReadiness = {
  consent_obtained: boolean;
  first_visit_doc_delivered: boolean;
  emergency_contact_set: boolean;
};

export function OnboardingWarningBadges({
  readiness,
}: {
  readiness: OnboardingReadiness;
}) {
  const warnings = [
    !readiness.consent_obtained && (
      <Badge key="consent" variant="destructive" className="text-xs">
        同意未取得
      </Badge>
    ),
    !readiness.first_visit_doc_delivered && (
      <Badge key="fvd" variant="outline" className="text-xs border-orange-500 text-orange-600">
        初回文書未交付
      </Badge>
    ),
    !readiness.emergency_contact_set && (
      <Badge key="emergency" variant="outline" className="text-xs border-orange-500 text-orange-600">
        緊急連絡先未登録
      </Badge>
    ),
  ].filter(Boolean);

  if (warnings.length === 0) return null;
  return <div className="flex flex-wrap gap-1.5">{warnings}</div>;
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
