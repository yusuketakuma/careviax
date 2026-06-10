import { describe, expect, it, vi } from 'vitest';
import {
  buildScheduleDayFacilityVisitDayPayload,
  handleScheduleDayFacilityVisitDaySuccess,
  saveScheduleDayFacilityVisitDay,
  type ScheduleDayFacilityVisitDayForm,
  type ScheduleDayFacilityVisitDayTarget,
} from './schedule-day-facility-visit-day';

const target: ScheduleDayFacilityVisitDayTarget = {
  label: '東京ホーム 2階',
  scheduleIds: ['schedule_a', 'schedule_b'],
};

const filledForm: ScheduleDayFacilityVisitDayForm = {
  preferred_weekdays: [1, 3],
  preferred_time_from: '09:00',
  preferred_time_to: '11:00',
  facility_time_from: '10:00',
  facility_time_to: '12:00',
  visit_buffer_minutes: '15',
  notes: '施設受付に声かけ',
};

describe('schedule day facility visit day helpers', () => {
  it('builds the visit-day payload and normalizes optional blank fields', () => {
    expect(
      buildScheduleDayFacilityVisitDayPayload({
        target,
        form: {
          preferred_weekdays: [2],
          preferred_time_from: '',
          preferred_time_to: '',
          facility_time_from: '',
          facility_time_to: '',
          visit_buffer_minutes: '',
          notes: '',
        },
      }),
    ).toEqual({
      facility_label: '東京ホーム 2階',
      schedule_ids: ['schedule_a', 'schedule_b'],
      preferred_weekdays: [2],
      preferred_time_from: null,
      preferred_time_to: null,
      facility_time_from: null,
      facility_time_to: null,
      visit_buffer_minutes: null,
      notes: null,
    });
  });

  it('keeps zero-minute buffers as a numeric value', () => {
    expect(
      buildScheduleDayFacilityVisitDayPayload({
        target,
        form: {
          ...filledForm,
          visit_buffer_minutes: '0',
        },
      }).visit_buffer_minutes,
    ).toBe(0);
  });

  it('posts the visit-day payload with org scope', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: { id: 'visit_day_1' } }));

    await expect(
      saveScheduleDayFacilityVisitDay({
        orgId: 'org_1',
        target,
        form: filledForm,
        fetchImpl,
      }),
    ).resolves.toEqual({ data: { id: 'visit_day_1' } });

    expect(fetchImpl).toHaveBeenCalledWith('/api/facility-visit-batches/visit-days', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-org-id': 'org_1',
      },
      body: JSON.stringify({
        facility_label: '東京ホーム 2階',
        schedule_ids: ['schedule_a', 'schedule_b'],
        preferred_weekdays: [1, 3],
        preferred_time_from: '09:00',
        preferred_time_to: '11:00',
        facility_time_from: '10:00',
        facility_time_to: '12:00',
        visit_buffer_minutes: 15,
        notes: '施設受付に声かけ',
      }),
    });
  });

  it('rejects missing targets before posting', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: null }));

    await expect(
      saveScheduleDayFacilityVisitDay({
        orgId: 'org_1',
        target: null,
        form: filledForm,
        fetchImpl,
      }),
    ).rejects.toThrow('訪問先グループが選択されていません');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws the server error message when visit-day save fails', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: '曜日設定が重複しています' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    await expect(
      saveScheduleDayFacilityVisitDay({
        orgId: 'org_1',
        target,
        form: filledForm,
        fetchImpl,
      }),
    ).rejects.toThrow('曜日設定が重複しています');
  });

  it('notifies success, closes the dialog, and refreshes visit-day dependent queries', async () => {
    const notifySuccess = vi.fn();
    const closeDialog = vi.fn();
    const invalidateQueries = vi.fn(async () => undefined);

    await handleScheduleDayFacilityVisitDaySuccess({
      orgId: 'org_1',
      notifySuccess,
      closeDialog,
      invalidateQueries,
    });

    expect(notifySuccess).toHaveBeenCalledWith('訪問先グループの定期訪問日を保存しました');
    expect(closeDialog).toHaveBeenCalledOnce();
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ['visit-schedules', 'week-board', 'org_1'],
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ['visit-schedule-proposals', 'org_1'],
    });
  });
});
