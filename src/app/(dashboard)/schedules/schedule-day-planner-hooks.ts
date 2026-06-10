'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  CaseOption,
  Pharmacist,
  VisitScheduleBillingPreview,
  VisitVehicleResourceSummary,
} from './day-view.shared';
import {
  buildScheduleDayPharmacistLookup,
  buildScheduleDayPlannerBillingPreviewQueryKey,
  buildScheduleDayPlannerBillingPreviewRequestUrl,
  buildScheduleDayPlannerSelection,
  buildScheduleDayVehicleResourcesQueryKey,
  buildScheduleDayVehicleResourcesRequestUrl,
  getScheduleDaySelectedPlannerVehicle,
  type ScheduleDayPlannerForm,
} from './schedule-day-planner';

export type VisitVehicleResourceOption = VisitVehicleResourceSummary & {
  available: boolean;
  site: {
    id: string;
    name: string;
  } | null;
};

export function useScheduleDayPlannerQueries({
  orgId,
  plannerForm,
  cases,
  pharmacists,
}: {
  orgId: string;
  plannerForm: ScheduleDayPlannerForm;
  cases: CaseOption[];
  pharmacists: Pharmacist[];
}) {
  const { pharmacistNameById, pharmacistSiteIdById } = useMemo(
    () => buildScheduleDayPharmacistLookup(pharmacists),
    [pharmacists],
  );
  const {
    resolvedPlannerCaseId,
    selectedCase,
    selectedPlannerPharmacistId,
    selectedPlannerSiteId,
  } = useMemo(
    () =>
      buildScheduleDayPlannerSelection({
        plannerForm,
        cases,
        pharmacistSiteIdById,
      }),
    [cases, pharmacistSiteIdById, plannerForm],
  );

  const vehicleResourcesEnabled = !!orgId && !!selectedPlannerSiteId;
  const {
    data: vehicleResourcesData,
    isFetching: vehicleResourcesFetching,
    isLoading: vehicleResourcesInitialLoading,
  } = useQuery({
    queryKey: buildScheduleDayVehicleResourcesQueryKey({ orgId, selectedPlannerSiteId }),
    queryFn: async () => {
      const res = await fetch(buildScheduleDayVehicleResourcesRequestUrl(selectedPlannerSiteId), {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('社用車リソースの取得に失敗しました');
      return res.json() as Promise<{ data: VisitVehicleResourceOption[] }>;
    },
    enabled: vehicleResourcesEnabled,
  });
  const vehicleResourcesLoading =
    vehicleResourcesEnabled && (vehicleResourcesInitialLoading || vehicleResourcesFetching);
  const plannerVehicleResources = vehicleResourcesData?.data ?? [];
  const selectedPlannerVehicle = getScheduleDaySelectedPlannerVehicle(
    plannerForm,
    plannerVehicleResources,
  );

  const billingPreviewEnabled = !!orgId && !!resolvedPlannerCaseId && !!plannerForm.start_date;
  const {
    data: billingPreviewData,
    isFetching: billingPreviewFetching,
    isLoading: billingPreviewInitialLoading,
  } = useQuery({
    queryKey: buildScheduleDayPlannerBillingPreviewQueryKey({
      orgId,
      resolvedPlannerCaseId,
      proposedDate: plannerForm.start_date,
      visitType: plannerForm.visit_type,
      pharmacistId: selectedPlannerPharmacistId,
      siteId: selectedPlannerSiteId,
    }),
    queryFn: async () => {
      const res = await fetch(
        buildScheduleDayPlannerBillingPreviewRequestUrl({
          resolvedPlannerCaseId,
          proposedDate: plannerForm.start_date,
          visitType: plannerForm.visit_type,
          pharmacistId: selectedPlannerPharmacistId,
          siteId: selectedPlannerSiteId,
        }),
        {
          headers: { 'x-org-id': orgId },
        },
      );
      if (!res.ok) throw new Error('算定プレビューの取得に失敗しました');
      return res.json() as Promise<VisitScheduleBillingPreview>;
    },
    enabled: billingPreviewEnabled,
  });
  const billingPreviewLoading =
    billingPreviewEnabled && (billingPreviewInitialLoading || billingPreviewFetching);

  return {
    pharmacistNameById,
    pharmacistSiteIdById,
    resolvedPlannerCaseId,
    selectedCase,
    selectedPlannerPharmacistId,
    selectedPlannerSiteId,
    vehicleResourcesLoading,
    vehicleResourcesEnabled,
    plannerVehicleResources,
    selectedPlannerVehicle,
    billingPreviewData,
    billingPreviewLoading,
    billingPreviewEnabled,
  };
}
