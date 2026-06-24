import { buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateScheduleDayRescheduleProposals,
  handleScheduleDayRescheduleSuccess,
  type ScheduleDayRescheduleForm,
} from './schedule-day-reschedule';

vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return { ...actual, buildOrgJsonHeaders: vi.fn(actual.buildOrgJsonHeaders) };
});

const rescheduleForm: ScheduleDayRescheduleForm = {
  reason: '患者都合で訪問日変更',
  reason_code: 'patient_request',
  communication_channel: 'phone',
  communication_result: 'verbal_notified',
  start_date: '2026-04-10',
  priority: 'urgent',
};

describe('schedule day reschedule helpers', () => {
  beforeEach(() => {
    vi.mocked(buildOrgJsonHeaders).mockClear();
  });

  it('posts the reschedule proposal request with org scope', async () => {
    const scheduleId = 'schedule/1?x=y#frag';
    const sentinelHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgJsonHeaders' };
    vi.mocked(buildOrgJsonHeaders).mockReturnValueOnce(sentinelHeaders);
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ data: [{ id: 'proposal_1' }] }),
    );

    await expect(
      generateScheduleDayRescheduleProposals({
        orgId: 'org_1',
        target: { id: scheduleId },
        form: rescheduleForm,
        fetchImpl,
      }),
    ).resolves.toEqual({ data: [{ id: 'proposal_1' }] });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`/api/visit-schedules/${encodeURIComponent(scheduleId)}/reschedule`);
    expect(String(url)).not.toContain(scheduleId);
    expect(String(url)).not.toContain('%25');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toBe(sentinelHeaders);
    expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1');
    expect(init?.body).toBe(JSON.stringify(rescheduleForm));
    expect(JSON.parse(String(init?.body))).toEqual(rescheduleForm);
  });

  it.each(['.', '..'])(
    'rejects dot-segment reschedule target %s before fetch',
    async (scheduleId) => {
      const fetchImpl = vi.fn<typeof fetch>();

      await expect(
        generateScheduleDayRescheduleProposals({
          orgId: 'org_1',
          target: { id: scheduleId },
          form: rescheduleForm,
          fetchImpl,
        }),
      ).rejects.toThrow(RangeError);
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

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
