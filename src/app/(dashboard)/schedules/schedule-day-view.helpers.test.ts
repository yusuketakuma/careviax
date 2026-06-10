import { describe, expect, it } from 'vitest';
import {
  buildProposalBillingPreviewRequests,
  buildScheduleDayGanttViewModel,
  buildScheduleDayOfflineStatus,
  buildScheduleDayRouteMapPoints,
  buildScheduleDayRouteMapSite,
  buildScheduleDayViewModel,
  buildScheduleBillingPreviewRequests,
  buildFacilityRouteDefaults,
  buildFacilityTracker,
  buildDirectionsUrl,
  buildMapEmbedUrl,
  buildWeekProposalStats,
  getDepartureCarryWarning,
  getFacilityTrackerGrouping,
  proposalLockText,
  scheduleLockText,
  splitTrace,
  type FacilityTrackableSchedule,
  type FacilityTrackerSchedule,
  type ScheduleLockState,
} from './schedule-day-view.helpers';
import type { Proposal, VisitSchedule } from './day-view.shared';

function buildViewModelSchedule(overrides: Partial<VisitSchedule> = {}): VisitSchedule {
  return {
    id: 'schedule_1',
    case_id: 'case_1',
    visit_type: 'regular',
    priority: 'normal',
    schedule_status: 'planned',
    carry_items_status: 'ready',
    scheduled_date: '2026-04-09',
    time_window_start: '2026-04-09T09:00:00.000Z',
    time_window_end: '2026-04-09T10:00:00.000Z',
    pharmacist_id: 'pharmacist_1',
    assignment_mode: 'primary',
    route_order: null,
    facility_batch_id: null,
    confirmed_at: '2026-04-08T09:00:00.000Z',
    case_: {
      patient: {
        id: 'patient_1',
        name: '患者A',
        residences: [
          {
            address: '東京都千代田区1-1',
            building_id: null,
            unit_name: null,
            lat: 35.1,
            lng: 139.1,
          },
        ],
      },
    },
    site: {
      id: 'site_1',
      name: '中央薬局',
      address: '東京都千代田区2-2',
      lat: 35.0,
      lng: 139.0,
    },
    vehicle_resource: null,
    preparation: null,
    override_request: null,
    applied_override: null,
    facility_hint: null,
    workload_hint: {
      daily_visit_count: 1,
      urgent_visit_count: 0,
    },
    handoff_hint: null,
    ...overrides,
  };
}

describe('schedule-day-view.helpers', () => {
  it('returns carry warnings only for blocked or partial schedules', () => {
    expect(
      getDepartureCarryWarning({ carry_items_status: 'blocked' } as Pick<
        VisitSchedule,
        'carry_items_status'
      >),
    )?.toMatchObject({ title: '持参薬が未確定のままです' });
    expect(
      getDepartureCarryWarning({ carry_items_status: 'partial' } as Pick<
        VisitSchedule,
        'carry_items_status'
      >),
    )?.toMatchObject({ title: '持参物の一部が未確定です' });
    expect(
      getDepartureCarryWarning({ carry_items_status: 'ready' } as Pick<
        VisitSchedule,
        'carry_items_status'
      >),
    ).toBeNull();
  });

  it('builds navigation URLs from addresses', () => {
    expect(buildDirectionsUrl('東京都千代田区1-1')).toContain(
      encodeURIComponent('東京都千代田区1-1'),
    );
    expect(buildMapEmbedUrl('大阪市北区2-2')).toContain(encodeURIComponent('大阪市北区2-2'));
  });

  it('hides the offline status panel when there is no offline signal', () => {
    expect(
      buildScheduleDayOfflineStatus({
        isOffline: false,
        pendingSyncCount: 0,
        syncConflictCount: 0,
        cachedVisitBriefCount: 0,
        cachedVisitBriefUpdatedAt: null,
        cacheTtlHours: 24,
      }),
    ).toMatchObject({
      visible: false,
      networkBadgeLabel: 'オンライン',
      pendingSyncLabel: '同期待ち 0 件',
      conflictLabel: '競合 0 件',
      ttlLabel: '読取専用 TTL 24h',
      lastSyncLabel: '未実施',
      canManualSync: false,
      showConflictResolutionHint: false,
    });
  });

  it('surfaces offline status, queued drafts, conflicts, and cache freshness labels', () => {
    const status = buildScheduleDayOfflineStatus({
      isOffline: true,
      pendingSyncCount: 2,
      syncConflictCount: 1,
      cachedVisitBriefCount: 3,
      cachedVisitBriefUpdatedAt: '2026-04-09T08:15:00',
      cacheTtlHours: 12,
    });

    expect(status.visible).toBe(true);
    expect(status.networkBadgeLabel).toBe('オフライン');
    expect(status.networkBadgeClassName).toContain('border-amber-200');
    expect(status.pendingSyncLabel).toBe('同期待ち 2 件');
    expect(status.conflictLabel).toBe('競合 1 件');
    expect(status.ttlLabel).toBe('読取専用 TTL 12h');
    expect(status.lastSyncLabel).toBe('4/9 08:15');
    expect(status.canManualSync).toBe(true);
    expect(status.showConflictResolutionHint).toBe(true);
  });

  it('shows the offline status panel when only sync conflicts remain', () => {
    const status = buildScheduleDayOfflineStatus({
      isOffline: false,
      pendingSyncCount: 0,
      syncConflictCount: 1,
      cachedVisitBriefCount: 0,
      cachedVisitBriefUpdatedAt: null,
      cacheTtlHours: 24,
    });

    expect(status.visible).toBe(true);
    expect(status.networkBadgeLabel).toBe('オンライン');
    expect(status.canManualSync).toBe(false);
    expect(status.showConflictResolutionHint).toBe(true);
  });

  it('splits workflow traces into trimmed segments', () => {
    expect(splitTrace('調整中 / 未架電 / 施設依頼')).toEqual(['調整中', '未架電', '施設依頼']);
  });

  it('builds weekly proposal stats without changing lock semantics', () => {
    const stats = buildWeekProposalStats(
      [
        {
          proposal_status: 'proposed',
          priority: 'normal',
          assignment_mode: 'primary',
        },
        {
          proposal_status: 'reschedule_pending',
          priority: 'emergency',
          assignment_mode: 'fallback',
        },
        {
          proposal_status: 'patient_contact_pending',
          priority: 'urgent',
          assignment_mode: 'primary',
        },
      ] as Pick<Proposal, 'proposal_status' | 'priority' | 'assignment_mode'>[],
      [
        {
          confirmed_at: '2026-04-02T09:00:00.000Z',
          override_request: null,
          priority: 'normal',
          assignment_mode: 'primary',
        },
        {
          confirmed_at: '2026-04-02T10:00:00.000Z',
          override_request: { status: 'pending' },
          priority: 'emergency',
          assignment_mode: 'fallback',
        },
        {
          confirmed_at: null,
          override_request: null,
          priority: 'normal',
          assignment_mode: 'primary',
        },
      ] as Pick<
        VisitSchedule,
        'confirmed_at' | 'override_request' | 'priority' | 'assignment_mode'
      >[],
    );

    expect(stats).toEqual({
      approvalPending: 2,
      contactPending: 1,
      confirmedSchedules: 2,
      lockedSchedules: 2,
      pendingOverrides: 1,
      emergencyImpacts: 2,
      fallbackAssignments: 2,
    });
  });

  it('resolves schedule lock badges in priority order', () => {
    expect(
      scheduleLockText({
        override_request: { status: 'pending', reason: '施設都合' },
        confirmed_at: '2026-04-02T09:00:00.000Z',
        applied_override: null,
      } satisfies ScheduleLockState),
    ).toMatchObject({ label: '変更承認待ち' });

    expect(
      scheduleLockText({
        override_request: null,
        confirmed_at: '2026-04-02T09:00:00.000Z',
        applied_override: null,
      } satisfies ScheduleLockState),
    ).toMatchObject({ label: '運用ロック' });
  });

  it('resolves proposal lock badges from proposal status', () => {
    expect(
      proposalLockText({
        proposal_status: 'patient_contact_pending',
        finalized_schedule_id: null,
      } as Pick<Proposal, 'proposal_status' | 'finalized_schedule_id'>),
    ).toMatchObject({ label: '電話待ち' });

    expect(
      proposalLockText({
        proposal_status: 'proposed',
        finalized_schedule_id: 'schedule_1',
      } as Pick<Proposal, 'proposal_status' | 'finalized_schedule_id'>),
    ).toMatchObject({ label: '確定済み' });
  });

  it('builds facility tracker groups and default route order maps', () => {
    const schedules: FacilityTrackerSchedule[] = [
      {
        id: 'schedule_1',
        facility_batch_id: 'batch_1',
        facility_hint: { label: 'サンプル施設' },
        site: { id: 'site_1', name: '中央薬局' },
        route_order: 2,
        schedule_status: 'planned',
        preparation: { prepared_at: '2026-04-02T09:00:00.000Z', carry_items_confirmed: true },
        case_: {
          patient: {
            name: '患者A',
            residences: [{ address: '東京都千代田区1-1', unit_name: '101' }],
          },
        },
      },
      {
        id: 'schedule_2',
        facility_batch_id: 'batch_1',
        facility_hint: { label: 'サンプル施設' },
        site: { id: 'site_1', name: '中央薬局' },
        route_order: null,
        schedule_status: 'in_preparation',
        preparation: { prepared_at: null, carry_items_confirmed: false },
        case_: {
          patient: {
            name: '患者B',
            residences: [{ address: '東京都千代田区1-1', unit_name: '102' }],
          },
        },
      },
      {
        id: 'schedule_3',
        facility_batch_id: null,
        facility_hint: { label: '単独訪問先' },
        site: { id: 'site_1', name: '中央薬局' },
        route_order: 1,
        schedule_status: 'completed',
        preparation: { prepared_at: '2026-04-02T09:00:00.000Z', carry_items_confirmed: true },
        case_: {
          patient: {
            name: '患者C',
            residences: [{ address: '東京都千代田区2-2', unit_name: '201' }],
          },
        },
      },
    ];

    const groups = buildFacilityTracker(schedules);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      key: 'site_1:batch_1:サンプル施設',
      patientNames: ['患者A', '患者B'],
      preparedCount: 1,
      carryPendingCount: 1,
      incompleteCount: 2,
      routeOrders: [2],
    });

    expect(buildFacilityRouteDefaults(groups)).toEqual({
      'site_1:batch_1:サンプル施設': {
        schedule_1: '2',
        schedule_2: '2',
      },
    });
  });

  it('builds the day view model from selected date, facility filter, and route context', () => {
    const schedules = [
      buildViewModelSchedule({
        id: 'schedule_other_day',
        scheduled_date: '2026-04-10',
        time_window_start: '2026-04-10T08:00:00.000Z',
      }),
      buildViewModelSchedule({
        id: 'schedule_solo',
        pharmacist_id: 'pharmacist_2',
        time_window_start: '2026-04-09T08:00:00.000Z',
        time_window_end: '2026-04-09T08:30:00.000Z',
        case_: {
          patient: {
            id: 'patient_solo',
            name: '単独患者',
            residences: [{ address: '東京都中央区3-3', building_id: null, unit_name: null }],
          },
        },
      }),
      buildViewModelSchedule({
        id: 'schedule_facility_late_route',
        route_order: 2,
        facility_batch_id: 'batch_1',
        time_window_start: '2026-04-09T09:00:00.000Z',
        time_window_end: '2026-04-09T09:30:00.000Z',
        case_: {
          patient: {
            id: 'patient_facility_1',
            name: '施設患者A',
            residences: [{ address: '東京都港区4-4', building_id: '青空ホーム', unit_name: '101' }],
          },
        },
        facility_hint: {
          label: '青空ホーム',
          patient_count: 2,
          patient_names: ['施設患者A', '施設患者B'],
        },
      }),
      buildViewModelSchedule({
        id: 'schedule_facility_first_route',
        route_order: 1,
        facility_batch_id: 'batch_1',
        time_window_start: '2026-04-09T11:00:00.000Z',
        time_window_end: '2026-04-09T11:30:00.000Z',
        case_: {
          patient: {
            id: 'patient_facility_2',
            name: '施設患者B',
            residences: [{ address: '東京都港区4-4', building_id: '青空ホーム', unit_name: '102' }],
          },
        },
        facility_hint: {
          label: '青空ホーム',
          patient_count: 2,
          patient_names: ['施設患者A', '施設患者B'],
        },
      }),
    ];
    const facilityKey = 'site_1:batch_1:青空ホーム';

    const model = buildScheduleDayViewModel({
      schedules,
      selectedDate: '2026-04-09',
      facilityFilter: facilityKey,
      pharmacistNameById: new Map([['pharmacist_1', '薬剤師A']]),
      selectedRoutePharmacistId: 'missing_pharmacist',
    });

    expect(model.selectedDateSchedules.map((schedule) => schedule.id)).toEqual([
      'schedule_solo',
      'schedule_facility_late_route',
      'schedule_facility_first_route',
    ]);
    expect(model.facilityTracker.map((group) => group.key)).toEqual([facilityKey]);
    expect(model.activeFacilityFilter).toBe(facilityKey);
    expect(model.visibleSchedules.map((schedule) => schedule.id)).toEqual([
      'schedule_facility_late_route',
      'schedule_facility_first_route',
    ]);
    expect(model.mobileVisitSchedules.map((schedule) => schedule.id)).toEqual([
      'schedule_facility_first_route',
      'schedule_facility_late_route',
    ]);
    expect(model.mobileFacilityGroups).toHaveLength(1);
    expect(model.routePharmacistOptions).toEqual([
      { id: 'pharmacist_1', name: '薬剤師A', siteName: '中央薬局' },
    ]);
    expect(model.resolvedRoutePharmacistId).toBe('pharmacist_1');
    expect(model.currentOrderedRouteScheduleIds).toEqual([
      'schedule_facility_first_route',
      'schedule_facility_late_route',
    ]);
    expect(model.routeDepartureTime).toBe('2026-04-09T09:00:00.000Z');
    expect(model.routeSelectionLabel).toBe('薬剤師A / 2026-04-09');

    const staleFilterModel = buildScheduleDayViewModel({
      schedules,
      selectedDate: '2026-04-09',
      facilityFilter: 'stale-filter',
      pharmacistNameById: new Map([['pharmacist_1', '薬剤師A']]),
      selectedRoutePharmacistId: 'missing_pharmacist',
    });

    expect(staleFilterModel.activeFacilityFilter).toBeNull();
    expect(staleFilterModel.visibleSchedules.map((schedule) => schedule.id)).toEqual([
      'schedule_solo',
      'schedule_facility_late_route',
      'schedule_facility_first_route',
    ]);
    expect(staleFilterModel.routePharmacistOptions).toEqual([
      { id: 'pharmacist_2', name: '薬剤師未登録', siteName: '中央薬局' },
      { id: 'pharmacist_1', name: '薬剤師A', siteName: '中央薬局' },
    ]);
    expect(staleFilterModel.resolvedRoutePharmacistId).toBe('pharmacist_2');
    expect(staleFilterModel.currentOrderedRouteScheduleIds).toEqual(['schedule_solo']);
  });

  it('builds billing preview request payloads without dropping site or date keys', () => {
    expect(
      buildProposalBillingPreviewRequests([
        {
          id: 'proposal_1',
          case_id: 'case_1',
          proposed_date: '2026-04-09T23:30:00.000Z',
          proposed_pharmacist_id: 'pharmacist_1',
          site: { id: 'site_1' },
          visit_type: 'regular',
        } as Pick<
          Proposal,
          'id' | 'case_id' | 'proposed_date' | 'proposed_pharmacist_id' | 'site' | 'visit_type'
        >,
      ]),
    ).toEqual([
      {
        proposalId: 'proposal_1',
        caseId: 'case_1',
        proposedDate: '2026-04-09',
        pharmacistId: 'pharmacist_1',
        siteId: 'site_1',
        visitType: 'regular',
      },
    ]);

    expect(
      buildScheduleBillingPreviewRequests([
        buildViewModelSchedule({
          id: 'schedule_1',
          case_id: 'case_2',
          scheduled_date: '2026-04-09T23:30:00.000Z',
          pharmacist_id: 'pharmacist_2',
          site: null,
          visit_type: 'temporary',
        }),
      ]),
    ).toEqual([
      {
        scheduleId: 'schedule_1',
        caseId: 'case_2',
        proposedDate: '2026-04-09',
        pharmacistId: 'pharmacist_2',
        siteId: null,
        visitType: 'temporary',
      },
    ]);
  });

  it('builds route map points and site from route drafts without including unmappable visits', () => {
    const routeMapSchedules = [
      buildViewModelSchedule({
        id: 'schedule_first',
        time_window_start: '2026-04-09T10:00:00',
        time_window_end: '2026-04-09T10:30:00',
        schedule_status: 'ready',
        priority: 'urgent',
        case_: {
          patient: {
            id: 'patient_first',
            name: '患者A',
            residences: [
              {
                address: '東京都千代田区1-1',
                building_id: null,
                unit_name: null,
                lat: 35.1,
                lng: 139.1,
              },
            ],
          },
        },
      }),
      buildViewModelSchedule({
        id: 'schedule_missing_coords',
        time_window_start: '2026-04-09T10:30:00',
        time_window_end: '2026-04-09T11:00:00',
        case_: {
          patient: {
            id: 'patient_missing_coords',
            name: '患者B',
            residences: [
              {
                address: '東京都中央区2-2',
                building_id: null,
                unit_name: null,
                lat: null,
                lng: 139.2,
              },
            ],
          },
        },
      }),
      buildViewModelSchedule({
        id: 'schedule_second',
        time_window_start: '2026-04-09T11:00:00',
        time_window_end: '2026-04-09T11:30:00',
        schedule_status: 'in_progress',
        priority: 'emergency',
        case_: {
          patient: {
            id: 'patient_second',
            name: '患者C',
            residences: [
              {
                address: '東京都港区3-3',
                building_id: null,
                unit_name: null,
                lat: 35.3,
                lng: 139.3,
              },
            ],
          },
        },
      }),
    ];

    const points = buildScheduleDayRouteMapPoints({
      routeMapSchedules,
      draftScheduleIds: ['schedule_second', 'schedule_missing_coords', 'schedule_first'],
      manualDirty: false,
      selectedDate: '2026-04-09',
      routeDepartureTime: '2026-04-09T09:00:00',
      routePlanByScheduleId: new Map([
        ['schedule_second', { scheduleId: 'schedule_second', arrivalOffsetSeconds: 1800 }],
        ['schedule_first', { scheduleId: 'schedule_first', arrivalOffsetSeconds: null }],
      ]),
    });

    expect(points).toEqual([
      {
        scheduleId: 'schedule_second',
        patientName: '患者C',
        address: '東京都港区3-3',
        lat: 35.3,
        lng: 139.3,
        orderLabel: '1',
        status: 'in_progress',
        priority: 'emergency',
        pointKind: 'schedule',
        timeLabel: '11:00 - 11:30',
        etaLabel: '09:30',
      },
      {
        scheduleId: 'schedule_first',
        patientName: '患者A',
        address: '東京都千代田区1-1',
        lat: 35.1,
        lng: 139.1,
        orderLabel: '3',
        status: 'ready',
        priority: 'urgent',
        pointKind: 'schedule',
        timeLabel: '10:00 - 10:30',
        etaLabel: '10:00',
      },
    ]);
    expect(
      buildScheduleDayRouteMapPoints({
        routeMapSchedules,
        draftScheduleIds: ['schedule_second'],
        manualDirty: true,
        selectedDate: '2026-04-09',
        routeDepartureTime: '2026-04-09T09:00:00',
        routePlanByScheduleId: new Map([
          ['schedule_second', { scheduleId: 'schedule_second', arrivalOffsetSeconds: 1800 }],
        ]),
      })[0]?.etaLabel,
    ).toBeNull();
    expect(buildScheduleDayRouteMapSite(routeMapSchedules)).toEqual({
      name: '中央薬局',
      lat: 35,
      lng: 139,
    });
    expect(buildScheduleDayRouteMapSite([buildViewModelSchedule({ site: null })])).toBeNull();
  });

  it('builds Gantt window, slots, columns, and table spans from visible schedules', () => {
    const visibleSchedules = [
      buildViewModelSchedule({
        id: 'schedule_a_later_route',
        pharmacist_id: 'pharmacist_a',
        route_order: 2,
        time_window_start: '2026-04-09T08:00:00',
        time_window_end: '2026-04-09T09:00:00',
        site: { id: 'site_a', name: 'A薬局', address: '東京都千代田区2-2', lat: 35, lng: 139 },
      }),
      buildViewModelSchedule({
        id: 'schedule_a_first_route',
        pharmacist_id: 'pharmacist_a',
        route_order: 1,
        time_window_start: '2026-04-09T10:00:00',
        time_window_end: '2026-04-09T11:00:00',
        site: { id: 'site_a', name: 'A薬局', address: '東京都千代田区2-2', lat: 35, lng: 139 },
      }),
      buildViewModelSchedule({
        id: 'schedule_b',
        pharmacist_id: 'pharmacist_b',
        route_order: null,
        time_window_start: '2026-04-09T09:30:00',
        time_window_end: '2026-04-09T10:30:00',
        site: { id: 'site_b', name: 'B薬局', address: '東京都中央区2-2', lat: 35, lng: 139 },
      }),
    ];

    const model = buildScheduleDayGanttViewModel({
      visibleSchedules,
      pharmacistNameById: new Map([
        ['pharmacist_b', '薬剤師B'],
        ['pharmacist_a', '薬剤師A'],
      ]),
    });

    expect(model.window).toEqual({ startMinutes: 450, endMinutes: 690 });
    expect(model.slots).toEqual([450, 480, 510, 540, 570, 600, 630, 660]);
    expect(model.columns.map((column) => column.pharmacistName)).toEqual(['薬剤師A', '薬剤師B']);
    expect(model.columns[0]?.schedules.map((schedule) => schedule.id)).toEqual([
      'schedule_a_first_route',
      'schedule_a_later_route',
    ]);

    const firstColumn = model.tableColumns[0];
    expect(firstColumn?.scheduleStarts.get(1)?.schedule.id).toBe('schedule_a_later_route');
    expect(firstColumn?.scheduleStarts.get(1)?.schedules.map((schedule) => schedule.id)).toEqual([
      'schedule_a_later_route',
    ]);
    expect(firstColumn?.scheduleStarts.get(1)?.span).toBe(2);
    expect(firstColumn?.scheduleStarts.get(5)?.schedule.id).toBe('schedule_a_first_route');
    expect(firstColumn?.scheduleStarts.get(5)?.schedules.map((schedule) => schedule.id)).toEqual([
      'schedule_a_first_route',
    ]);
    expect(firstColumn?.scheduleStarts.get(5)?.span).toBe(2);
    expect(firstColumn?.coveredSlots.has(2)).toBe(true);

    expect(
      buildScheduleDayGanttViewModel({
        visibleSchedules: [],
        pharmacistNameById: new Map(),
      }),
    ).toMatchObject({
      window: { startMinutes: 480, endMinutes: 1080 },
      slots: expect.arrayContaining([480, 1050]),
      columns: [],
      tableColumns: [],
    });
  });

  it('keeps same-start Gantt schedules in one table cell instead of overwriting them', () => {
    const visibleSchedules = [
      buildViewModelSchedule({
        id: 'same_start_second_route',
        pharmacist_id: 'pharmacist_a',
        route_order: 2,
        time_window_start: '2026-04-09T08:00:00',
        time_window_end: '2026-04-09T09:00:00',
        site: { id: 'site_a', name: 'A薬局', address: '東京都千代田区2-2', lat: 35, lng: 139 },
      }),
      buildViewModelSchedule({
        id: 'same_start_first_route',
        pharmacist_id: 'pharmacist_a',
        route_order: 1,
        time_window_start: '2026-04-09T08:00:00',
        time_window_end: '2026-04-09T08:30:00',
        site: { id: 'site_a', name: 'A薬局', address: '東京都千代田区2-2', lat: 35, lng: 139 },
      }),
    ];

    const model = buildScheduleDayGanttViewModel({
      visibleSchedules,
      pharmacistNameById: new Map([['pharmacist_a', '薬剤師A']]),
    });

    const sameStartCell = model.tableColumns[0]?.scheduleStarts.get(1);
    expect(sameStartCell?.schedule.id).toBe('same_start_first_route');
    expect(sameStartCell?.schedules.map((schedule) => schedule.id)).toEqual([
      'same_start_first_route',
      'same_start_second_route',
    ]);
    expect(sameStartCell?.span).toBe(2);
    expect(sameStartCell?.overlapKind).toBe('same_start');
    expect(model.tableColumns[0]?.coveredSlots.has(2)).toBe(true);
  });

  it('keeps staggered overlapping Gantt schedules in the first overlapping table cell', () => {
    const visibleSchedules = [
      buildViewModelSchedule({
        id: 'overlap_first',
        pharmacist_id: 'pharmacist_a',
        route_order: 1,
        time_window_start: '2026-04-09T08:00:00',
        time_window_end: '2026-04-09T09:00:00',
        site: { id: 'site_a', name: 'A薬局', address: '東京都千代田区2-2', lat: 35, lng: 139 },
      }),
      buildViewModelSchedule({
        id: 'overlap_second',
        pharmacist_id: 'pharmacist_a',
        route_order: 2,
        time_window_start: '2026-04-09T08:30:00',
        time_window_end: '2026-04-09T09:30:00',
        site: { id: 'site_a', name: 'A薬局', address: '東京都千代田区2-2', lat: 35, lng: 139 },
      }),
    ];

    const model = buildScheduleDayGanttViewModel({
      visibleSchedules,
      pharmacistNameById: new Map([['pharmacist_a', '薬剤師A']]),
    });

    const overlappingCell = model.tableColumns[0]?.scheduleStarts.get(1);
    expect(overlappingCell?.schedule.id).toBe('overlap_first');
    expect(overlappingCell?.schedules.map((schedule) => schedule.id)).toEqual([
      'overlap_first',
      'overlap_second',
    ]);
    expect(overlappingCell?.span).toBe(3);
    expect(overlappingCell?.overlapKind).toBe('overlap');
    expect(model.tableColumns[0]?.scheduleStarts.has(2)).toBe(false);
    expect(model.tableColumns[0]?.coveredSlots.has(2)).toBe(true);
    expect(model.tableColumns[0]?.coveredSlots.has(3)).toBe(true);
  });

  it('extends one Gantt cell across chained overlapping schedules', () => {
    const visibleSchedules = [
      buildViewModelSchedule({
        id: 'chain_first',
        pharmacist_id: 'pharmacist_a',
        route_order: 1,
        time_window_start: '2026-04-09T08:00:00',
        time_window_end: '2026-04-09T09:00:00',
      }),
      buildViewModelSchedule({
        id: 'chain_second',
        pharmacist_id: 'pharmacist_a',
        route_order: 2,
        time_window_start: '2026-04-09T08:30:00',
        time_window_end: '2026-04-09T09:30:00',
      }),
      buildViewModelSchedule({
        id: 'chain_third',
        pharmacist_id: 'pharmacist_a',
        route_order: 3,
        time_window_start: '2026-04-09T09:00:00',
        time_window_end: '2026-04-09T10:00:00',
      }),
    ];

    const model = buildScheduleDayGanttViewModel({
      visibleSchedules,
      pharmacistNameById: new Map([['pharmacist_a', '薬剤師A']]),
    });

    const chainedCell = model.tableColumns[0]?.scheduleStarts.get(1);
    expect(chainedCell?.schedules.map((schedule) => schedule.id)).toEqual([
      'chain_first',
      'chain_second',
      'chain_third',
    ]);
    expect(chainedCell?.span).toBe(4);
    expect(chainedCell?.overlapKind).toBe('overlap');
    expect(model.tableColumns[0]?.scheduleStarts.has(2)).toBe(false);
    expect(model.tableColumns[0]?.scheduleStarts.has(3)).toBe(false);
    expect(model.tableColumns[0]?.coveredSlots.has(4)).toBe(true);
  });

  it('uses one shared facility tracker key for filters and record links', () => {
    const schedule: FacilityTrackableSchedule = {
      facility_batch_id: 'batch_1',
      facility_hint: null,
      site: { id: 'site_1', name: '中央薬局' },
      case_: {
        patient: {
          residences: [
            {
              facility_id: 'facility_1',
              facility_unit_id: 'unit_2',
              building_id: '青空ホーム',
              address: '東京都千代田区1-1',
              unit_name: '2F 東',
            },
          ],
        },
      },
    };

    expect(getFacilityTrackerGrouping(schedule)).toEqual({
      key: 'site_1:batch_1:facility:facility_1',
      label: '青空ホーム',
    });
  });
});
