import { describe, expect, it } from 'vitest';
import {
  buildFacilityRouteDefaults,
  buildFacilityTracker,
  buildDirectionsUrl,
  buildMapEmbedUrl,
  getDepartureCarryWarning,
  getFacilityTrackerGrouping,
  proposalLockText,
  scheduleLockText,
  splitTrace,
} from './schedule-day-view.helpers';
import type { Proposal, VisitSchedule } from './day-view.shared';

describe('schedule-day-view.helpers', () => {
  it('returns carry warnings only for blocked or partial schedules', () => {
    expect(
      getDepartureCarryWarning({ carry_items_status: 'blocked' } as Pick<VisitSchedule, 'carry_items_status'>)
    )?.toMatchObject({ title: '持参薬が未確定のままです' });
    expect(
      getDepartureCarryWarning({ carry_items_status: 'partial' } as Pick<VisitSchedule, 'carry_items_status'>)
    )?.toMatchObject({ title: '持参物の一部が未確定です' });
    expect(
      getDepartureCarryWarning({ carry_items_status: 'ready' } as Pick<VisitSchedule, 'carry_items_status'>)
    ).toBeNull();
  });

  it('builds navigation URLs from addresses', () => {
    expect(buildDirectionsUrl('東京都千代田区1-1')).toContain(encodeURIComponent('東京都千代田区1-1'));
    expect(buildMapEmbedUrl('大阪市北区2-2')).toContain(encodeURIComponent('大阪市北区2-2'));
  });

  it('splits workflow traces into trimmed segments', () => {
    expect(splitTrace('調整中 / 未架電 / 施設依頼')).toEqual(['調整中', '未架電', '施設依頼']);
  });

  it('resolves schedule lock badges in priority order', () => {
    expect(
      scheduleLockText({
        override_request: { status: 'pending', reason: '施設都合' },
        confirmed_at: '2026-04-02T09:00:00.000Z',
        applied_override: null,
      } as unknown as Pick<VisitSchedule, 'confirmed_at' | 'applied_override' | 'override_request'>)
    ).toMatchObject({ label: '変更承認待ち' });

    expect(
      scheduleLockText({
        override_request: null,
        confirmed_at: '2026-04-02T09:00:00.000Z',
        applied_override: null,
      } as unknown as Pick<VisitSchedule, 'confirmed_at' | 'applied_override' | 'override_request'>)
    ).toMatchObject({ label: '運用ロック' });
  });

  it('resolves proposal lock badges from proposal status', () => {
    expect(
      proposalLockText({
        proposal_status: 'patient_contact_pending',
        finalized_schedule_id: null,
      } as Pick<Proposal, 'proposal_status' | 'finalized_schedule_id'>)
    ).toMatchObject({ label: '電話待ち' });

    expect(
      proposalLockText({
        proposal_status: 'proposed',
        finalized_schedule_id: 'schedule_1',
      } as Pick<Proposal, 'proposal_status' | 'finalized_schedule_id'>)
    ).toMatchObject({ label: '確定済み' });
  });

  it('builds facility tracker groups and default route order maps', () => {
    const schedules = [
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
    ] as unknown as VisitSchedule[];

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

  it('uses one shared facility tracker key for filters and record links', () => {
    const schedule = {
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
    } as unknown as VisitSchedule;

    expect(getFacilityTrackerGrouping(schedule)).toEqual({
      key: 'site_1:batch_1:facility:facility_1',
      label: '青空ホーム',
    });
  });
});
