import { describe, expect, it } from 'vitest';
import {
  canOverrideDepartureCarryWarning,
  buildScheduleDayOfflineStatus,
  canExecuteProposalConfirmAction,
  buildDirectionsUrl,
  buildMapEmbedUrl,
  buildWeekProposalStats,
  getDepartureCarryWarning,
  proposalConfirmActionLabel,
  proposalConfirmResultLabel,
  proposalLockText,
  scheduleLockText,
  splitTrace,
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
} from './day-view.shared';

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
    expect(formatShortEntityIdentifier({ id: 'case_1234567890', display_id: 'cc0000000042' })).toBe(
      'cc0000000042',
    );
    expect(
      formatShortEntityIdentifier({
        id: 'case_1234567890',
        display_id: '   ',
      }),
    ).toBe('34567890');
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
      updated_at: '2026-04-09T08:00:00.000Z',
      medication_end_date: null,
      visit_deadline_date: null,
      proposal_reason: '移動良好',
      escalation_reason: null,
      finalized_schedule_id: null,
      reschedule_source_schedule_id: null,
      case_: {
        display_id: '1',
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
    expect(
      proposalSafeIdentifierLabel({
        ...proposal,
        display_id: 'vsp0000000001',
        case_: {
          ...proposal.case_,
          display_id: 'cc0000000001',
        },
      }),
    ).toBe('ケース cc0000000001 / 候補 vsp0000000001');
    expect(
      proposalSafeIdentifierLabel({
        ...proposal,
        display_id: null,
        case_: {
          ...proposal.case_,
          display_id: null,
        },
      }),
    ).toBe('ケース 1 / 候補 1');
    expect(caseOptionPrimaryPharmacistLabel({ ...careCase, primary_pharmacist_name: null })).toBe(
      '主担当未設定',
    );
    expect(
      caseOptionTargetLabel({
        ...careCase,
        display_id: 'cc0000000002',
        patient: {
          ...careCase.patient,
          display_id: 'p0000000002',
        },
      }),
    ).toBe('佐藤太郎 / ケース cc0000000002 / 患者識別 p0000000002 / 主担当 薬剤師A');
    expect(caseOptionTargetLabel(careCase)).toBe(
      '佐藤太郎 / ケース same_2 / 患者識別 same_2 / 主担当 薬剤師A',
    );
    expect(proposalListVisitPlaceLabel(proposal)).toBe(
      '訪問先住所は詳細・ルート確認で表示 / 担当拠点 本店',
    );
    expect(proposalListVisitPlaceLabel({ site: null })).toBe('訪問先住所は詳細・ルート確認で表示');
    expect(proposalActionTargetLabel(proposal)).toBe(
      '山田花子 2026/04/09 18:00 - 19:00 / 薬剤師A / 社用車A (最大6件 / 180分以内) / ケース 1 / 候補 1',
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
});
