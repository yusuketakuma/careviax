// @vitest-environment jsdom

import { type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CaseOption, Pharmacist, VisitScheduleBillingPreview } from './day-view.shared';
import { getDefaultScheduleDayPlannerForm } from './schedule-day-planner';
import {
  useScheduleDayPlannerQueries,
  type VisitVehicleResourceOption,
} from './schedule-day-planner-hooks';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function caseOption(): CaseOption {
  return {
    id: 'case_1',
    status: 'active',
    primary_pharmacist_id: 'pharmacist_2',
    primary_pharmacist_name: '薬剤師B',
    patient: {
      id: 'patient_1',
      name: '患者A',
      residences: [{ address: '東京都千代田区1-1' }],
    },
  };
}

const pharmacists: Pharmacist[] = [
  { id: 'pharmacist_1', name: '薬剤師A', site_id: 'site_1', site_name: '本店' },
  { id: 'pharmacist_2', name: '薬剤師B', site_id: 'site_2', site_name: '分店' },
];

const vehicleResources: VisitVehicleResourceOption[] = [
  {
    id: 'vehicle_2',
    label: '社用車B',
    travel_mode: 'DRIVE',
    max_stops: 4,
    max_route_duration_minutes: 180,
    available: true,
    site: { id: 'site_2', name: '分店' },
  },
];

const billingPreview = {
  alerts: [],
  cadence: {
    monthly_cap: 4,
    current_month_count: 1,
    remaining_month_count: 3,
    weekly_cap: null,
    current_week_count: 1,
    scheduled_dates_current_month: ['2026-06-10'],
    next_billable_date: '2026-06-17',
    suggested_dates: ['2026-06-17'],
    reason: 'within cadence',
  },
  recommended_visit_type: 'regular',
  recommended_priority: 'normal',
  suggested_schedule_slot_count: 4,
  effective_revision_code: '2026',
  effective_revision_label: '2026改定',
  site_config_status: 'resolved',
  site_config_revision_code: '2026',
  warnings: [],
  home_comprehensive_preview: null,
} satisfies VisitScheduleBillingPreview;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useScheduleDayPlannerQueries', () => {
  it('derives planner context and owns the vehicle/billing React Query requests', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/visit-vehicle-resources?available=true&site_id=site_2') {
        return new Response(JSON.stringify({ data: vehicleResources }), { status: 200 });
      }
      if (
        url ===
        '/api/visit-schedule-proposals/billing-preview?case_id=case_1&proposed_date=2026-06-11&visit_type=regular&pharmacist_id=pharmacist_2&site_id=site_2'
      ) {
        return new Response(JSON.stringify(billingPreview), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url} ${JSON.stringify(init)}`);
    });
    vi.stubGlobal('fetch', fetchImpl);

    const plannerForm = {
      ...getDefaultScheduleDayPlannerForm('2026-06-11'),
      case_id: 'case_1',
      vehicle_resource_id: 'vehicle_2',
    };

    const { result } = renderHook(
      () =>
        useScheduleDayPlannerQueries({
          orgId: 'org_1',
          plannerForm,
          cases: [caseOption()],
          pharmacists,
        }),
      { wrapper: createWrapper() },
    );

    expect(result.current.resolvedPlannerCaseId).toBe('case_1');
    expect(result.current.selectedCase?.patient.name).toBe('患者A');
    expect(result.current.selectedPlannerSiteId).toBe('site_2');
    expect(result.current.pharmacistNameById.get('pharmacist_2')).toBe('薬剤師B');

    await waitFor(() => {
      expect(result.current.selectedPlannerVehicle?.id).toBe('vehicle_2');
      expect(result.current.billingPreviewData?.effective_revision_label).toBe('2026改定');
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/visit-vehicle-resources?available=true&site_id=site_2',
      {
        headers: { 'x-org-id': 'org_1' },
      },
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/visit-schedule-proposals/billing-preview?case_id=case_1&proposed_date=2026-06-11&visit_type=regular&pharmacist_id=pharmacist_2&site_id=site_2',
      {
        headers: { 'x-org-id': 'org_1' },
      },
    );
  });

  it('does not fetch planner resources until org and billing prerequisites are present', async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);

    const { result } = renderHook(
      () =>
        useScheduleDayPlannerQueries({
          orgId: '',
          plannerForm: getDefaultScheduleDayPlannerForm(''),
          cases: [caseOption()],
          pharmacists,
        }),
      { wrapper: createWrapper() },
    );

    expect(result.current.resolvedPlannerCaseId).toBe('case_1');
    expect(result.current.billingPreviewData).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not fetch vehicle resources when the planner pharmacist has no site', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (
        url ===
        '/api/visit-schedule-proposals/billing-preview?case_id=case_1&proposed_date=2026-06-11&visit_type=regular&pharmacist_id=pharmacist_2'
      ) {
        return new Response(JSON.stringify(billingPreview), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);

    const { result } = renderHook(
      () =>
        useScheduleDayPlannerQueries({
          orgId: 'org_1',
          plannerForm: {
            ...getDefaultScheduleDayPlannerForm('2026-06-11'),
            case_id: 'case_1',
          },
          cases: [caseOption()],
          pharmacists: pharmacists.map((pharmacist) =>
            pharmacist.id === 'pharmacist_2' ? { ...pharmacist, site_id: null } : pharmacist,
          ),
        }),
      { wrapper: createWrapper() },
    );

    expect(result.current.selectedPlannerSiteId).toBeNull();
    expect(result.current.vehicleResourcesEnabled).toBe(false);
    expect(result.current.plannerVehicleResources).toEqual([]);
    await waitFor(() => {
      expect(result.current.billingPreviewData?.effective_revision_label).toBe('2026改定');
    });

    expect(fetchImpl).not.toHaveBeenCalledWith('/api/visit-vehicle-resources?available=true', {
      headers: { 'x-org-id': 'org_1' },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/visit-schedule-proposals/billing-preview?case_id=case_1&proposed_date=2026-06-11&visit_type=regular&pharmacist_id=pharmacist_2',
      {
        headers: { 'x-org-id': 'org_1' },
      },
    );
  });

  it('exposes billing preview loading while current planner inputs are being checked', async () => {
    const billingPreviewResolver: { current: ((value: Response) => void) | null } = {
      current: null,
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/visit-vehicle-resources?available=true&site_id=site_2') {
        return new Response(JSON.stringify({ data: vehicleResources }), { status: 200 });
      }
      if (
        url ===
        '/api/visit-schedule-proposals/billing-preview?case_id=case_1&proposed_date=2026-06-11&visit_type=regular&pharmacist_id=pharmacist_2&site_id=site_2'
      ) {
        return new Promise<Response>((resolve) => {
          billingPreviewResolver.current = resolve;
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);

    const { result } = renderHook(
      () =>
        useScheduleDayPlannerQueries({
          orgId: 'org_1',
          plannerForm: {
            ...getDefaultScheduleDayPlannerForm('2026-06-11'),
            case_id: 'case_1',
          },
          cases: [caseOption()],
          pharmacists,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(billingPreviewResolver.current).toBeTypeOf('function');
      expect(result.current.billingPreviewEnabled).toBe(true);
      expect(result.current.billingPreviewLoading).toBe(true);
    });

    billingPreviewResolver.current?.(new Response(JSON.stringify(billingPreview), { status: 200 }));

    await waitFor(() => {
      expect(result.current.billingPreviewLoading).toBe(false);
      expect(result.current.billingPreviewData?.effective_revision_label).toBe('2026改定');
    });
  });
});
