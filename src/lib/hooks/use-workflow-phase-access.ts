'use client';

import { useQuery } from '@tanstack/react-query';
import { useOrgId } from '@/lib/hooks/use-org-id';

export type WorkflowPhaseKey =
  | 'proposals'
  | 'prescriptions'
  | 'dispensing'
  | 'auditing'
  | 'medication_sets'
  | 'visits'
  | 'reports';

export type WorkflowPhaseAccessItem = {
  preview_items: Array<{
    id: string;
    patient_name: string;
    href: string;
    label: string;
    sublabel?: string | null;
  }>;
  label: string;
  href: string;
  pending_count: number;
  summary: string;
  tone: 'default' | 'warning' | 'danger';
  next_action: {
    href: string;
    label: string;
  } | null;
};

type WorkflowPhaseAccessResponse = {
  data: {
    phase_access: Record<WorkflowPhaseKey, WorkflowPhaseAccessItem>;
  };
};

export function useWorkflowPhaseAccess() {
  const orgId = useOrgId();

  const query = useQuery({
    queryKey: ['dashboard', 'workflow', orgId],
    queryFn: async () => {
      const response = await fetch('/api/dashboard/workflow', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) {
        throw new Error('工程ナビゲーションの取得に失敗しました');
      }
      return response.json() as Promise<WorkflowPhaseAccessResponse>;
    },
    enabled: Boolean(orgId),
    staleTime: 30_000,
  });

  return {
    ...query,
    phaseAccess: query.data?.data.phase_access ?? null,
  };
}
