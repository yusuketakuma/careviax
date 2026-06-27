'use client';

import { useQuery } from '@tanstack/react-query';
import { VisitBriefCard } from '@/components/visit-brief/visit-brief-card';
import { Loading } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import type { VisitBrief } from '@/types/visit-brief';

export function PatientVisitBriefSection({
  patientId,
  title,
  description,
  compact = false,
}: {
  patientId: string;
  title: string;
  description: string;
  compact?: boolean;
}) {
  const orgId = useOrgId();

  const { data, isLoading, error } = useQuery({
    queryKey: ['patient-visit-brief', patientId, orgId],
    queryFn: async () => {
      const response = await fetch(buildPatientApiPath(patientId, '/visit-brief'), {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) {
        throw new Error('患者要約の取得に失敗しました');
      }
      return response.json() as Promise<{ data: VisitBrief }>;
    },
    enabled: !!orgId,
  });

  if (isLoading) return <Loading />;
  if (error || !data?.data) return null;

  return (
    <VisitBriefCard brief={data.data} title={title} description={description} compact={compact} />
  );
}
