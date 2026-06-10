import { describe, expect, it, vi } from 'vitest';
import {
  buildScheduleDayPreparationForm,
  fetchScheduleDayPreparationDetails,
  handleScheduleDayPreparationSuccess,
  saveScheduleDayPreparation,
  type ScheduleDayPreparationForm,
} from './schedule-day-preparation';

const completeForm: ScheduleDayPreparationForm = {
  medication_changes_reviewed: true,
  carry_items_confirmed: true,
  previous_issues_reviewed: true,
  route_confirmed: true,
  offline_synced: true,
};

describe('schedule day preparation helpers', () => {
  it('builds preparation checklist form defaults from missing preparation', () => {
    expect(buildScheduleDayPreparationForm(null)).toEqual({
      medication_changes_reviewed: false,
      carry_items_confirmed: false,
      previous_issues_reviewed: false,
      route_confirmed: false,
      offline_synced: false,
    });
  });

  it('builds preparation checklist form from an existing preparation', () => {
    expect(
      buildScheduleDayPreparationForm({
        id: 'prep_1',
        prepared_at: null,
        medication_changes_reviewed: true,
        carry_items_confirmed: false,
        previous_issues_reviewed: true,
        route_confirmed: false,
        offline_synced: true,
        checklist: {},
      }),
    ).toEqual({
      medication_changes_reviewed: true,
      carry_items_confirmed: false,
      previous_issues_reviewed: true,
      route_confirmed: false,
      offline_synced: true,
    });
  });

  it('fetches preparation details with org scope', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        data: {
          preparation: null,
          pack: null,
        },
      }),
    );

    await expect(
      fetchScheduleDayPreparationDetails({
        orgId: 'org_1',
        scheduleId: 'schedule_1',
        fetchImpl,
      }),
    ).resolves.toEqual({
      preparation: null,
      pack: null,
    });

    expect(fetchImpl).toHaveBeenCalledWith('/api/visit-preparations/schedule_1', {
      headers: { 'x-org-id': 'org_1' },
    });
  });

  it('throws the legacy generic fetch error when preparation details cannot be fetched', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ message: 'ignored' }), { status: 500 }),
    );

    await expect(
      fetchScheduleDayPreparationDetails({
        orgId: 'org_1',
        scheduleId: 'schedule_1',
        fetchImpl,
      }),
    ).rejects.toThrow('訪問準備情報の取得に失敗しました');
  });

  it('saves preparation checklist without ready transition', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: { id: 'prep_1' } }));

    await expect(
      saveScheduleDayPreparation({
        orgId: 'org_1',
        request: {
          scheduleId: 'schedule_1',
          form: completeForm,
          markReady: false,
        },
        fetchImpl,
      }),
    ).resolves.toEqual({ data: { id: 'prep_1' } });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('/api/visit-preparations/schedule_1', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-org-id': 'org_1',
      },
      body: JSON.stringify({
        checklist: completeForm,
        ...completeForm,
      }),
    });
  });

  it('saves preparation then marks the schedule ready when requested', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: { id: 'prep_1' } }))
      .mockResolvedValueOnce(Response.json({ data: { id: 'schedule_1' } }));

    await saveScheduleDayPreparation({
      orgId: 'org_1',
      request: {
        scheduleId: 'schedule_1',
        form: completeForm,
        markReady: true,
      },
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(2, '/api/visit-schedules/schedule_1', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-org-id': 'org_1',
      },
      body: JSON.stringify({
        schedule_status: 'ready',
      }),
    });
  });

  it('propagates save and ready-transition server messages', async () => {
    await expect(
      saveScheduleDayPreparation({
        orgId: 'org_1',
        request: {
          scheduleId: 'schedule_1',
          form: completeForm,
          markReady: false,
        },
        fetchImpl: vi.fn(
          async () =>
            new Response(JSON.stringify({ message: 'チェックリストが古いです' }), {
              status: 409,
              headers: { 'Content-Type': 'application/json' },
            }),
        ),
      }),
    ).rejects.toThrow('チェックリストが古いです');

    await expect(
      saveScheduleDayPreparation({
        orgId: 'org_1',
        request: {
          scheduleId: 'schedule_1',
          form: completeForm,
          markReady: true,
        },
        fetchImpl: vi
          .fn()
          .mockResolvedValueOnce(Response.json({ data: { id: 'prep_1' } }))
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ message: 'ready にできません' }), {
              status: 409,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
      }),
    ).rejects.toThrow('ready にできません');
  });

  it('notifies, closes the dialog, and refreshes preparation-dependent queries after save', async () => {
    const notifySuccess = vi.fn();
    const closeDialog = vi.fn();
    const invalidateQueries = vi.fn(async () => undefined);

    await handleScheduleDayPreparationSuccess({
      orgId: 'org_1',
      markReady: true,
      notifySuccess,
      closeDialog,
      invalidateQueries,
    });

    expect(notifySuccess).toHaveBeenCalledWith('訪問準備を保存し、ready へ進めました');
    expect(closeDialog).toHaveBeenCalledOnce();
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ['visit-schedules', 'week-board', 'org_1'],
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ['tasks', 'org_1'],
    });
  });
});
