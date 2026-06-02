'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Loading } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { PatientActivityTimeline } from './patient-activity-timeline';
import type { PatientTimelineSnapshot } from './patient-detail.types';

export function PatientTimelinePanel({
  patientId,
  enabled,
}: {
  patientId: string;
  enabled: boolean;
}) {
  const orgId = useOrgId();
  const timelineQuery = useQuery<PatientTimelineSnapshot>({
    queryKey: ['patient-timeline', patientId, orgId],
    enabled: Boolean(orgId && patientId && enabled),
    queryFn: async () => {
      const response = await fetch(`/api/patients/${patientId}/timeline`, {
        headers: { 'x-org-id': orgId ?? '' },
      });
      if (!response.ok) {
        throw new Error('患者タイムラインの取得に失敗しました');
      }
      return response.json();
    },
  });

  if (!orgId) {
    return <Loading label="患者タイムラインを読み込み中..." />;
  }

  if (timelineQuery.isLoading) {
    return <Loading label="患者タイムラインを読み込み中..." />;
  }

  if (timelineQuery.error instanceof Error || !timelineQuery.data) {
    return (
      <Card>
        <CardHeader>
          <h2 className="font-heading text-base leading-snug font-medium">タイムライン</h2>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">
            {timelineQuery.error instanceof Error
              ? timelineQuery.error.message
              : '患者タイムラインの取得に失敗しました'}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <PatientActivityTimeline
      timelineEvents={timelineQuery.data.timeline_events}
      selfReports={timelineQuery.data.self_reports}
    />
  );
}
