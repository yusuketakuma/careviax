import { describe, expect, it, vi } from 'vitest';
import {
  generateScheduleDayRescheduleProposals,
  handleScheduleDayRescheduleSuccess,
  type ScheduleDayRescheduleForm,
} from './schedule-day-reschedule';

const rescheduleForm: ScheduleDayRescheduleForm = {
  reason: '患者都合で訪問日変更',
  reason_code: 'patient_request',
  communication_channel: 'phone',
  communication_result: 'verbal_notified',
  start_date: '2026-04-10',
  priority: 'urgent',
};

describe('schedule day reschedule helpers', () => {
  it('posts the reschedule proposal request with org scope', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: [{ id: 'proposal_1' }] }));

    await expect(
      generateScheduleDayRescheduleProposals({
        orgId: 'org_1',
        target: { id: 'schedule_1' },
        form: rescheduleForm,
        fetchImpl,
      }),
    ).resolves.toEqual({ data: [{ id: 'proposal_1' }] });

    expect(fetchImpl).toHaveBeenCalledWith('/api/visit-schedules/schedule_1/reschedule', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-org-id': 'org_1',
      },
      body: JSON.stringify(rescheduleForm),
    });
  });

  it('rejects missing reschedule targets before posting', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: null }));

    await expect(
      generateScheduleDayRescheduleProposals({
        orgId: 'org_1',
        target: null,
        form: rescheduleForm,
        fetchImpl,
      }),
    ).rejects.toThrow('リスケ対象が選択されていません');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws the server error message when reschedule generation fails', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: '再提案できる候補がありません' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    await expect(
      generateScheduleDayRescheduleProposals({
        orgId: 'org_1',
        target: { id: 'schedule_1' },
        form: rescheduleForm,
        fetchImpl,
      }),
    ).rejects.toThrow('再提案できる候補がありません');
  });

  it('notifies success, closes the dialog, and refreshes reschedule-dependent queries', async () => {
    const notifySuccess = vi.fn();
    const closeDialog = vi.fn();
    const invalidateQueries = vi.fn(async () => undefined);

    await handleScheduleDayRescheduleSuccess({
      orgId: 'org_1',
      notifySuccess,
      closeDialog,
      invalidateQueries,
    });

    expect(notifySuccess).toHaveBeenCalledWith('リスケ候補を生成しました');
    expect(closeDialog).toHaveBeenCalledOnce();
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ['visit-schedule-proposals', 'org_1'],
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ['visit-schedules', 'week-board', 'org_1'],
    });
  });
});
