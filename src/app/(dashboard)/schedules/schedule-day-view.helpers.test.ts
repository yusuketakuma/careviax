import { describe, expect, it } from 'vitest';
import {
  buildProposalBillingPreviewRequests,
  canOverrideDepartureCarryWarning,
  buildScheduleDayGanttViewModel,
  buildScheduleDayOfflineStatus,
  buildScheduleDayRouteMapPoints,
  buildScheduleDayRouteMapSite,
  buildScheduleDayViewModel,
  buildScheduleBillingPreviewRequests,
  canExecuteProposalConfirmAction,
  canBulkConfirmFacilityCarryItems,
  buildFacilityRouteDefaults,
  buildFacilityTracker,
  buildDirectionsUrl,
  buildMapEmbedUrl,
  buildWeekProposalStats,
  getUnsafeFacilityCarryPatients,
  getDepartureCarryWarning,
  getFacilityTrackerGrouping,
  proposalConfirmActionLabel,
  proposalConfirmResultLabel,
  proposalLockText,
  scheduleLockText,
  splitTrace,
  type FacilityTrackableSchedule,
  type FacilityTrackerSchedule,
  type ScheduleLockState,
} from './schedule-day-view.helpers';
import {
  AUTO_VEHICLE_RESOURCE_VALUE,
  caseOptionPrimaryPharmacistLabel,
  caseOptionTargetLabel,
  formatDistanceScoreLabel,
  formatNullableDateLabel,
  formatNullableDateTimeLabel,
  formatNullableTimeOfDay,
  formatNullableTimeRange,
  formatShortEntityIdentifier,
  formatVehicleResourceLabel,
  isPatientPreferenceAlignedProposal,
  isPriorityRouteProposal,
  normalizeVehicleResourceSelectValue,
  proposalActionFailureDisplayMessage,
  proposalActionTargetLabel,
  proposalListVisitPlaceLabel,
  proposalRouteDecisionLabel,
  proposalSafeIdentifierLabel,
  proposalShortEntityIdentifier,
  singleProposalActionLabel,
  singleProposalActionQuestion,
  singleProposalActionResultLabel,
  toDateKey,
  type CaseOption,
  type Proposal,
  type VisitSchedule,
} from './day-view.shared';

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
  it('keeps the shared auto vehicle sentinel stable', () => {
    expect(AUTO_VEHICLE_RESOURCE_VALUE).toBe('__auto_vehicle_resource__');
  });

  it('normalizes vehicle resource select values before they reach request payloads', () => {
    expect(normalizeVehicleResourceSelectValue('vehicle_1')).toBe('vehicle_1');
    expect(normalizeVehicleResourceSelectValue(AUTO_VEHICLE_RESOURCE_VALUE)).toBe('');
    expect(normalizeVehicleResourceSelectValue('')).toBe('');
    expect(normalizeVehicleResourceSelectValue(null)).toBe('');
    expect(normalizeVehicleResourceSelectValue(undefined)).toBe('');
    expect(normalizeVehicleResourceSelectValue('__auto__', '__auto__')).toBe('');
  });

  it('formats short entity identifiers with optional known-prefix stripping', () => {
    expect(formatShortEntityIdentifier('  ')).toBe('未設定');
    expect(formatShortEntityIdentifier('case_1234567890')).toBe('34567890');
    expect(formatShortEntityIdentifier('case_1234567890', { stripKnownPrefixes: true })).toBe(
      '34567890',
    );
    expect(formatShortEntityIdentifier('case_1', { stripKnownPrefixes: true })).toBe('1');
    expect(formatShortEntityIdentifier('patient_same_2', { stripKnownPrefixes: true })).toBe(
      'same_2',
    );
    expect(formatShortEntityIdentifier('external-id-abcdef')).toBe('d-abcdef');
  });

  it('formats nullable time values and ranges without forcing a missing-time label', () => {
    expect(formatNullableTimeOfDay(null)).toBeNull();
    expect(formatNullableTimeOfDay(undefined)).toBeNull();
    expect(formatNullableTimeOfDay('2026-04-09T18:00:00')).toBe('18:00');
    expect(formatNullableTimeRange(null, undefined)).toBeNull();
    expect(formatNullableTimeRange('2026-04-09T18:00:00', null)).toBe('18:00');
    expect(formatNullableTimeRange(null, '2026-04-09T19:00:00')).toBe('19:00');
    expect(formatNullableTimeRange('2026-04-09T18:00:00', '2026-04-09T19:00:00')).toBe(
      '18:00 - 19:00',
    );
  });

  it('extracts stable date keys from date and datetime values', () => {
    expect(toDateKey('2026-04-09')).toBe('2026-04-09');
    expect(toDateKey('2026-04-09T18:00:00.000Z')).toBe('2026-04-09');
  });

  it('formats nullable date labels and distance scores for proposal displays', () => {
    expect(formatNullableDateLabel(null)).toBe('未設定');
    expect(formatNullableDateLabel(undefined, '開始日未指定')).toBe('開始日未指定');
    expect(formatNullableDateLabel('2026-04-09')).toBe('2026/04/09');
    expect(formatNullableDateTimeLabel(null)).toBe('未設定');
    expect(formatNullableDateTimeLabel('2026-04-09T18:30:00')).toBe('2026/04/09 18:30');
    expect(formatDistanceScoreLabel(null)).toBe('0.0');
    expect(formatDistanceScoreLabel(undefined)).toBe('0.0');
    expect(formatDistanceScoreLabel(1.234)).toBe('1.2');
  });

  it('formats proposal and case target labels without leaking visit addresses in list labels', () => {
    const careCase = {
      id: 'case_same_2',
      status: 'active',
      primary_pharmacist_id: 'pharmacist_1',
      primary_pharmacist_name: '薬剤師A',
      patient: {
        id: 'patient_same_2',
        name: '佐藤太郎',
        residences: [{ address: '東京都千代田区1-1', lat: null, lng: null }],
      },
    } satisfies CaseOption;
    const proposal = {
      id: 'proposal_1',
      case_id: 'case_1',
      visit_type: 'regular',
      priority: 'normal',
      proposal_status: 'proposed',
      patient_contact_status: 'pending',
      proposed_date: '2026-04-09',
      time_window_start: '2026-04-09T18:00:00',
      time_window_end: '2026-04-09T19:00:00',
      proposed_pharmacist_id: 'pharmacist_1',
      proposed_pharmacist: {
        id: 'pharmacist_1',
        name: '薬剤師A',
        name_kana: null,
      },
      assignment_mode: 'primary',
      route_order: null,
      route_distance_score: null,
      medication_end_date: null,
      visit_deadline_date: null,
      proposal_reason: '移動良好',
      escalation_reason: null,
      finalized_schedule_id: null,
      reschedule_source_schedule_id: null,
      case_: {
        patient: {
          id: 'patient_1',
          name: '山田花子',
          residences: [
            {
              address: '東京都中央区2-2',
              building_id: null,
              unit_name: null,
              lat: null,
              lng: null,
            },
          ],
        },
      },
      site: {
        id: 'site_1',
        name: ' 本店 ',
        address: '東京都港区3-3',
        lat: null,
        lng: null,
      },
      vehicle_resource: {
        id: 'vehicle_1',
        label: '社用車A',
        travel_mode: 'DRIVE',
        max_stops: 6,
        max_route_duration_minutes: 180,
      },
      finalized_schedule: null,
      reschedule_source_schedule: null,
      contact_logs: [],
    } satisfies Proposal;

    expect(proposalShortEntityIdentifier('case_same_2')).toBe('same_2');
    expect(proposalSafeIdentifierLabel(proposal)).toBe('ケース 1 / 候補 1');
    expect(caseOptionPrimaryPharmacistLabel({ ...careCase, primary_pharmacist_name: null })).toBe(
      '主担当未設定',
    );
    expect(caseOptionTargetLabel(careCase)).toBe(
      '佐藤太郎 / ケース same_2 / 患者識別 same_2 / 主担当 薬剤師A',
    );
    expect(proposalListVisitPlaceLabel(proposal)).toBe(
      '訪問先住所は詳細・ルート確認で表示 / 担当拠点 本店',
    );
    expect(proposalListVisitPlaceLabel({ site: null })).toBe('訪問先住所は詳細・ルート確認で表示');
    expect(proposalActionTargetLabel(proposal)).toBe(
      '山田花子 2026/04/09 18:00 - 19:00 / 薬剤師A / 社用車A / ケース 1 / 候補 1',
    );
  });

  it('keeps proposal confirmation action labels and executable states stable', () => {
    expect(proposalConfirmActionLabel('approve')).toBe('承認して架電へ進める');
    expect(proposalConfirmActionLabel('confirm')).toBe('日時確定する');
    expect(proposalConfirmResultLabel('approve')).toBe('患者連絡待ち');
    expect(proposalConfirmResultLabel('confirm')).toBe('訪問予定確定');
    expect(
      canExecuteProposalConfirmAction({
        action: 'approve',
        proposal: { proposal_status: 'proposed', patient_contact_status: 'pending' },
      }),
    ).toBe(true);
    expect(
      canExecuteProposalConfirmAction({
        action: 'approve',
        proposal: { proposal_status: 'patient_contact_pending', patient_contact_status: 'pending' },
      }),
    ).toBe(false);
    expect(
      canExecuteProposalConfirmAction({
        action: 'confirm',
        proposal: {
          proposal_status: 'patient_contact_pending',
          patient_contact_status: 'confirmed',
        },
      }),
    ).toBe(true);
  });

  it('derives proposal route decision labels from reason and priority', () => {
    expect(
      isPriorityRouteProposal({
        priority: 'urgent',
        proposal_reason: '緊急訪問のため即応枠を優先',
      }),
    ).toBe(true);
    expect(
      isPriorityRouteProposal({
        priority: 'normal',
        proposal_reason: '即応枠を優先',
      }),
    ).toBe(false);
    expect(isPatientPreferenceAlignedProposal({ proposal_reason: '患者条件 09:00-12:00 内' })).toBe(
      true,
    );
    expect(
      proposalRouteDecisionLabel({
        priority: 'emergency',
        proposal_reason: '緊急訪問のため即応枠を優先',
        route_order: 2,
      }),
    ).toBe('緊急度優先で順路 2');
    expect(
      proposalRouteDecisionLabel({
        priority: 'normal',
        proposal_reason: '患者条件 09:00-12:00 内で配置',
        route_order: null,
      }),
    ).toBe('患者希望枠で順路 未設定');
    expect(
      proposalRouteDecisionLabel({
        priority: 'normal',
        proposal_reason: '移動良好',
        route_order: 3,
      }),
    ).toBe('順路 3');
  });

  it('formats single proposal confirmation action copy consistently', () => {
    expect(singleProposalActionLabel('approve')).toBe('承認して患者連絡へ進める');
    expect(singleProposalActionQuestion('approve')).toBe('承認して患者連絡へ進めますか');
    expect(singleProposalActionResultLabel('approve')).toBe('患者連絡待ち');
    expect(singleProposalActionLabel('confirm')).toBe('日時確定する');
    expect(singleProposalActionQuestion('confirm')).toBe('日時確定しますか');
    expect(singleProposalActionResultLabel('confirm')).toBe('訪問予定確定');
  });

  it('sanitizes proposal action failure messages before display', () => {
    expect(proposalActionFailureDisplayMessage('候補はすでに更新済みです', true)).toBe(
      '候補はすでに更新済みです',
    );
    expect(proposalActionFailureDisplayMessage(' 候補はすでに更新済みです ', true)).toBe(
      '候補はすでに更新済みです',
    );
    expect(proposalActionFailureDisplayMessage('勤務枠が埋まりました', true)).toBe(
      '勤務枠が埋まりました',
    );
    expect(
      proposalActionFailureDisplayMessage('raw stack trace proposal_1 patient address', true),
    ).toBe(
      'サーバー側の状態変更または入力確認により未更新です。再取得後に候補状態を確認してください。',
    );
    expect(proposalActionFailureDisplayMessage('network failed', false)).toBe(
      '通信が完了しませんでした。接続を確認して再試行してください。',
    );
  });

  it('formats vehicle resource labels with route constraints and contextual empty labels', () => {
    expect(formatVehicleResourceLabel(null)).toBe('自動割当');
    expect(formatVehicleResourceLabel(undefined, '未割当')).toBe('未割当');
    expect(
      formatVehicleResourceLabel({
        id: 'vehicle_1',
        label: '社用車A',
        travel_mode: 'DRIVE',
        max_stops: 6,
        max_route_duration_minutes: 180,
      }),
    ).toBe('社用車A (最大6件 / 180分以内)');
    expect(
      formatVehicleResourceLabel({
        id: 'vehicle_2',
        label: '自転車便',
        travel_mode: 'BICYCLE',
        max_stops: null,
        max_route_duration_minutes: null,
      }),
    ).toBe('自転車便');
  });

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
    expect(
      canOverrideDepartureCarryWarning({ carry_items_status: 'blocked' } as Pick<
        VisitSchedule,
        'carry_items_status'
      >),
    ).toBe(false);
    expect(
      canOverrideDepartureCarryWarning({ carry_items_status: 'partial' } as Pick<
        VisitSchedule,
        'carry_items_status'
      >),
    ).toBe(true);
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
        selectedDateScheduleCount: 0,
        cachedVisitBriefUpdatedAt: null,
        visitBriefCacheStatus: 'ready',
        cacheTtlHours: 24,
      }),
    ).toMatchObject({
      visible: false,
      networkBadgeLabel: 'オンライン',
      pendingSyncLabel: '同期待ち 0 件',
      conflictLabel: '競合 0 件',
      ttlLabel: '読取専用 TTL 24h',
      visitBriefCoverageLabel: 'ブリーフ対象 0 件',
      visitBriefStatusLabel: '当日の確定訪問はありません。',
      lastSyncLabel: '未実施',
      canManualSync: false,
      manualSyncDisabledReason: '同期待ちの下書きはありません',
      showConflictResolutionHint: false,
    });
  });

  it('surfaces offline status, queued drafts, conflicts, and cache freshness labels', () => {
    const status = buildScheduleDayOfflineStatus({
      isOffline: true,
      pendingSyncCount: 2,
      syncConflictCount: 1,
      cachedVisitBriefCount: 3,
      selectedDateScheduleCount: 5,
      cachedVisitBriefUpdatedAt: '2026-04-09T08:15:00',
      visitBriefCacheStatus: 'ready',
      cacheTtlHours: 12,
    });

    expect(status.visible).toBe(true);
    expect(status.networkBadgeLabel).toBe('オフライン');
    expect(status.networkBadgeClassName).toContain('state-blocked');
    expect(status.pendingSyncLabel).toBe('同期待ち 2 件');
    expect(status.conflictLabel).toBe('競合 1 件');
    expect(status.ttlLabel).toBe('読取専用 TTL 12h');
    expect(status.visitBriefCoverageLabel).toBe('ブリーフ 3/5 件');
    expect(status.visitBriefCoverageClassName).toContain('state-confirm');
    expect(status.visitBriefStatusLabel).toBe('未取得 2 件。患者詳細と処方を確認してください。');
    expect(status.lastSyncLabel).toBe('4/9 08:15');
    expect(status.canManualSync).toBe(true);
    expect(status.manualSyncDisabledReason).toBeNull();
    expect(status.showConflictResolutionHint).toBe(true);
  });

  it('shows the offline status panel when only sync conflicts remain', () => {
    const status = buildScheduleDayOfflineStatus({
      isOffline: false,
      pendingSyncCount: 0,
      syncConflictCount: 1,
      cachedVisitBriefCount: 0,
      selectedDateScheduleCount: 0,
      cachedVisitBriefUpdatedAt: null,
      visitBriefCacheStatus: 'ready',
      cacheTtlHours: 24,
    });

    expect(status.visible).toBe(true);
    expect(status.networkBadgeLabel).toBe('オンライン');
    expect(status.canManualSync).toBe(false);
    expect(status.manualSyncDisabledReason).toBe('競合を解決してから同期してください');
    expect(status.showConflictResolutionHint).toBe(true);
  });

  it('shows offline status when visit brief cache load fails without other offline signals', () => {
    const status = buildScheduleDayOfflineStatus({
      isOffline: false,
      pendingSyncCount: 0,
      syncConflictCount: 0,
      cachedVisitBriefCount: 0,
      selectedDateScheduleCount: 2,
      cachedVisitBriefUpdatedAt: null,
      visitBriefCacheStatus: 'load_failed',
      cacheTtlHours: 24,
    });

    expect(status.visible).toBe(true);
    expect(status.visitBriefCoverageLabel).toBe('ブリーフ 0/2 件');
    expect(status.visitBriefCoverageClassName).toContain('state-confirm');
    expect(status.visitBriefStatusLabel).toBe(
      '端末キャッシュを読み込めません。患者詳細と処方を確認してください。',
    );
    expect(status.visitBriefStatusClassName).toBe('text-state-confirm');
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
        carry_items_status: 'ready',
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
        carry_items_status: 'partial',
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
        carry_items_status: 'ready',
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
      patients: expect.arrayContaining([
        expect.objectContaining({
          scheduleId: 'schedule_1',
          carryItemsStatus: 'ready',
          carryItemsConfirmed: true,
        }),
        expect.objectContaining({
          scheduleId: 'schedule_2',
          carryItemsStatus: 'partial',
          carryItemsConfirmed: false,
        }),
      ]),
    });
    expect(canBulkConfirmFacilityCarryItems(groups[0])).toBe(false);
    expect(getUnsafeFacilityCarryPatients(groups[0])).toEqual([
      expect.objectContaining({
        scheduleId: 'schedule_2',
        patientName: '患者B',
        carryItemsStatus: 'partial',
      }),
    ]);

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
