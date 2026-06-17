import { describe, expect, it, vi } from 'vitest';
import {
  applyScheduleDayPlannerBillingRecommendations,
  applyScheduleDayPlannerCaseSelection,
  applyScheduleDayPlannerCandidateCount,
  applyScheduleDayPlannerPreferredTimeFrom,
  applyScheduleDayPlannerPreferredTimeTo,
  applyScheduleDayPlannerPriority,
  applyScheduleDayPlannerStartDate,
  applyScheduleDayPlannerVehicleResourceSelection,
  applyScheduleDayPlannerVisitType,
  buildScheduleDayPharmacistLookup,
  buildScheduleDayPlannerBillingPreviewQueryKey,
  buildScheduleDayPlannerBillingPreviewRequestUrl,
  buildScheduleDayPlannerSelection,
  buildScheduleDayProposalGenerationPayload,
  buildScheduleDaySelectedDateProposals,
  buildScheduleDayVehicleResourcesQueryKey,
  buildScheduleDayVehicleResourcesRequestUrl,
  clearScheduleDayPlannerVehicleResourceSelection,
  filterScheduleDayPlannerCases,
  generateScheduleDayProposals,
  getDefaultScheduleDayPlannerForm,
  getScheduleDayEffectivePlannerCandidateCount,
  getScheduleDaySelectedPlannerVehicle,
  getScheduleDayProposalWarningDescription,
  handleScheduleDayProposalGenerationSuccess,
  resolveScheduleDayPlannerCaseId,
  resolveScheduleDayPlannerVehicleRouteTravelMode,
  selectScheduleDayPlannerVehicle,
  type ScheduleDayPlannerForm,
} from './schedule-day-planner';
import type {
  BillingRequirementAlert,
  CaseOption,
  Proposal,
  VisitScheduleBillingPreview,
} from './day-view.shared';

const plannerForm: ScheduleDayPlannerForm = {
  case_id: '',
  visit_type: 'regular',
  priority: 'urgent',
  start_date: '2026-06-11',
  preferred_time_from: '09:00',
  preferred_time_to: '',
  vehicle_resource_id: '',
  candidate_count: '3',
};

function alert(message: string, severity: BillingRequirementAlert['severity']) {
  return {
    type: `type_${message}`,
    severity,
    message,
    details: {},
    as_of: '2026-06-10',
  } satisfies BillingRequirementAlert;
}

function caseOption(overrides: Partial<CaseOption> = {}): CaseOption {
  const id = overrides.id ?? 'case_1';
  const fallbackPatient = {
    id: `patient_${id}`,
    name: `患者${id}`,
    residences: [{ address: '東京都千代田区1-1' }],
  };

  return {
    id,
    status: 'active',
    primary_pharmacist_id: 'pharmacist_1',
    primary_pharmacist_name: '薬剤師A',
    ...overrides,
    patient: {
      ...fallbackPatient,
      ...overrides.patient,
      residences: overrides.patient?.residences ?? fallbackPatient.residences,
    },
  };
}

describe('schedule day planner helpers', () => {
  it('builds the default planner form for the selected start date', () => {
    expect(getDefaultScheduleDayPlannerForm('2026-06-10')).toEqual({
      case_id: '',
      visit_type: 'regular',
      priority: 'normal',
      start_date: '2026-06-10',
      preferred_time_from: '09:00',
      preferred_time_to: '12:00',
      vehicle_resource_id: '',
      candidate_count: '3',
    });
  });

  it('resolves the planner case id from form state or the first active case', () => {
    expect(
      resolveScheduleDayPlannerCaseId({
        plannerForm,
        cases: [{ id: 'case_fallback' }],
      }),
    ).toBe('case_fallback');

    expect(
      resolveScheduleDayPlannerCaseId({
        plannerForm: { ...plannerForm, case_id: 'case_selected' },
        cases: [{ id: 'case_fallback' }],
      }),
    ).toBe('case_selected');
  });

  it('filters inactive planner cases and derives the selected case/site context', () => {
    const cases = [
      caseOption({
        id: 'case_active',
        primary_pharmacist_id: 'pharmacist_2',
        primary_pharmacist_name: '薬剤師B',
      }),
      caseOption({ id: 'case_discharged', status: 'discharged' }),
      caseOption({ id: 'case_terminated', status: 'terminated' }),
    ];
    const activeCases = filterScheduleDayPlannerCases(cases);
    const lookup = buildScheduleDayPharmacistLookup([
      { id: 'pharmacist_1', name: '薬剤師A', site_id: 'site_1' },
      { id: 'pharmacist_2', name: '薬剤師B', site_id: 'site_2' },
    ]);

    expect(activeCases.map((careCase) => careCase.id)).toEqual(['case_active']);
    expect(lookup.pharmacistNameById).toEqual(
      new Map([
        ['pharmacist_1', '薬剤師A'],
        ['pharmacist_2', '薬剤師B'],
      ]),
    );
    expect(lookup.pharmacistSiteIdById).toEqual(
      new Map([
        ['pharmacist_1', 'site_1'],
        ['pharmacist_2', 'site_2'],
      ]),
    );
    expect(
      buildScheduleDayPlannerSelection({
        plannerForm,
        cases: activeCases,
        pharmacistSiteIdById: lookup.pharmacistSiteIdById,
      }),
    ).toEqual({
      resolvedPlannerCaseId: 'case_active',
      selectedCase: activeCases[0],
      selectedPlannerPharmacistId: 'pharmacist_2',
      selectedPlannerSiteId: 'site_2',
    });
  });

  it('builds stable planner vehicle-resource query keys and request URLs', () => {
    expect(
      buildScheduleDayVehicleResourcesQueryKey({
        orgId: 'org_1',
        selectedPlannerSiteId: 'site_1',
      }),
    ).toEqual(['visit-vehicle-resources', 'org_1', 'schedule-planner', 'site_1']);
    expect(
      buildScheduleDayVehicleResourcesQueryKey({
        orgId: 'org_1',
        selectedPlannerSiteId: null,
      }),
    ).toEqual(['visit-vehicle-resources', 'org_1', 'schedule-planner', null]);
    expect(buildScheduleDayVehicleResourcesRequestUrl('site_1')).toBe(
      '/api/visit-vehicle-resources?available=true&site_id=site_1',
    );
    expect(buildScheduleDayVehicleResourcesRequestUrl(null)).toBe(
      '/api/visit-vehicle-resources?available=true',
    );
  });

  it('builds stable planner billing-preview query keys and request URLs', () => {
    expect(
      buildScheduleDayPlannerBillingPreviewQueryKey({
        orgId: 'org_1',
        resolvedPlannerCaseId: 'case_1',
        proposedDate: '2026-06-11',
        visitType: 'regular',
        pharmacistId: 'pharmacist_1',
        siteId: 'site_1',
      }),
    ).toEqual([
      'visit-schedule-billing-preview',
      'org_1',
      'case_1',
      '2026-06-11',
      'regular',
      'pharmacist_1',
      'site_1',
    ]);
    expect(
      buildScheduleDayPlannerBillingPreviewRequestUrl({
        resolvedPlannerCaseId: 'case_1',
        proposedDate: '2026-06-11',
        visitType: 'regular',
        pharmacistId: 'pharmacist_1',
        siteId: 'site_1',
      }),
    ).toBe(
      '/api/visit-schedule-proposals/billing-preview?case_id=case_1&proposed_date=2026-06-11&visit_type=regular&pharmacist_id=pharmacist_1&site_id=site_1',
    );
    expect(
      buildScheduleDayPlannerBillingPreviewRequestUrl({
        resolvedPlannerCaseId: 'case_1',
        proposedDate: '2026-06-11',
        visitType: null,
        pharmacistId: '',
        siteId: null,
      }),
    ).toBe('/api/visit-schedule-proposals/billing-preview?case_id=case_1&proposed_date=2026-06-11');
  });

  it('updates planner case, clearing stale vehicle selection only when the case changes', () => {
    const current = {
      ...plannerForm,
      case_id: 'case_1',
      vehicle_resource_id: 'vehicle_1',
    };

    expect(applyScheduleDayPlannerCaseSelection(current, 'case_2')).toEqual({
      ...current,
      case_id: 'case_2',
      vehicle_resource_id: '',
    });
    expect(applyScheduleDayPlannerCaseSelection(current, 'case_1')).toEqual(current);
    expect(applyScheduleDayPlannerCaseSelection(current, undefined)).toEqual(current);
    expect(clearScheduleDayPlannerVehicleResourceSelection(current)).toEqual({
      ...current,
      vehicle_resource_id: '',
    });
    expect(clearScheduleDayPlannerVehicleResourceSelection(plannerForm)).toBe(plannerForm);
  });

  it('updates planner start date without changing unrelated fields', () => {
    expect(applyScheduleDayPlannerStartDate(plannerForm, '2026-06-20')).toEqual({
      ...plannerForm,
      start_date: '2026-06-20',
    });
    expect(applyScheduleDayPlannerStartDate(plannerForm, null)).toEqual(plannerForm);
  });

  it('updates planner form fields without leaking event wiring into the view', () => {
    expect(applyScheduleDayPlannerVisitType(plannerForm, 'temporary')).toEqual({
      ...plannerForm,
      visit_type: 'temporary',
    });
    expect(applyScheduleDayPlannerVisitType(plannerForm, null)).toEqual(plannerForm);

    expect(applyScheduleDayPlannerPriority(plannerForm, 'emergency')).toEqual({
      ...plannerForm,
      priority: 'emergency',
    });
    expect(applyScheduleDayPlannerPriority(plannerForm, undefined)).toEqual(plannerForm);

    expect(applyScheduleDayPlannerCandidateCount(plannerForm, '5')).toEqual({
      ...plannerForm,
      candidate_count: '5',
    });
    expect(applyScheduleDayPlannerCandidateCount(plannerForm, null)).toEqual(plannerForm);

    expect(applyScheduleDayPlannerPreferredTimeFrom(plannerForm, '')).toEqual({
      ...plannerForm,
      preferred_time_from: '',
    });
    expect(applyScheduleDayPlannerPreferredTimeFrom(plannerForm, undefined)).toEqual(plannerForm);

    expect(applyScheduleDayPlannerPreferredTimeTo(plannerForm, '15:30')).toEqual({
      ...plannerForm,
      preferred_time_to: '15:30',
    });
    expect(applyScheduleDayPlannerPreferredTimeTo(plannerForm, null)).toEqual(plannerForm);
  });

  it('derives the effective candidate count from billing recommendations unless manually changed', () => {
    const billingPreview = {
      suggested_schedule_slot_count: 5,
    } as VisitScheduleBillingPreview;

    expect(
      getScheduleDayEffectivePlannerCandidateCount({
        plannerForm,
        billingPreview,
        isManual: false,
      }),
    ).toBe('5');

    expect(
      getScheduleDayEffectivePlannerCandidateCount({
        plannerForm,
        billingPreview,
        isManual: true,
      }),
    ).toBe('3');

    expect(
      getScheduleDayEffectivePlannerCandidateCount({
        plannerForm,
        billingPreview: { suggested_schedule_slot_count: 0 } as VisitScheduleBillingPreview,
        isManual: false,
      }),
    ).toBe('3');
  });

  it('applies billing recommendations while preserving existing values when absent', () => {
    expect(
      applyScheduleDayPlannerBillingRecommendations({
        current: plannerForm,
        billingPreview: {
          recommended_visit_type: 'temporary',
          recommended_priority: 'emergency',
          suggested_schedule_slot_count: 4,
        } as VisitScheduleBillingPreview,
      }),
    ).toEqual({
      ...plannerForm,
      visit_type: 'temporary',
      priority: 'emergency',
      candidate_count: '4',
    });

    expect(
      applyScheduleDayPlannerBillingRecommendations({
        current: plannerForm,
        billingPreview: null,
      }),
    ).toEqual({
      ...plannerForm,
      candidate_count: '3',
    });
  });

  it('selects a planner vehicle and only changes route travel mode when a vehicle is selected', () => {
    const vehicleResources = [
      { id: 'vehicle_1', travel_mode: 'TWO_WHEELER' as const },
      { id: 'vehicle_2', travel_mode: 'DRIVE' as const },
    ];

    expect(
      selectScheduleDayPlannerVehicle({
        current: plannerForm,
        selectedValue: 'vehicle_1',
        autoValue: '__auto__',
        vehicleResources,
        currentRouteTravelMode: 'DRIVE',
      }),
    ).toEqual({
      plannerForm: {
        ...plannerForm,
        vehicle_resource_id: 'vehicle_1',
      },
      routeTravelMode: 'TWO_WHEELER',
    });

    expect(
      selectScheduleDayPlannerVehicle({
        current: { ...plannerForm, vehicle_resource_id: 'vehicle_1' },
        selectedValue: '__auto__',
        autoValue: '__auto__',
        vehicleResources,
        currentRouteTravelMode: 'TWO_WHEELER',
      }),
    ).toEqual({
      plannerForm: {
        ...plannerForm,
        vehicle_resource_id: '',
      },
      routeTravelMode: 'TWO_WHEELER',
    });

    expect(
      selectScheduleDayPlannerVehicle({
        current: { ...plannerForm, vehicle_resource_id: 'vehicle_1' },
        selectedValue: 'missing_vehicle',
        autoValue: '__auto__',
        vehicleResources,
        currentRouteTravelMode: 'WALK',
      }),
    ).toEqual({
      plannerForm: {
        ...plannerForm,
        vehicle_resource_id: 'missing_vehicle',
      },
      routeTravelMode: 'WALK',
    });
  });

  it('keeps planner vehicle form updates independent from route-mode resolution', () => {
    const current = {
      ...plannerForm,
      preferred_time_from: '10:30',
      vehicle_resource_id: 'vehicle_0',
    };
    const vehicleResources = [
      { id: 'vehicle_1', travel_mode: 'TWO_WHEELER' as const },
      { id: 'vehicle_2', travel_mode: 'DRIVE' as const },
    ];

    expect(
      applyScheduleDayPlannerVehicleResourceSelection(current, 'vehicle_2', '__auto__'),
    ).toEqual({
      ...current,
      vehicle_resource_id: 'vehicle_2',
    });
    expect(
      applyScheduleDayPlannerVehicleResourceSelection(current, '__auto__', '__auto__'),
    ).toEqual({
      ...current,
      vehicle_resource_id: '',
    });

    expect(
      resolveScheduleDayPlannerVehicleRouteTravelMode({
        selectedValue: 'vehicle_1',
        autoValue: '__auto__',
        vehicleResources,
        currentRouteTravelMode: 'WALK',
      }),
    ).toBe('TWO_WHEELER');
    expect(
      resolveScheduleDayPlannerVehicleRouteTravelMode({
        selectedValue: '__auto__',
        autoValue: '__auto__',
        vehicleResources,
        currentRouteTravelMode: 'WALK',
      }),
    ).toBe('WALK');
  });

  it('finds the selected planner vehicle from the current form', () => {
    const vehicleResources = [
      { id: 'vehicle_1', label: '軽自動車' },
      { id: 'vehicle_2', label: '二輪' },
    ];

    expect(
      getScheduleDaySelectedPlannerVehicle(
        { ...plannerForm, vehicle_resource_id: 'vehicle_2' },
        vehicleResources,
      ),
    ).toEqual({ id: 'vehicle_2', label: '二輪' });
    expect(getScheduleDaySelectedPlannerVehicle(plannerForm, vehicleResources)).toBeNull();
  });

  it('filters selected-date proposals and sorts route-ordered items first', () => {
    const proposals = [
      {
        id: 'proposal_other_date',
        proposed_date: '2026-06-12T09:00:00.000Z',
        route_order: 1,
      },
      {
        id: 'proposal_no_route',
        proposed_date: '2026-06-11T08:00:00.000Z',
        route_order: null,
      },
      {
        id: 'proposal_second',
        proposed_date: '2026-06-11T10:00:00.000Z',
        route_order: 2,
      },
      {
        id: 'proposal_first',
        proposed_date: '2026-06-11T09:00:00.000Z',
        route_order: 1,
      },
    ];

    expect(
      buildScheduleDaySelectedDateProposals(proposals, '2026-06-11').map((proposal) => proposal.id),
    ).toEqual(['proposal_first', 'proposal_second', 'proposal_no_route']);
  });

  it('builds the proposal generation payload with optional planner fields omitted', () => {
    expect(
      buildScheduleDayProposalGenerationPayload({
        resolvedCaseId: 'case_1',
        plannerForm,
        routeTravelMode: 'BICYCLE',
        effectiveCandidateCount: '4',
      }),
    ).toEqual({
      case_id: 'case_1',
      visit_type: 'regular',
      priority: 'urgent',
      travel_mode: 'BICYCLE',
      start_date: '2026-06-11',
      preferred_time_from: '09:00',
      preferred_time_to: undefined,
      vehicle_resource_id: undefined,
      candidate_count: 4,
    });
  });

  it('posts the planner request with org scope and returns the generated proposals', async () => {
    const payload = {
      data: [{ id: 'proposal_1' } as Proposal],
      alerts: [alert('算定確認', 'warning')],
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => payload,
    }));
    const fetchImpl = fetchMock as unknown as typeof fetch;

    await expect(
      generateScheduleDayProposals({
        orgId: 'org_1',
        resolvedCaseId: 'case_1',
        plannerForm,
        routeTravelMode: 'DRIVE',
        effectiveCandidateCount: 3,
        fetchImpl,
      }),
    ).resolves.toEqual(payload);

    expect(fetchImpl).toHaveBeenCalledWith('/api/visit-schedule-proposals', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-org-id': 'org_1',
      },
      body: expect.any(String),
    });
    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      case_id: 'case_1',
      visit_type: 'regular',
      priority: 'urgent',
      travel_mode: 'DRIVE',
      start_date: '2026-06-11',
      preferred_time_from: '09:00',
      candidate_count: 3,
      idempotency_key: expect.stringMatching(/^schedule-day:/),
    });
  });

  it('throws the server error message for failed planner requests', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      json: async () => ({ message: 'ケースが見つかりません' }),
    })) as unknown as typeof fetch;

    await expect(
      generateScheduleDayProposals({
        orgId: 'org_1',
        resolvedCaseId: 'missing_case',
        plannerForm,
        routeTravelMode: 'DRIVE',
        effectiveCandidateCount: 3,
        fetchImpl,
      }),
    ).rejects.toThrow('ケースが見つかりません');
  });

  it('formats only non-info billing alerts for the planner warning toast', () => {
    expect(
      getScheduleDayProposalWarningDescription([
        alert('参考情報', 'info'),
        alert('算定要件A', 'warning'),
        alert('算定要件B', 'error'),
        alert('算定要件C', 'warning'),
      ]),
    ).toBe('算定要件A / 算定要件B');

    expect(getScheduleDayProposalWarningDescription([alert('参考情報', 'info')])).toBeNull();
  });

  it('notifies success, warns on billing alerts, invalidates proposals, and selects the planner date', async () => {
    const notifySuccess = vi.fn();
    const notifyWarning = vi.fn();
    const invalidateQueries = vi.fn(async () => undefined);
    const setSelectedDate = vi.fn();

    await handleScheduleDayProposalGenerationSuccess({
      data: {
        data: [{ id: 'proposal_1' }, { id: 'proposal_2' }] as Proposal[],
        alerts: [alert('参考情報', 'info'), alert('算定要件A', 'warning')],
      },
      orgId: 'org_1',
      plannerStartDate: '2026-06-11',
      notifySuccess,
      notifyWarning,
      invalidateQueries,
      setSelectedDate,
    });

    expect(notifySuccess).toHaveBeenCalledWith('2件の訪問候補を生成しました');
    expect(notifyWarning).toHaveBeenCalledWith('算定アラート', {
      description: '算定要件A',
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['visit-schedule-proposals', 'org_1'],
    });
    expect(setSelectedDate).toHaveBeenCalledWith('2026-06-11');
  });
});
